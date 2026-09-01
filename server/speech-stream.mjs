import crypto from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { WebSocket, WebSocketServer } from 'ws'

const MAX_RECORD_MS = 120_000
const ABSOLUTE_TIMEOUT_MS = 125_000
const MAX_PCM_BYTES = 4_000_000 // 120 秒 16k/16bit/mono 约 3.84 MB，额外预留末帧余量

function frameHeader(messageType, flags, serialization, compression) {
  return Buffer.from([0x11, (messageType << 4) | flags, (serialization << 4) | compression, 0x00])
}

function sizedFrame(header, payload, sequence = null) {
  const seqBytes = sequence == null ? 0 : 4
  const out = Buffer.alloc(header.length + seqBytes + 4 + payload.length)
  header.copy(out, 0)
  let offset = header.length
  if (sequence != null) { out.writeInt32BE(sequence, offset); offset += 4 }
  out.writeUInt32BE(payload.length, offset); offset += 4
  payload.copy(out, offset)
  return out
}

function fullRequestFrame(requestId) {
  const payload = Buffer.from(JSON.stringify({
    user: { uid: 'dsh-mobile' },
    audio: { format: 'pcm', sample_rate: 16000, bits: 16, channel: 1 },
    request: {
      reqid: requestId,
      sequence: 1,
      language: 'zh-CN',
      enable_itn: true,
      enable_punc: true,
      enable_ddc: true,
      show_utterances: true,
      result_type: 'full'
    }
  }))
  return sizedFrame(frameHeader(1, 0, 1, 0), payload)
}

function audioFrame(pcm, final) {
  const payload = Buffer.from(pcm || Buffer.alloc(0))
  return sizedFrame(frameHeader(2, final ? 2 : 0, 0, 0), payload)
}

function parseServerFrame(data) {
  const buf = Buffer.from(data)
  if (buf.length < 8) throw new Error('火山返回帧过短')
  const headerSize = (buf[0] & 0x0f) * 4
  if (headerSize < 4 || headerSize > buf.length) throw new Error('火山返回帧头无效')
  const messageType = buf[1] >> 4
  const flags = buf[1] & 0x0f
  const compression = buf[2] & 0x0f
  const hasSequence = (flags & 1) !== 0
  const isLast = (flags & 2) !== 0
  let offset = headerSize
  if (messageType === 0x0f) {
    if (offset + 8 > buf.length) throw new Error('火山错误帧被截断')
    const code = buf.readUInt32BE(offset); offset += 4
    const size = buf.readUInt32BE(offset); offset += 4
    if (size > buf.length - offset) throw new Error('火山错误帧长度越界')
    return { error: '火山语音错误 ' + code + ': ' + buf.subarray(offset, offset + size).toString('utf8'), isLast }
  }
  let sequence = null
  if (hasSequence) {
    if (offset + 4 > buf.length) throw new Error('火山返回帧缺少序号')
    sequence = buf.readInt32BE(offset); offset += 4
  }
  if (offset + 4 > buf.length) throw new Error('火山返回帧缺少长度')
  const size = buf.readUInt32BE(offset); offset += 4
  if (size > buf.length - offset || size > 1_000_000) throw new Error('火山返回帧长度越界')
  let payload = buf.subarray(offset, offset + size)
  if (compression === 1 && payload.length) payload = gunzipSync(payload, { maxOutputLength: 2_000_000 })
  if (messageType !== 9) return { sequence, flags, isLast }
  let value = null
  try { value = JSON.parse(payload.toString('utf8')) } catch (e) {}
  return { sequence, flags, isLast, value }
}

function sendJson(ws, value) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value))
}

export const speechProtocol = { fullRequestFrame, audioFrame, parseServerFrame }
export const speechLimits = { maxRecordMs: MAX_RECORD_MS, absoluteTimeoutMs: ABSOLUTE_TIMEOUT_MS, maxPcmBytes: MAX_PCM_BYTES }

