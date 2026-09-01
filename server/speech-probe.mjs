import crypto from 'node:crypto'
import { WebSocket } from 'ws'
import { speechProtocol } from './speech-stream.mjs'

const key = process.env.VOLC_SPEECH_API_KEY || ''
if (!key) throw new Error('VOLC_SPEECH_API_KEY is required')
const requestId = crypto.randomUUID()
const endpoint = process.env.VOLC_SPEECH_WS_URL || 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'
const resourceId = process.env.VOLC_SPEECH_RESOURCE_ID || 'volc.seedasr.sauc.duration'
const ws = new WebSocket(endpoint, { headers: {
  'X-Api-Key': key,
  'X-Api-Resource-Id': resourceId,
  'X-Api-Request-Id': requestId,
  'X-Api-Connect-Id': requestId
}, handshakeTimeout: 10000 })
const timer = setTimeout(() => { console.error('PROBE_TIMEOUT'); ws.terminate(); process.exitCode = 2 }, 12000)
ws.on('open', () => {
  console.log('AUTH_OK')
  ws.send(speechProtocol.fullRequestFrame(requestId))
  ws.send(speechProtocol.audioFrame(Buffer.alloc(3200), true))
})
ws.on('message', data => {
  try {
    const frame = speechProtocol.parseServerFrame(data)
    console.log(frame.error ? 'ASR_ERROR ' + frame.error.replace(/[A-Za-z0-9+/=_-]{20,}/g, '[redacted]') : 'ASR_RESPONSE')
  } catch (e) { console.log('ASR_RESPONSE_UNPARSED') }
  clearTimeout(timer); ws.close()
})
ws.on('unexpected-response', (_req, res) => {
  console.log('AUTH_HTTP_' + res.statusCode)
  clearTimeout(timer); ws.terminate()
})
ws.on('error', error => {
  console.log('PROBE_ERROR ' + String(error.message || error).replace(/[A-Za-z0-9+/=_-]{20,}/g, '[redacted]'))
  clearTimeout(timer)
})
ws.on('close', () => { clearTimeout(timer) })
