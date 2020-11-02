'use strict'

const dnsPromises = require('dns').promises

const mxExists = emails => {
  return new Promise((resolve, reject) => {
    const hostnames = [...new Set(emails.map(email => email.split('@')[1]))]
    const checks = []
    try {
      hostnames.forEach(hostname => {
        const check = dnsPromises.resolveMx(hostname).then(addresses => {
          let response = false
          if (addresses && addresses.length > 0) {
            response = !!addresses[0].exchange
          }
          return response
        })
          .catch(err => { // eslint-disable-line node/handle-callback-err
            return false
          })
        checks.push(check)
      })
      Promise.all(checks).then(res => {
        const checker = res.every(v => v === true)
        resolve(checker)
      })
    } catch (err) {
      resolve(false)
    }
  })
}

module.exports = {
  mxExists
}
