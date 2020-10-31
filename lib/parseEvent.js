'use strict'

const validateEvent = event => {
  const data = {}
  // Validate characteristics of a SES event record.

  if (!event ||
      !Object.prototype.hasOwnProperty.call(event, 'Records') ||
      event.Records.length !== 1 ||
      !Object.prototype.hasOwnProperty.call(event.Records[0], 'eventSource') ||
      event.Records[0].eventSource !== 'aws:ses' ||
      event.Records[0].eventVersion !== '1.0') {
    return null
  }

  try {
    data.messageId = event.Records[0].ses.mail.messageId
    data.source = event.Records[0].ses.mail.source
    data.from = event.Records[0].ses.mail.commonHeaders.from[0]
    data.email = event.Records[0].ses.mail
    data.receipt = event.Records[0].ses.receipt
    data.recipients = event.Records[0].ses.receipt.recipients
    data.recipient = event.Records[0].ses.receipt.recipients[0]

    return data
  } catch (err) {
    return null
  }
}

module.exports = validateEvent
