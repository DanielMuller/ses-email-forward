# SES Email Forward
Uses SES incoming SMTP to forward E-mails to the final recipient, based on https://github.com/arithmetric/aws-lambda-ses-forwarder. Useful for small domains, where you don't want users to manage another Inbox.

Address aliases are stored in a DynamoDB table.

## Disclaimer
### From rewrite
SES can only send from a validated domain. To be able to forward any "From domain", it needs to be rewritten.

`John Doe <john.doe@corporation.com>` sends a message to `bob@example.com`.

The message will be forwarded to `bob@gmail.com` with the new sender `John Doe <forwarder-daemon@example.com>` and a `Reply-To: John Doe <john.doe@corporation.com>`.

## Prerequisites
* An AWS account
* A role with the relevant rights (Administrator if you are lazy)
* NodeJS 12, ideally with nvm
* Use a region in which "EMail Receiving" is available
* Manually created SNS queues for bounces and complaints. All domains need to use the same queues

## Whitelist domains
You need to whitelist all domains that you want to use. Including domain aliases and the domain used for global bounces defined in the settings as _sender_.

## Setup
```bash
git clone https://github.com/DanielMuller/ses-email-forward
cd ses-email-forward/
nvm use
npm ci
cp -a stages/production.sample.yml stages/production.yml
```
Edit stages/production.yml to suite your setup.

## Deploy
```bash
npx serverless deploy
```

## Configure aliases
You can use [ses-email-forward-ui](https://github.com/DanielMuller/ses-email-forward-ui), or fill them manually in DynamoDB (console, CLI, ...)

### Domain aliases
```json
{
  "domain": "example.com",
  "aliasfor": "another-example.com"
}
```

### EMail definitions
To redirect to a locally defined alias, omit the domain. Every change in the definition table will trigger a Lambda function that popoulates the alias table. Multiple destinations are entered as an array.

```json
{
  "active": true,
  "alias": "info",
  "destinations": [
    "bob@example.com",
    "john"
  ],
  "domain": "mycorp.com",
  "type": "group"
}
```
```json
{
  "active": true,
  "alias": "john",
  "destinations": [
    "john@example.com"
  ],
  "domain": "mycorp.com",
  "type": "person"
}
```

## Update MX
Update your domain's MX to point to `10 inbound-smtp.<AWS Region>.amazonaws.com.`

## Bounces and Complaints
* Transient Bounces are stored for 1 day
* Permanent Bounces are stored for 30 days
* Complaints are stored for 2 years

Every change in the bounce log table (insertion, deletion) triggers an update on the bounce count. Destinations with a least one bounce count aren't used anymore. Messages to this destinations are silently dropped.

## Functions
### Spam
All domains are passed through the spam rules:
* Messages tagged as SPAM are silently dropped
* Messages not passing DMARC are bounced back to the sender

### Forward
* Messages not intended for a valid recipient are bounced back to the sender.

### TriggerBuild
* Triggers `BuildForwards` for every change in the definition table.

### BuildForwards
* Builds the aliases list from the definition table. Omitting previously bounced destinations and avoiding duplicate destinations.

### BounceOrComplaint
* Populates the bounce and complaint table.

### UpdateBounceCount
* Updates bounce counters in the alias table.

## Todo
### Cloudwatch dashboard
* Add dashboards to have an overview of rejected, bounced and delivered messages
