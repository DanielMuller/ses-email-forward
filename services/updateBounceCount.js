'use strict'
const log = require('lambda-log')

const AWS = require('aws-sdk')
const dynamodb = new AWS.DynamoDB.DocumentClient({ convertEmptyValues: true })
const tableNameAliases = process.env.IS_LOCAL === 'true' ? 'email-forward-aliases' : process.env.tableNameAliases
const tableNameBounces = process.env.IS_LOCAL === 'true' ? 'email-forward-bounces' : process.env.tableNameBounces

module.exports.handler = async (event) => {
  log.info('Event', { event })
  const updatedAt = Math.floor(Date.now() / 1000)

  const batchUpdates = []
  for (let i = 0; i < event.Records.length; i++) {
    const r = event.Records[i]
    if (r.dynamodb && r.dynamodb.Keys && r.dynamodb.Keys.destination && r.dynamodb.Keys.destination.S) {
      const destination = r.dynamodb.Keys.destination.S.trim()
      const bounces = await getBounces(destination)
      const updates = await getAliaseUpdates(destination, bounces)
      for (let j = 0; j < updates.length; j++) {
        const params = {
          TableName: tableNameAliases,
          Key: {
            destination: updates[j].destination,
            alias: updates[j].alias
          },
          UpdateExpression: 'set #bounces = :bounces, #updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#bounces': 'bounces',
            '#updatedAt': 'updatedAt'
          },
          ExpressionAttributeValues: {
            ':bounces': bounces,
            ':updatedAt': updatedAt
          }
        }
        const update = dynamodb.update(params).promise()
        batchUpdates.push(update)
      }
    }
  }
  await Promise.all(batchUpdates)
  return true
}

const getBounces = async (destination) => {
  const params = {
    TableName: tableNameBounces,
    Select: 'COUNT',
    KeyConditionExpression: '#destination = :destination',
    ExpressionAttributeValues: {
      ':destination': destination
    },
    ExpressionAttributeNames: {
      '#destination': 'destination'
    }
  }
  const res = await dynamodb.query(params).promise()
  return res.Count
}

const getAliaseUpdates = async (destination, bounces) => {
  const params = {
    TableName: tableNameAliases,
    IndexName: 'destinationIndex',
    KeyConditionExpression: '#destination = :destination',
    ExpressionAttributeValues: {
      ':destination': destination
    },
    ExpressionAttributeNames: {
      '#destination': 'destination'
    }
  }
  const batchUpdates = []
  let items
  do {
    items = await dynamodb.query(params).promise()
    items.Items.forEach((item) => {
      const alias = item.alias.trim().toLowerCase()
      const destination = item.destination.trim().toLowerCase()
      batchUpdates.push({ alias, destination, bounces })
    })
    params.ExclusiveStartKey = items.LastEvaluatedKey
  } while (typeof items.LastEvaluatedKey !== 'undefined')
  return batchUpdates
}
