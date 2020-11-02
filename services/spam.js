'use strict'

const parseEvent = require('../lib/parseEvent')
const logDefaults = require('../lib/logDefaults')
const mxCheck = require('../lib/mxCheck')
const log = require('lambda-log')

exports.handler = (event, context, callback) => {
  const data = parseEvent(event)

  if (data) {
    logDefaults(log, data)

    log.info('event', { event, receipt: data.receipt })

    // Check if any spam check failed
    if (data.receipt.spfVerdict.status === 'FAIL' ||
              data.receipt.dkimVerdict.status === 'FAIL' ||
              data.receipt.spamVerdict.status === 'FAIL' ||
              data.receipt.virusVerdict.status === 'FAIL') {
      // Stop processing rule set, dropping message
      let reason = 'unknown'
      if (data.receipt.spamVerdict.status === 'FAIL') {
        reason = 'spam'
      } else if (data.receipt.virusVerdict.status === 'FAIL') {
        reason = 'virus'
      } else if (data.receipt.dkimVerdict.status === 'FAIL') {
        reason = 'dkim'
      } else if (data.receipt.spfVerdict.status === 'FAIL') {
        reason = 'spf'
      }
      log.info('reject', { reason, recipients: data.recipients, receipt: data.receipt })
      callback(null, { disposition: 'STOP_RULE_SET' })
    } else {
      // If DMARC verdict is FAIL and the sending domain's policy is REJECT
      // (p=reject), bounce the email.
      if (data.receipt.dmarcVerdict.status === 'FAIL' &&
            data.receipt.dmarcPolicy.toLowerCase() === 'reject') {
        log.info('reject', { reason: 'dmarc' })
        callback(null, null)
      } else {
        const toCheck = [
          data.source,
          data.email.commonHeaders.returnPath.replace(/^.*</, '').replace(/>.*$/, ''),
          data.from.replace(/^.*</, '').replace(/>.*$/, '')
        ]
        mxCheck.mxExists(toCheck).then(res => {
          if (res) {
            log.info('pass', { recipients: data.recipients, receipt: data.receipt })
            callback(null, { disposition: 'STOP_RULE' })
          } else {
            log.info('reject', { reason: 'no-mx', recipients: data.recipients, receipt: data.receipt })
            callback(null, { disposition: 'STOP_RULE_SET' })
          }
        })
      }
    }
  } else {
    log.error('event', { type: 'invalid', event })
    callback(null, { disposition: 'STOP_RULE_SET' })
  }
}
