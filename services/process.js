'use strict'
const log = require('lambda-log')

const AWS = require('aws-sdk')
const s3 = new AWS.S3()
const ses = new AWS.SES()
const dynamodb = new AWS.DynamoDB.DocumentClient({ convertEmptyValues: true })
const bucketName = process.env.IS_LOCAL === 'true' ? 'email-forward-eu-west-1' : process.env.bucketName
const tableNameAliases = process.env.IS_LOCAL === 'true' ? 'email-forward-aliases' : process.env.tableNameAliases
const tableNameDomains = process.env.IS_LOCAL === 'true' ? 'email-forward-domains' : process.env.tableNameDomains

module.exports.handler = (event, context, callback) => {
  log.info('Event', event)

  let data = validateEvent(event)
  if (data) {
    data = fetchRecipients(data)
    fetchDomainAlias(data)
      .then(rewriteDomains)
      .then(fetchMapping)
      .then(transformRecipients)
      .then(fetchMessage)
      .then(processMessage)
      .then(sendMessage)
      .then((data) => {
        callback(null, { disposition: 'STOP_RULE_SET' })
      })
      .catch((e) => { // eslint-disable-line handle-callback-err
        if (e.toString() === 'Error: No valid recipients.') {
          callback(null, { disposition: 'STOP_RULE_SET' })
        } else {
          log.error('sendFailure', { error: e })
          callback()
        }
      })
  } else {
    callback()
  }
}

const validateEvent = (event) => {
  const data = {}
  // Validate characteristics of a SES event record.

  if (!event ||
      !Object.prototype.hasOwnProperty.call(event, 'Records') ||
      event.Records.length !== 1 ||
      !Object.prototype.hasOwnProperty.call(event.Records[0], 'eventSource') ||
      event.Records[0].eventSource !== 'aws:ses' ||
      event.Records[0].eventVersion !== '1.0') {
    log.error('ParseEvent', {
      message: 'parseEvent() received invalid SES message:',
      event: event
    })
    return null
  }

  data.email = event.Records[0].ses.mail
  data.recipients = event.Records[0].ses.receipt.recipients
  return data
}

const fetchRecipients = (data) => {
  data.originalRecipients = data.recipients.map(recipient => {
    const origEmailKey = recipient.toLowerCase()
    let emailDomain = ''
    const pos = origEmailKey.lastIndexOf('@')
    if (pos > -1) {
      emailDomain = origEmailKey.slice(pos)
    }
    if (emailDomain) {
      return {
        alias: origEmailKey,
        domain: emailDomain
      }
    }
  }).filter(item => item.emailDomain !== '')
  return data
}

const fetchDomainAlias = (data) => {
  const getDomainAliases = []
  data.originalRecipients.forEach((originalRecipient) => {
    const params = {
      TableName: tableNameDomains,
      Key: {
        domain: originalRecipient.domain.replace('@', '')
      }
    }
    const getDomainAlias = dynamodb.get(params).promise().then(res => {
      if (res.Item && res.Item.aliasfor) {
        return {
          from: res.Item.domain,
          to: res.Item.aliasfor
        }
      } else {
        return null
      }
    })
    getDomainAliases.push(getDomainAlias)
  })
  return Promise.all(getDomainAliases).then(res => {
    data.domainAliases = res.filter(e => e !== null)
    return data
  })
}

const rewriteDomains = (data) => {
  for (let i = 0; i < data.recipients.length; i++) {
    for (let j = 0; j < data.domainAliases.length; j++) {
      const from = data.domainAliases[j].from
      const to = data.domainAliases[j].to
      data.recipients[i] = data.recipients[i].replace(`@${from}`, `@${to}`)
    }
  }
  for (let i = 0; i < data.originalRecipients.length; i++) {
    for (let j = 0; j < data.domainAliases.length; j++) {
      const from = data.domainAliases[j].from
      const to = data.domainAliases[j].to
      data.originalRecipients[i].alias = data.originalRecipients[i].alias.replace(`@${from}`, `@${to}`)
      data.originalRecipients[i].domain = data.originalRecipients[i].domain.replace(`@${from}`, `@${to}`)
    }
  }
  return Promise.resolve(data)
}

const fetchMapping = (data) => {
  const mappings = []
  data.forwardMapping = {}
  data.originalRecipients.forEach((originalRecipient) => {
    const params = {
      TableName: tableNameAliases,
      KeyConditionExpression: 'alias = :recipient',
      ExpressionAttributeValues: {
        ':recipient': originalRecipient.alias
      }
    }
    const mapping = dynamodb.query(params).promise()
      .then(res => {
        data.forwardMapping[originalRecipient.alias] = res.Items.map(item => {
          if (!item.bounces) {
            item.bounces = 0
          }
          if (item.bounces === 0) {
            return item.destination
          } else {
            return null
          }
        }).filter(e => e !== null)
        return true
      })
    mappings.push(mapping)
  })
  return Promise.all(mappings).then(res => {
    return data
  })
}

