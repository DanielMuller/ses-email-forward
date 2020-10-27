'use strict'
function main (args) {
  const mainWidth = 12
  const mainHeight = 6

  const spamMetrics = [
    ['SES-Forward', 'pass', { color: '#2ca02c', label: 'Passed' }],
    ['.', 'spam', { color: '#ff7f0e', label: 'Rejected: SPAM' }],
    ['.', 'dmarc_reject', { color: '#d62728', label: 'Rejected: DMARC' }]
  ]
  const spamMetric = metricWidget(0, 0, 2 * mainWidth, mainHeight, spamMetrics, args.service.provider.region, 'Spam filtering')

  const logs = [
    {
      query: "SOURCE '${SpamLogGroup}' | fields @timestamp as timestamp, msg as reason, source, recipients.0 as recipient | filter _logLevel='info' AND (msg='spam' OR msg='dmarc-reject')\n| sort @timestamp desc\n| limit 400", // eslint-disable-line no-template-curly-in-string
      title: 'Rejected'
    },
    {
      query: "SOURCE '${ProcessLogGroup}' | fields @timestamp as timestamp, Records.0.ses.mail.commonHeaders.from.0 as source, Records.0.ses.receipt.recipients.0 as recipient\n| filter (_logLevel == 'info' AND msg='Event')\n| sort @timestamp desc", // eslint-disable-line no-template-curly-in-string
      title: 'Passed'
    },
    {
      query: "SOURCE '${ProcessLogGroup}' | fields @timestamp as timestamp, originalRecipient as recipient\n| filter (_logLevel = 'warn' AND msg = 'bounce')\n| sort @timestamp desc\n| limit 400", // eslint-disable-line no-template-curly-in-string
      title: 'Bounces'
    }
  ]

  const log = [
    logWidget(0, mainHeight, mainWidth, mainHeight, logs[0]),
    logWidget(mainWidth, mainHeight, mainWidth, mainHeight, logs[1]),
    logWidget(0, 2 * mainHeight, mainWidth, mainHeight, logs[2])
  ]

  const dashboard = {
    widgets: [
      spamMetric,
      ...log
    ]
  }
  return JSON.stringify(dashboard)
}

function metricWidget (x, y, width, height, metrics, region, title) {
  return {
    type: 'metric',
    x: x,
    y: y,
    width: width,
    height: height,
    properties: {
      metrics: metrics,
      view: 'timeSeries',
      stacked: false,
      region: region,
      stat: 'Sum',
      period: 300,
      title: title,
      yAxis: {
        left: {
          showUnits: false,
          min: 0
        },
        right: {
          showUnits: false
        }
      }
    }
  }
}

function logWidget (x, y, width, height, defs) {
  return {
    type: 'log',
    x: x,
    y: y,
    width: width,
    height: height,
    properties: {
      query: defs.query,
      region: 'eu-west-1',
      stacked: false,
      title: defs.title,
      view: 'table'
    }
  }
}

module.exports.main = main
