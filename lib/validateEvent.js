'use strict'
const log = require('lambda-log')

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

export default validateEvent
