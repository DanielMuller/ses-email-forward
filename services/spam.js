'use strict'
const log = require('lambda-log')

exports.handler = (event, context, callback) => {
  const data = validateEvent(event)
  if (data) {
    const sesNotification = event.Records[0].ses
    log.info('Message', { receipt: sesNotification.receipt, source: sesNotification.mail.source })

    // Check if any spam check failed
    if (sesNotification.receipt.spfVerdict.status === 'FAIL' ||
              sesNotification.receipt.dkimVerdict.status === 'FAIL' ||
              sesNotification.receipt.spamVerdict.status === 'FAIL' ||
              sesNotification.receipt.virusVerdict.status === 'FAIL') {
      // Stop processing rule set, dropping message
      log.info('spam', { recipients: sesNotification.receipt.recipients, source: sesNotification.mail.source })
      callback(null, { disposition: 'STOP_RULE_SET' })
    } else {
      // If DMARC verdict is FAIL and the sending domain's policy is REJECT
      // (p=reject), bounce the email.
      if (sesNotification.receipt.dmarcVerdict.status === 'FAIL' &&
            sesNotification.receipt.dmarcPolicy.status === 'REJECT') {
        log.info('dmarc-reject', { recipients: sesNotification.receipt.recipients, source: sesNotification.mail.source })
        callback(null, null)
      } else {
        log.info('pass', { recipients: sesNotification.receipt.recipients, source: sesNotification.mail.source })
        callback(null, { disposition: 'STOP_RULE' })
      }
    }
  } else {
    callback(null, { disposition: 'STOP_RULE_SET' })
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