const transformRecipients = (data) => {
  let newRecipients = []
  data.bounces = []
  for (let i = 0; i < data.originalRecipients.length; i++) {
    const origAlias = data.originalRecipients[i]
    const origEmailKey = origAlias.alias
    const emailDomain = origAlias.domain

    if (Object.prototype.hasOwnProperty.call(data.forwardMapping, origEmailKey) && data.forwardMapping[origEmailKey].length > 0) {
      newRecipients = newRecipients.concat(
        data.forwardMapping[origEmailKey])
      data.originalRecipient = origAlias.alias
    } else {
      if (emailDomain) {
        log.warn('bounce', { originalRecipient: origAlias.alias })
        const sendBounceParams = {
          BounceSender: `Mail Delivery Subsystem <mailer-daemon${emailDomain}>`,
          OriginalMessageId: data.email.messageId,
          MessageDsn: {
            ReportingMta: `dns; ${emailDomain}`,
            ArrivalDate: new Date(),
            ExtensionFields: []
          },
          Explanation: `Unable to deliver your message to <${origEmailKey}>: Recipient address rejected: User unknown in virtual mailbox table.`,
          BouncedRecipientInfoList: [
            {
              Recipient: origEmailKey,
              BounceType: 'DoesNotExist'
            }
          ]
        }
        const bounce = ses.sendBounce(sendBounceParams).promise()
        data.bounces.push(bounce)
      }
    }
  }
  return Promise.all(data.bounces).then(res => {
    if (!newRecipients.length) {
      return Promise.reject(new Error('No valid recipients.'))
    }
    data.recipients = newRecipients
    return Promise.resolve(data)
  })
}

const fetchMessage = (data) => {
  const params = {
    Bucket: bucketName,
    Key: data.email.messageId
  }
  return s3.getObject(params).promise()
    .then(result => {
      data.emailData = result.Body.toString()
      return data
    })
}

const processMessage = (data) => {
  const fromEmail = `ses-forward-daemon${data.originalRecipients[0].domain}`
  let match = data.emailData.match(/^((?:.+\r?\n)*)(\r?\n(?:.*\s+)*)/m)
  let header = match && match[1] ? match[1] : data.emailData
  const body = match && match[2] ? match[2] : ''

  // Add "Reply-To:" with the "From" address if it doesn't already exists
  if (!/^Reply-To: /mi.test(header)) {
    match = header.match(/^From: (.*(?:\r?\n\s+.*)*\r?\n)/m)
    const from = match && match[1] ? match[1] : ''
    if (from) {
      header = header + 'Reply-To: ' + from
      log.info('processMessage', { message: 'Added Reply-To address of: ' + from })
    } else {
      log.error('processMessage', {
        message: 'Reply-To address not added because ' +
       'From address was not properly extracted.'
      })
    }
  }

  // SES does not allow sending messages from an unverified address,
  // so replace the message's "From:" header with the original
  // recipient (which is a verified domain)
  header = header.replace(
    /^From: (.*(?:\r?\n\s+.*)*)/mg,
    function (match, from) {
      let fromText
      if (fromEmail) {
        if (from.indexOf('<') >= 0 && from.indexOf('>') >= 0) {
          fromText = 'From: ' + from.replace(/<(.*)>/, '').trim() + ' <' + fromEmail + '>'
        } else {
          fromText = 'From: ' + from.replace('@', ' at ').trim() + ' <' + fromEmail + '>'
        }
      } else {
        if (from.indexOf('<') >= 0 && from.indexOf('>') >= 0) {
          fromText = 'From: ' + from.replace('<', 'at ').replace('>', '') + ' <' + data.originalRecipient + '>'
        } else {
          fromText = 'From: ' + from.replace('@', ' at ').trim() + ' <' + data.originalRecipient + '>'
        }
      }
      return fromText
    })

  // Add a prefix to the Subject
  const subjectPrefix = ''
  const toEmail = ''
  if (subjectPrefix) {
    header = header.replace(
      /^Subject: (.*)/mg,
      function (match, subject) {
        return 'Subject: ' + subjectPrefix + subject
      })
  }

  // Replace original 'To' header with a manually defined one
  if (toEmail) {
    header = header.replace(/^To: (.*)/mg, () => 'To: ' + toEmail)
  }

  // Remove the Return-Path header.
  header = header.replace(/^Return-Path: (.*)\r?\n/mg, '')

  // Remove Sender header.
  header = header.replace(/^Sender: (.*)\r?\n/mg, '')

  // Remove Message-ID header.
  header = header.replace(/^Message-ID: (.*)\r?\n/mig, '')

  // Remove all DKIM-Signature headers to prevent triggering an
  // "InvalidParameterValue: Duplicate header 'DKIM-Signature'" error.
  // These signatures will likely be invalid anyways, since the From
  // header was modified.
  header = header.replace(/^DKIM-Signature: .*\r?\n(\s+.*\r?\n)*/mg, '')

  data.emailData = header + body
  return Promise.resolve(data)
}

const sendMessage = (data) => {
  const params = {
    Destinations: data.recipients,
    Source: data.originalRecipient,
    RawMessage: {
      Data: data.emailData
    }
  }
  log.info('sendMessage', {
    message: 'sendMessage: Sending email via SES. ' +
    'Original recipients: ' + data.originalRecipients.map(e => { return e.alias }).join(', ') +
    '. Transformed recipients: ' + data.recipients.join(', ') + '.'
  })
  return new Promise(function (resolve, reject) {
    ses.sendRawEmail(params, function (err, result) {
      if (err) {
        log.error({
          level: 'error',
          message: 'sendRawEmail() returned error.',
          error: err,
          stack: err.stack
        })
        return reject(new Error('Error: Email sending failed.'))
      }
      log.info('sendMessage', {
        message: 'sendRawEmail() successful.',
        result: result
      })
      resolve(data)
    })
  })
}
