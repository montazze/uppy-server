const fs = require('fs')
const path = require('path')
const tus = require('tus-js-client')
const uuid = require('uuid')
const emitter = require('./WebsocketEmitter')
const request = require('request')

class Uploader {
  constructor (options) {
    this.options = options
    this.writer = fs.createWriteStream(options.path)
    this.token = uuid.v4()
    this.emittedProgress = 0
  }

  onSocketReady (callback) {
    emitter.on(`connection:${this.token}`, () => callback())
  }

  handleChunk (chunk) {
    this.writer.write(chunk, () => {
      if (!this.options.endpoint) return

      if (this.options.protocol === 'tus' && !this.tus) {
        return this.uploadTus()
      }

      if (this.options.protocol !== 'tus' && this.writer.bytesWritten === this.options.size) {
        return this.uploadMultipart()
      }
    })
  }

  handleResponse (resp) {
    resp.pipe(this.writer)
    this.writer.on('finish', () => {
      if (!this.options.endpoint) return

      this.options.protocol === 'tus' ? this.uploadTus() : this.uploadMultipart()
    })
  }

  getResponse () {
    const body = this.options.endpoint
      ? { token: this.token }
      : 'No endpoint, file written to uppy server local storage'

    return { body, status: 200 }
  }

  emitProgress (bytesUploaded, bytesTotal) {
    bytesTotal = bytesTotal || this.options.size
    const percentage = (bytesUploaded / bytesTotal * 100).toFixed(2)
    console.log(bytesUploaded, bytesTotal, `${percentage}%`)

    const emitData = JSON.stringify({
      action: 'progress',
      payload: { progress: percentage, bytesUploaded, bytesTotal }
    })

    // avoid flooding the client with progress events.
    const roundedPercentage = Math.floor(percentage)
    if (this.emittedProgress !== roundedPercentage) {
      this.emittedProgress = roundedPercentage
      emitter.emit(this.token, emitData)
    }
  }

  uploadTus () {
    const fname = this.options.name || path.basename(this.options.path)
    const metadata = Object.assign({ filename: fname }, this.options.metadata || {})
    const file = fs.createReadStream(this.options.path)
    const uploader = this

    this.tus = new tus.Upload(file, {
      endpoint: this.options.endpoint,
      resume: true,
      uploadSize: this.options.size || fs.statSync(this.options.path).size,
      metadata,
      chunkSize: this.writer.bytesWritten,
      onError (error) {
        throw error
      },
      onProgress (bytesUploaded, bytesTotal) {
        uploader.emitProgress(bytesUploaded, bytesTotal)
      },
      onChunkComplete (chunkSize, bytesUploaded, bytesTotal) {
        uploader.tus.options.chunkSize = uploader.writer.bytesWritten - bytesUploaded
      },
      onSuccess () {
        emitter.emit(
          uploader.token,
          JSON.stringify({
            action: 'success',
            payload: { complete: true, url: uploader.tus.url }
          })
        )

        fs.unlink(uploader.options.path)
      }
    })

    this.tus.start()

    emitter.on(`pause:${this.token}`, () => {
      this.tus.abort()
    })

    emitter.on(`resume:${this.token}`, () => {
      this.tus.start()
    })
  }

  uploadMultipart () {
    const file = fs.createReadStream(this.options.path)

    // upload progress
    let bytesUploaded = 0
    file.on('data', (data) => {
      bytesUploaded += data.length
      this.emitProgress(bytesUploaded)
    })

    const formData = { [this.options.fieldname]: file }
    request.post({ url: this.options.endpoint, formData }, (err, response, body) => {
      let emitData = {}

      if (err) {
        emitData.action = 'error'
        emitData.payload = { error: err }
      } else {
        emitData.action = 'success'
        emitData.payload = { complete: true }
      }

      fs.unlink(this.options.path)
      return emitter.emit(this.token, JSON.stringify(emitData))
    })
  }
}

exports = module.exports = Uploader
