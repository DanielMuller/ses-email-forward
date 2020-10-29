'use strict'
const log = require('lambda-log')

const AWS = require('aws-sdk')
const dynamodb = new AWS.DynamoDB.DocumentClient({ convertEmptyValues: true })
const tableNameBounces = process.env.IS_LOCAL === 'true' ? 'email-forward-bounces' : process.env.tableNameBounces
const oneDay = 60 * 60 * 24

module.exports.handler = async (event) => {
  log.info('Event', { event })
  const message = JSON.parse(event.Records[0].Sns.Message)
  log.info('Message', { message })

  const createdAt = Math.floor(Date.now() / 1000)
  let type = null
  let blacklistTTL = null
  if (message.notificationType === 'Bounce' && message.bounce) {
    blacklistTTL = message.bounce.bounceType === 'Transient' ? oneDay : 30 * oneDay
    type = 'bounce'
  }
  if (message.notificationType === 'Complaint' && message.complaint) {
    blacklistTTL = 2 * 365 * oneDay
    type = 'complaint'
  }

  if (type) {
    const validUntil = createdAt + blacklistTTL

    const requests = []
    const params = {
      RequestItems: {},
      ReturnConsumedCapacity: 'NONE',
      ReturnItemCollectionMetrics: 'NONE'
    }
    if (type === 'bounce') {
      message.bounce.bouncedRecipients.forEach(r => {
        requests.push({
          PutRequest: {
            Item: {
              destination: r.emailAddress,
              createdAt,
              validUntil,
              type: 'bounce',
              bounceType: message.bounce.bounceType,
              bounceSubType: message.bounce.bounceSubType,
              action: r.action,
              status: r.status,
              diagnosticCode: r.diagnosticCode
            }
          }
        })
      })
    }
    if (type === 'complaint') {
      message.complaint.complainedRecipients.forEach(r => {
        requests.push({
          PutRequest: {
            Item: {
              destination: r.emailAddress,
              createdAt,
              validUntil,
              type: 'complaint',
              feedbackId: message.complaint.feedbackId,
              userAgent: message.complaint.userAgent,
              complaintFeedbackType: message.complaint.complaintFeedbackType,
              arrivalDate: message.complaint.arrivalDate
            }
          }
        })
      })
    }
    params.RequestItems[tableNameBounces] = requests
    log.info('Bounce update', { params })
    await dynamodb.batchWrite(params).promise()
  }
  return true
}
