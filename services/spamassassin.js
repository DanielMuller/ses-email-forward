'use strict'

const parseEvent = require('../lib/parseEvent')
const logDefaults = require('../lib/logDefaults')
const spamCheck = require('../lib/spamCheck')
const log = require('lambda-log')
const spamThreshold = 5.0
const fromBlacklist = [
  'schweizer verdienen',
  'crestprojects.co.in'
]

exports.handler = (event, context, callback) => {
  const data = parseEvent(event)

  if (data) {
    logDefaults(log, data)

    log.info('event', { event, receipt: data.receipt })

    let blacklist = false
    fromBlacklist.forEach(str => {
      if (data.from.toLowerCase().includes(str.toLowerCase())) {
        blacklist = true
      }
    })
    if (blacklist) {
      log.info('reject', { reason: 'spamassassin', rule: 'from-blacklisted', recipients: data.recipients, receipt: data.receipt })
      callback(null, { disposition: 'STOP_RULE_SET' })
    } else {
      spamCheck(data.messageId).then(res => {
        log.info('spamassassin', { result: res })
        if (res.success === true) {
          if (parseFloat(res.score) > spamThreshold) {
            log.info('reject', { reason: 'spamassassin', rule: 'postmarkapp', score: parseFloat(res.score), recipients: data.recipients, receipt: data.receipt })
            callback(null, { disposition: 'STOP_RULE_SET' })
          } else {
            log.info('pass', { reason: 'spamassassin', rule: 'postmarkapp', score: parseFloat(res.score), recipients: data.recipients, receipt: data.receipt })
            callback()
          }
        } else {
          log.info('fail', { reason: 'spamassassin', success: res.success, score: parseFloat(res.score), recipients: data.recipients, receipt: data.receipt })
          callback()
        }
      })
    }
  } else {
    log.error('event', { type: 'invalid', event })
    callback(null, { disposition: 'STOP_RULE_SET' })
  }
}
