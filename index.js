#!/usr/bin/env node
var koa = require('koa')
var session = require('koa-session')
var cors = require('koa-cors')
var mount = require('koa-mount')
var bodyParser = require('koa-bodyparser')
var Grant = require('grant-koa')
var grant = new Grant(require('./config/grant'))
var route = require('koa-route')
var websockify = require('koa-websocket')

var googleGet = require('./server/websocket/google/get')
var googleAuth = require('./server/websocket/google/authorize')
var googleLogout = require('./server/websocket/google/logout')
var googleList = require('./server/websocket/google/list')

var helpers = require('./server/helpers')

var app = websockify(koa())

var version = require('./package.json').version

require('koa-qs')(app)

app.keys = ['grant']
var sess = session(app)

app.use(sess)
app.ws.use(sess)

app.use(bodyParser())
app.use(mount(grant))
app.use(cors({
  methods: 'GET,HEAD,PUT,POST,DELETE,OPTIONS',
  origin: function (req) {
    // You cannot allow multiple domains besides *
    // http://stackoverflow.com/a/1850482/151666
    // so we make it dynamic, depending on who is asking
    var originWhiteList = [ process.env.UPPY_ENDPOINT ]
    var origin = req.header.origin
    if (originWhiteList.indexOf(origin) !== -1) {
      return origin
    }
    return process.env.UPPY_ENDPOINT
  },
  credentials: true
}))

function routeMessage (message) {
  try {
    var parsedMessage = JSON.parse(message)
    this.websocket.emit(parsedMessage.action, parsedMessage.payload)
  } catch (err) {
    // not sure how we should be handling errors
    return err
  }
}

function wrapSend (sendFn) {
  return function (action, payload, options, cb) {
    if (typeof payload === 'function') {
      cb = payload
      return sendFn.call(this, action, cb)
    }

    var message = JSON.stringify({
      action,
      payload
    })

    sendFn.call(this, message, options, cb)
  }
}

function handleAuth (data) {
  var token = data.token

  if (token === null || typeof token === 'undefined') {
    console.log('im in here')
    console.log(data)
    // token = helpers.generateAndStoreToken(data.upgradeReq)
    console.log(token)
    this.websocket.send('uppy.token', {token})
  }
  console.log(token)
  var decoded = helpers.verifyToken(token)

  if (!decoded || !decoded.auth) {
  }

  this.websocket.sessionId = decoded.auth
  this.websocket.send('uppy.auth.pass')
}

app.ws.use(route.all('/', function * (next) {
  this.websocket.on('uppy.auth', handleAuth.bind(this))

  // this.websocket.on('uppy.createToken', createToken.bind(this))
  this.websocket.send = wrapSend(this.websocket.send).bind(this.websocket)
  app.context.websocket = this.websocket
  this.websocket.send('uppy.debug', 'websocket init')
  this.websocket.on('message', routeMessage.bind(this))
  this.websocket.on('google.get', googleGet.bind(this))
  this.websocket.on('google.auth', googleAuth.bind(this))
  this.websocket.on('google.logout', googleLogout.bind(this))
  this.websocket.on('google.list', googleList.bind(this))
  this.websocket.on('google.callback', (token) => {
    this.session.google.token = token
    this.websocket.send('google.auth.complete')
    this.websocket.send('google.auth.pass')
  })
}))

require('./server/routes')(app)

app.listen(3020)

console.log('Uppy-server ' + version + ' Listening on http://' + process.env.UPPYSERVER_DOMAIN + ':3020 servicing ' + process.env.UPPY_ENDPOINT)
