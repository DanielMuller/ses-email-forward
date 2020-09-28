'use strict'
const log = require('lambda-log')

const AWS = require('aws-sdk')
const dynamodb = new AWS.DynamoDB.DocumentClient({ convertEmptyValues: true })
const tableNameAliases = process.env.IS_LOCAL === 'true' ? 'email-forward-aliases' : process.env.tableNameAliases
const tableNameDefinitions = process.env.IS_LOCAL === 'true' ? 'email-forward-definitions' : process.env.tableNameDefinitions
const tableNameBounces = process.env.IS_LOCAL === 'true' ? 'email-forward-bounces' : process.env.tableNameBounces
var mapping = {}
var resolvedMapping = {}
var forwardMapping = []
var domain = ''
var bounceCountCache = {}

module.exports.handler = async (event) => {
  log.info('Event', { event })

  resolvedMapping = {}
  forwardMapping = []
  bounceCountCache = {}

  domain = event.domain
  mapping = await fetchItems()

  for (const [alias, destinations] of Object.entries(mapping)) {
    destinations.forEach(el => {
      resolvedMapping[alias] = resolveDestinations(destinations).sort().filter((el, i, a) => { return i === a.indexOf(el) })
    })
  }
  log.info('resolvedMapping', { domain, resolvedMapping })

  for (const [alias, destinations] of Object.entries(resolvedMapping)) {
    for (let i = 0; i < destinations.length; i++) {
      const destination = destinations[i]
      const bounces = await getBounces(destination)
      const item = {
        alias: `${alias}@${domain}`,
        destination,
        bounces
      }

      forwardMapping.push(item)
    }
  }

  log.info('forwardMapping', { domain, forwardMapping })

  var batchUpdate = []
  const updatedAt = Math.floor(Date.now() / 1000)
  const batchSize = 25
  for (let i = 0; i < forwardMapping.length; i++) {
    const batchId = Math.floor(i / batchSize)
    if (!(batchId in batchUpdate)) {
      batchUpdate[batchId] = {
        RequestItems: {}
      }
      batchUpdate[batchId].RequestItems[tableNameAliases] = []
    }
    const item = { ...forwardMapping[i] }
    item.domain = domain
    item.updatedAt = updatedAt
    batchUpdate[batchId].RequestItems[tableNameAliases].push({
      PutRequest: {
        Item: item
      }
    })
  }

  log.info('batchUpdate', { domain, batchUpdate })

  for (let i = 0; i < batchUpdate.length; i++) {
    await dynamodb.batchWrite(batchUpdate[i]).promise()
  }

  await deleteObsolete(updatedAt)
}

const fetchItems = async () => {
  const params = {
    TableName: tableNameDefinitions,
    KeyConditionExpression: '#domain = :domain',
    ExpressionAttributeValues: {
      ':domain': domain
    },
    ExpressionAttributeNames: {
      '#domain': 'domain'
    }
  }
  const queryResults = {}
  let items
  do {
    items = await dynamodb.query(params).promise()
    items.Items.forEach((item) => {
      const alias = item.alias.trim().toLowerCase()
      const destinations = item.destinations.map(item => { return item.trim() }).map(item => { return item.replace(`@${domain}`, '').toLowerCase() })
      queryResults[alias] = destinations
    })
    params.ExclusiveStartKey = items.LastEvaluatedKey
  } while (typeof items.LastEvaluatedKey !== 'undefined')
  return queryResults
}

const deleteObsolete = async (updatedAt) => {
  const fetchParams = {
    TableName: tableNameAliases,
    IndexName: 'domainUpdatedAtIndex',
    KeyConditionExpression: '#domain = :domain and #updatedAt < :updatedAt',
    ExpressionAttributeValues: {
      ':domain': domain,
      ':updatedAt': updatedAt
    },
    ExpressionAttributeNames: {
      '#domain': 'domain',
      '#updatedAt': 'updatedAt'
    }
  }
  let items
  do {
    items = await dynamodb.query(fetchParams).promise()
    log.info('toDelete', { domain, items })
    if (items.Items.length > 0) {
      const toDelete = { RequestItems: {} }
      toDelete.RequestItems[tableNameAliases] = items.Items.map(item => {
        return {
          DeleteRequest: {
            Key: {
              alias: item.alias,
              destination: item.destination
            }
          }
        }
      })
      log.info('toDelete', { domain, toDelete })
      await dynamodb.batchWrite(toDelete).promise()
    }
    fetchParams.ExclusiveStartKey = fetchParams.LastEvaluatedKey
  } while (typeof items.LastEvaluatedKey !== 'undefined')
  return true
}

const resolveDestinations = (destinations) => {
  const resolved = []
  destinations.forEach(d => {
    if (d.indexOf('@') > -1) {
      resolved.push(d.trim())
    } else {
      resolved.push(...resolveDestinations(mapping[d]))
    }
  })
  return resolved
}

const getBounces = async (destination) => {
  if (destination in bounceCountCache) {
    return bounceCountCache[destination]
  }
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
  bounceCountCache[destination] = res.Count
  return res.Count
}
