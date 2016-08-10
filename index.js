#!/usr/bin/env node
var koa = require('koa')
var session = require('koa-session')
var cors = require('koa-cors')
var mount = require('koa-mount')
var bodyParser = require('koa-bodyparser')
var Grant = require('grant-koa')
var grant = new Grant(require('./config/grant'))
var SocketServer = require('ws').Server

var app = koa()

var version = require('./package.json').version

require('koa-qs')(app)

app.keys = ['grant']
app.use(session(app))

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

require('./server/routes')(app)

var server = app.listen(3020)

var wss = new SocketServer({
  server: server
})

var emitter = require('./WebsocketEmitter')

wss.on('connection', function (ws) {
  var fullPath = ws.upgradeReq.url
  console.log(fullPath)

  var token = fullPath.replace(/\/api\//, '')
  console.log(token)

  console.log('Client connected')

  function sendProgress (data) {
    console.log(data)
    ws.send(data, function (err) {
      console.log('Error: ' + err)
    })
  }

  emitter.on('google:' + token, sendProgress)

  ws.on('close', function () {
    emitter.removeListener('google:' + token, sendProgress)
    console.log('Client disconnected')
  })
})

console.log('Uppy-server ' + version + ' Listening on http://' + process.env.UPPYSERVER_DOMAIN + ':3020 servicing ' + process.env.UPPY_ENDPOINT)
