'use strict'
const parseEvent = require('../lib/parseEvent')
const logDefaults = require('../lib/logDefaults')
const log = require('lambda-log')

const AWS = require('aws-sdk')
const s3 = new AWS.S3()
const ses = new AWS.SES()
const dynamodb = new AWS.DynamoDB.DocumentClient({ convertEmptyValues: true })
const bucketName = process.env.IS_LOCAL === 'true' ? 'email-forward-eu-west-1' : process.env.bucketName
const tableNameAliases = process.env.IS_LOCAL === 'true' ? 'email-forward-aliases' : process.env.tableNameAliases
const tableNameDomains = process.env.IS_LOCAL === 'true' ? 'email-forward-domains' : process.env.tableNameDomains

const bounceLimit = 0

module.exports.handler = (event, context, callback) => {
  const data = parseEvent(event)

  if (data) {
    logDefaults(log, data)

    log.info('event', { event })

    fetchRecipients(data)
      .then(fetchDomainAlias)
      .then(rewriteDomains)
      .then(fetchMapping)
      .then(transformRecipients)
      .then(fetchMessage)
      .then(processMessage)
      .then(sendMessage)
      .then((data) => {
        log.info('end', { data })
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
    log.error('event', { type: 'Invalid', event })
    callback(null, { disposition: 'STOP_RULE_SET' })
  }
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
    return {
      alias: '',
      domain: ''
    }
  }).filter(item => item.emailDomain !== '')

  return new Promise((resolve, reject) => {
    resolve(data)
  })
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
  data.bounceReason = {}
  data.originalRecipients.forEach((originalRecipient) => {
    const params = {
      TableName: tableNameAliases,
      KeyConditionExpression: 'alias = :recipient',
      FilterExpression: 'attribute_not_exists(bounces) or bounces = :null or bounces <= :bounceLimit',
      ExpressionAttributeValues: {
        ':recipient': originalRecipient.alias,
        ':bounceLimit': bounceLimit,
        ':null': null
      }
    }
    const mapping = dynamodb.query(params).promise()
      .then(res => {
        let bounceReason = 'none'
        if (res.Count === 0) {
          bounceReason = (res.ScannedCount > 0) ? 'blacklisted' : 'noexist'
        }
        data.bounceReason[originalRecipient.alias] = bounceReason
        data.forwardMapping[originalRecipient.alias] = res.Items.map(item => item.destination)
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
        log.info('bounce', { reason: data.bounceReason[origEmailKey] })
        if (process.env.IS_LOCAL !== 'true') {
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
  }
  return Promise.all(data.bounces).then(res => {
    if (!newRecipients.length) {
      return Promise.reject(new Error('No valid recipients.'))
    }
    data.newRecipients = newRecipients
    return Promise.resolve(data)
  })
}

const fetchMessage = (data) => {
  const params = {
    Bucket: bucketName,
    Key: data.messageId
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
    Destinations: data.newRecipients,
    Source: data.originalRecipient,
    RawMessage: {
      Data: data.emailData
    }
  }

  const logData = {
    recipients: data.originalRecipients.map(e => { return e.alias }).join(', '),
    recipientsList: data.originalRecipients.map(e => { return e.alias }),
    recipientsCount: data.originalRecipients.map(e => { return e.alias }).length,
    destinations: data.newRecipients.join(', '),
    destinationsList: data.newRecipients,
    destinationsCount: data.newRecipients.length
  }
  return new Promise(function (resolve, reject) {
    ses.sendRawEmail(params, function (err, result) {
      if (err) {
        log.error('sendMessage', {
          reason: 'failure',
          error: err,
          stack: err.stack,
          ...logData
        })
        return reject(new Error('Error: Email sending failed.'))
      }
      log.info('sendMessage', {
        reason: 'success',
        result: result,
        ...logData
      })
      resolve(data)
    })
  })
}
