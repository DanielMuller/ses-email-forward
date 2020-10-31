'use strict'

const setDefaults = (log, data) => {
  log.options.meta.messageId = data.messageId
  log.options.meta.recipient = data.recipient
  log.options.meta.source = data.source
  log.options.meta.from = data.from
}
module.exports = setDefaults
