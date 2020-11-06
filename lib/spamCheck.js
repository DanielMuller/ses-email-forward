'use strict'
const AWS = require('aws-sdk')
const s3 = new AWS.S3()
const bucketName = process.env.IS_LOCAL === 'true' ? 'email-forward-eu-west-1' : process.env.bucketName
const https = require('https')

const spamCheck = messageId => {
  return fetchMessage(messageId)
    .then(callPostmark)
    .then(res => {
      return JSON.parse(res.toString())
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

const callPostmark = (emailData) => {
  const data = JSON.stringify({
    email: emailData,
    options: 'long'
  })

  const options = {
    hostname: 'spamcheck.postmarkapp.com',
    port: 443,
    path: '/filter',
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  }

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      res.on('data', d => {
        resolve(d)
      })
    })

    req.on('error', error => {
      reject(error)
    })

    req.write(data)
    req.end()
  })
}

module.exports = spamCheck
