'use strict'
const log = require('lambda-log')

const AWS = require('aws-sdk')
const lambda = new AWS.Lambda()
const buildFct = process.env.IS_LOCAL === 'true' ? 'sesEmailForward-buildForwards' : process.env.buildFct

module.exports.handler = async (event) => {
  log.info('Event', { event })

  const domains = []
  event.Records.forEach(r => {
    if (r.dynamodb && r.dynamodb.Keys && r.dynamodb.Keys.domain && r.dynamodb.Keys.domain.S) {
      const d = r.dynamodb.Keys.domain.S.trim()
      if (!domains.includes(d)) {
        domains.push(d)
      }
    }
  })

  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i]
    const params = {
      FunctionName: buildFct,
      InvocationType: 'Event',
      LogType: 'None',
      Payload: JSON.stringify({ domain })
    }
    log.info('Invoke Build', { params })
    await lambda.invoke(params).promise()
  }
  return true
}
