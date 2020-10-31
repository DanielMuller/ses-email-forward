'use strict'
function main (args) {
  const mainWidth = 12
  const mainHeight = 6

  const spamPassBaseMetrics = [
    ['SES-Forward', 'pass', { color: '#2ca02c', id: 'm1', label: 'Passed' }],
    ['.', 'reject', { color: '#d62728', id: 'm2', label: 'Rejected' }]
  ]
  const spamPassMetrics = [
    ...spamPassBaseMetrics,
    [{ expression: 'SUM(METRICS())', color: '#005bed', label: 'Total', id: 'e1' }]
  ]

  const sentBounceBaseMetrics = [
    ['SES-Forward', 'delivered-success', { color: '#2ca02c', id: 'm1', label: 'Delivered' }],
    ['.', 'bounce-noexist', { color: '#fa9214', id: 'm2', label: 'Inexistant' }],
    ['.', 'bounce-blacklisted', { color: '#d62728', id: 'm3', label: 'No destination' }]
  ]

  const sentBounceMetrics = [
    ...sentBounceBaseMetrics,
    [{ expression: 'SUM(METRICS())', color: '#005bed', label: 'Total', id: 'e1' }]
  ]

  const spamPassCounter = counterWidget(0, 0, mainWidth / 2, mainHeight, spamPassMetrics, args.service.provider.region, 'Pass/Reject Counters')
  const spamPassPie = pieWidget(mainWidth / 2, 0, mainWidth / 2, mainHeight, spamPassBaseMetrics, args.service.provider.region, 'Pass/Reject Ratio')
  const sentBounceCounter = counterWidget(mainWidth, 0, mainWidth / 2, mainHeight, sentBounceMetrics, args.service.provider.region, 'Sent/Bounce Counters')
  const sentBouncePie = pieWidget(1.5 * mainWidth, 0, mainWidth / 2, mainHeight, sentBounceBaseMetrics, args.service.provider.region, 'Sent/Bounce Ratio')

  const msgMetrics = [
    ['SES-Forward', 'reject-spam', { color: '#bc2d02', label: 'Rejected: SPAM' }],
    ['.', 'reject-virus', { color: '#a80000', label: 'Rejected: Virus' }],
    ['.', 'reject-dkim', { color: '#d15a04', label: 'Rejected: DKIM' }],
    ['.', 'reject-spf', { color: '#e68706', label: 'Rejected: SPF' }],
    ['.', 'reject-dmarc', { color: '#fbb509', label: 'Rejected: DMARC' }],
    ['.', 'bounce-noexist', { color: '#0a84ff', label: 'Bounced: Inexistant' }],
    ['.', 'bounce-blacklisted', { color: '#0a16ff', label: 'Bounced: No destination' }],
    ['.', 'delivered-success', { color: '#009408', label: 'Delivered' }],
    ['.', 'delivered-failure', { color: '#bd00b0', label: 'Failed' }]
  ]
  const msgMetric = metricWidget(0, mainHeight, 2 * mainWidth, mainHeight, msgMetrics, args.service.provider.region, 'Messages statuses')

  const logs = [
    {
      query: "SOURCE '${SpamLogGroup}' | fields @timestamp as timestamp,reason,from,recipient | filter _logLevel='info' and msg='reject' | sort @timestamp desc | limit 1000", // eslint-disable-line no-template-curly-in-string
      title: 'Rejected'
    },
    {
      query: "SOURCE '${ProcessLogGroup}' | fields @timestamp as timestamp,reason,from,recipient | filter _logLevel='info' and msg='bounce' | sort @timestamp desc | limit 1000", // eslint-disable-line no-template-curly-in-string
      title: 'Bounces'
    },
    {
      query: "SOURCE '${ProcessLogGroup}' | fields @timestamp as timestamp,from,recipient| filter _logLevel='info' and msg='sendMessage' and reason='success'| sort @timestamp desc| limit 1000", // eslint-disable-line no-template-curly-in-string
      title: 'Sent'
    },
    {
      query: "SOURCE '${ProcessLogGroup}' | fields @timestamp as timestamp,from,recipient| filter _logLevel='info' and msg='sendMessage' and reason='failure'| sort @timestamp desc| limit 1000", // eslint-disable-line no-template-curly-in-string
      title: 'Errors'
    }
  ]

  const log = [
    logWidget(0, 2 * mainHeight, mainWidth, mainHeight, args.service.provider.region, logs[0]),
    logWidget(mainWidth, 2 * mainHeight, mainWidth, mainHeight, args.service.provider.region, logs[1]),
    logWidget(0, 3 * mainHeight, mainWidth, mainHeight, args.service.provider.region, logs[2]),
    logWidget(mainWidth, 3 * mainHeight, mainWidth, mainHeight, args.service.provider.region, logs[3])
  ]

  const dashboard = {
    widgets: [
      spamPassCounter,
      spamPassPie,
      sentBounceCounter,
      sentBouncePie,
      msgMetric,
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
      metrics,
      view: 'timeSeries',
      stacked: false,
      region,
      stat: 'Sum',
      period: 300,
      title,
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

function counterWidget (x, y, width, height, metrics, region, title) {
  return {
    type: 'metric',
    x: x,
    y: y,
    width: width,
    height: height,
    properties: {
      metrics,
      view: 'singleValue',
      region,
      setPeriodToTimeRange: true,
      stat: 'Sum',
      period: 300,
      title
    }
  }
}

function pieWidget (x, y, width, height, metrics, region, title) {
  return {
    type: 'metric',
    x: x,
    y: y,
    width: width,
    height: height,
    properties: {
      metrics,
      view: 'pie',
      region,
      stat: 'Sum',
      period: 300,
      setPeriodToTimeRange: true,
      title
    }
  }
}

function logWidget (x, y, width, height, region, defs) {
  return {
    type: 'log',
    x: x,
    y: y,
    width: width,
    height: height,
    properties: {
      query: defs.query,
      region,
      stacked: false,
      title: defs.title,
      view: 'table'
    }
  }
}

module.exports.main = main
