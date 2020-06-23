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

## Setup
```bash
git clone https://github.com/DanielMuller/ses-email-forward
cd ses-email-forward/
nvm use
npm ci
cp -a stages/production.sample.yml stages/production.yml
```
Edit stages/production.yml to suite your setup.

## Whitelist domains
You need to whitelist all domains that you want to use. Including domain aliases and the domain used for global bounces defined in the settings as _sender_.

## Deploy
```bash
npx serverless deploy
```

## Configure aliases
There is no UI to manage aliases, all aliases are manually entered into DynamoDB (Console, CLI, ...).

### Domain aliases
```json
{
  "domain": "example.com",
  "aliasfor": "another-example.com"
}
```

### EMail aliases
To redirect to multiple users (group feature), create as many entries as destinations.

```json
{
  "alias": "john@example.com",
  "destination": "jonh@gmail.com"
}
```

## Update MX
Update your domain's MX to point to `10 inbound-smtp.<AWS Region>.amazonaws.com.`

## Function
### Spam
All domains are passed through the spam rules:
* Messages tagged as SPAM are silently dropped
* Messages not passing DMARC are bounced back to the sender

### Forward
* Messages not intended for a valid recipient are bounced back to the sender.

## Todo
### Cloudwatch dashboard
* Add dashboards to have an overview of rejected, bounced and delivered messages

### Handle bounces and complaints
* Add SNS and Lambda processors to handle bounces and complaints
* Blacklist bouncing recipients
