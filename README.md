# Functions split
Boilerplate template for [Serverless](https://serverless.com) allowing to easily separate each function into it's own dedicated file or folder.

The template is for [NodeJS 12.x](https://nodejs.org/) and it uses [webpack plugin](https://github.com/serverless-heaven/serverless-webpack) to reduce each packaged function.

## Project creation
`sls create --template-url https://github.com/Spuul/serverless-template-aws-webpack-nodejs/tree/master/ --path my-new-service --name awesome-service`

### Configuration
Edit *config/dev.yml* and *config/production.yml* to suit your needs.

Run `nvm use` to load the right node version and `npm install` to install all the dependencies.

## File structure
- **events/**  
  Store all events related to testing
- **lib/config.js**  
  Javascript module to build serverless.yml
- **resources/**  
  Contains yml files describing each resource. Definitions can be nested 2 levels deep, in a subfolder describing the AWS resource, like `IamRole/specificServiceRole.yml`.
  The folder name is expected to follow [Serverless convention](https://serverless.com/framework/docs/providers/aws/guide/resources#aws-cloudformation-resource-reference) for naming.
- **services/**  
  Contains each individual Lambda function (.js) and it's definitions (.yml).
  In addition to the usual *handler* and *event* definitions, the yml can also hold a specific *resource* definition related to the function, without the need for an entry in the *resources/* folder.
- **stages/**  
  Stage specific configurations.

## Deploy
`sls deploy` (development) or `sls -s production deploy`

### Webpack
Webpack will automatically bundle only the used dependencies and create a unique and smaller bundle for each function.

## Logging
[lambda-log](https://www.npmjs.com/package/lambda-log) provides a more structured way of logging:
```javascript
const log = require('lambda-log')
log.info('Log Tag', {key1: value1, key2: value2})
```
Which will result in:
```
{"_logLevel":"info","msg":"Log Tag","key1":"value1","key2":"value2","_tags":["log","info"]}
```
You can also add meta data by default:
```
log.options.meta.fct = 'fctName'
log.options.meta.requestId = event.requestContext.requestId
log.options.meta.path = event.path
log.options.meta.sourceIp = event.requestContext.identity.sourceIp
```