export function createSpeechGateway(options = {}) {
  const apiKey = String(options.apiKey || '')
  const resourceId = String(options.resourceId || 'volc.seedasr.sauc.duration')
  const endpoint = String(options.endpoint || 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async')
  const trustProxy = options.trustProxy === true
  const recordUsage = typeof options.onUsage === 'function' ? options.onUsage : () => {}
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 })
  const activeByIp = new Map()

  function handleUpgrade(req, socket, head) {
    const origin = String(req.headers.origin || '')
    const host = String(req.headers.host || '').toLowerCase()
    let trustedOrigin = !origin
    try {
      const parsed = new URL(origin)
      trustedOrigin = parsed.host.toLowerCase() === host || ['localhost', '127.0.0.1'].includes(parsed.hostname) || parsed.protocol === 'capacitor:'
    } catch (e) {}
    if (!trustedOrigin) {
      try { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n') } catch (e) {}
      socket.destroy(); return
    }
    const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : ''
    const ip = forwarded || req.socket.remoteAddress || 'unknown'
    if ((activeByIp.get(ip) || 0) >= 2) {
      try { socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n') } catch (e) {}
      socket.destroy(); return
    }
    if (!apiKey) {
      try { socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n') } catch (e) {}
      socket.destroy(); return
    }
    activeByIp.set(ip, (activeByIp.get(ip) || 0) + 1)
    wss.handleUpgrade(req, socket, head, (client) => {
      let released = false
      const releaseSlot = () => {
        if (released) return
        released = true
        const next = Math.max(0, (activeByIp.get(ip) || 1) - 1)
        if (next) activeByIp.set(ip, next); else activeByIp.delete(ip)
      }
      const requestId = crypto.randomUUID()
      const upstream = new WebSocket(endpoint, {
        headers: {
          'X-Api-Key': apiKey,
          'X-Api-Resource-Id': resourceId,
          'X-Api-Request-Id': requestId,
          'X-Api-Connect-Id': requestId
        },
        handshakeTimeout: 10000,
        perMessageDeflate: false,
        maxPayload: 1_000_000
      })
      let upstreamReady = false
      let started = false
      let finishing = false
      let cancelled = false
      let pcmBytes = 0
      let lastAudio = null
      let latestText = ''
      let finalTimer = null
      let startTimer = null
      let idleTimer = null
      let absoluteTimer = null
      let finalized = false
      let usageRecorded = false
      const pendingFrames = []

      const clearTimers = () => {
        for (const timer of [finalTimer, startTimer, idleTimer, absoluteTimer]) if (timer) clearTimeout(timer)
      }
      const closeBoth = () => {
        clearTimers()
        try { if (client.readyState === WebSocket.OPEN) client.close() } catch (e) {}
        try { if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close() } catch (e) {}
      }
      const fail = (message) => {
        if (cancelled || finalized) return
        finalized = true
        sendJson(client, { type: 'error', message, text: latestText })
        closeBoth()
      }
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => fail('语音流超时，请重试'), 12000)
      }
      const sendUpstream = (frame) => {
        if (upstreamReady && upstream.readyState === WebSocket.OPEN) upstream.send(frame)
        else pendingFrames.push(frame)
      }
      const finalize = () => {
        if (cancelled || finalized || !finishing || client.readyState !== WebSocket.OPEN) return
        finalized = true
        if (!usageRecorded && pcmBytes > 0) {
          usageRecorded = true
          try { recordUsage({ durationMs: Math.round(pcmBytes / (16_000 * 2) * 1000), pcmBytes, requestId, completedAt: Date.now() }) } catch (error) {}
        }
        sendJson(client, { type: 'final', text: latestText })
        setTimeout(closeBoth, 80)
      }
      startTimer = setTimeout(() => fail('未收到语音开始指令'), 8000)
      absoluteTimer = setTimeout(() => fail('录音超过 2 分钟限制'), ABSOLUTE_TIMEOUT_MS)
      resetIdleTimer()

      upstream.on('open', () => {
        upstreamReady = true
        sendUpstream(fullRequestFrame(requestId))
        for (const frame of pendingFrames.splice(0)) upstream.send(frame)
        sendJson(client, { type: 'ready' })
      })
      upstream.on('message', (data) => {
        try {
          const parsed = parseServerFrame(data)
          if (parsed.error) { fail(parsed.error); return }
          const text = String(parsed.value?.result?.text || '').trim()
          if (text) { latestText = text; sendJson(client, { type: 'partial', text }) }
          const utterances = parsed.value?.result?.utterances || []
          const definite = utterances.length > 0 && utterances.every(item => item?.definite === true)
          const negativeFinal = typeof parsed.sequence === 'number' && parsed.sequence < 0
          if (finishing && (parsed.isLast || negativeFinal)) { finalize(); return }
        } catch (e) { fail('无法解析火山语音响应') }
      })
      upstream.on('error', () => fail('火山语音连接失败'))
      upstream.on('close', () => {
        if (!cancelled && !finishing && client.readyState === WebSocket.OPEN) fail('火山语音连接已断开')
      })

      client.on('message', (data, isBinary) => {
        if (cancelled || finishing) return
        if (isBinary) {
          if (!started) { fail('语音流尚未初始化'); return }
          const chunk = Buffer.from(data)
          resetIdleTimer()
          pcmBytes += chunk.length
          if (pcmBytes > MAX_PCM_BYTES) { fail('录音超过 2 分钟限制'); return }
          if (lastAudio) sendUpstream(audioFrame(lastAudio, false))
          lastAudio = chunk
          return
        }
        let msg
        try { msg = JSON.parse(data.toString('utf8')) } catch (e) { fail('语音控制消息无效'); return }
        if (msg.type === 'start') {
          if (started) return
          if (msg.format !== 'pcm' || Number(msg.rate) !== 16000 || Number(msg.bits) !== 16 || Number(msg.channel) !== 1) {
            fail('仅支持 16kHz/16bit/单声道 PCM'); return
          }
          started = true
          if (startTimer) { clearTimeout(startTimer); startTimer = null }
          resetIdleTimer()
        } else if (msg.type === 'finish') {
          if (!started) { fail('没有可识别的录音'); return }
          finishing = true
          sendUpstream(audioFrame(lastAudio || Buffer.alloc(0), true))
          lastAudio = null
          if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
          if (absoluteTimer) { clearTimeout(absoluteTimer); absoluteTimer = null } // 录音结束，进入最终结果阶段
          finalTimer = setTimeout(() => fail('语音最终结果超时，请重试'), 20000)
        } else if (msg.type === 'cancel') {
          cancelled = true
          sendJson(client, { type: 'cancelled' })
          setTimeout(closeBoth, 30)
        }
      })
      client.on('close', () => { cancelled = true; releaseSlot(); try { upstream.close() } catch (e) {} })
      client.on('error', () => { cancelled = true; releaseSlot(); try { upstream.close() } catch (e) {} })
    })
  }

  return { handleUpgrade }
}
