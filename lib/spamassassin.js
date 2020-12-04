'use strict'
const AWS = require('aws-sdk')
const s3 = new AWS.S3()
const bucketName = process.env.IS_LOCAL === 'true' ? 'email-forward-eu-west-1' : process.env.bucketName
const lambda = new AWS.Lambda()

const spamCheck = messageId => {
  return fetchMessage(messageId)
    .then(callSpamassassin)
    .then(res => {
      return JSON.parse(res.Payload)
    })
}

const fetchMessage = (messageId) => {
  const params = {
    Bucket: bucketName,
    Key: messageId
  }
  return s3.getObject(params).promise()
    .then(result => {
      return result.Body.toString()
    })
}

const callSpamassassin = (body) => {
  const params = {
    FunctionName: 'spamd',
    LogType: 'None',
    Payload: JSON.stringify({ body })
  }
  return lambda.invoke(params).promise()
}

module.exports = spamCheck
