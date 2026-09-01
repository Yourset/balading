import { useEffect, useRef, useState } from 'react'
import { getServerUrl } from './api.js'
import { connectionFailureAction, createPcmReplayPlan, getPcmArchiveStats, RECOGNITION_TIMEOUT_MS, sendRecognitionFrames } from './voiceRecovery.js'
import { getVoiceTiming } from './voiceTiming.js'

function speechSocketUrl() {
  const base = getServerUrl() || window.location.origin
  const url = new URL('/api/speech/stream', base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export function useVoiceRecorder({ onFinal, onError }) {
  const [state, setState] = useState('idle')
  const [partial, setPartial] = useState('')
  const [remainingSec, setRemainingSec] = useState(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [warning, setWarning] = useState(false)
  const [canExtend, setCanExtend] = useState(false)
  const [extended, setExtended] = useState(false)
  const [hasRetainedAudio, setHasRetainedAudio] = useState(false)
  const [retainedDurationSec, setRetainedDurationSec] = useState(0)
  const [networkInterrupted, setNetworkInterrupted] = useState(false)
  const stateRef = useRef('idle')
  const sessionRef = useRef(null)
  const finalRef = useRef(onFinal)
  const errorRef = useRef(onError)

  useEffect(() => { finalRef.current = onFinal }, [onFinal])
  useEffect(() => { errorRef.current = onError }, [onError])
  const updateState = (next) => { stateRef.current = next; setState(next) }

  const ownsSession = (session) => sessionRef.current === session && !session.cancelled && !session.terminal
  const canRecord = (session) => ownsSession(session) && !session.finishing

  const resetTimingState = () => {
    setRemainingSec(null)
    setElapsedSec(0)
    setWarning(false)
    setCanExtend(false)
    setExtended(false)
  }

  const resetRecoveryState = () => {
    setHasRetainedAudio(false)
    setRetainedDurationSec(0)
    setNetworkInterrupted(false)
  }

  const stopAudio = async (session) => {
    if (!session) return
    if (session.timer) clearTimeout(session.timer)
    if (session.tickTimer) clearInterval(session.tickTimer)
    if (session.recognitionTimer) clearTimeout(session.recognitionTimer)
    session.timer = null
    session.tickTimer = null
    session.recognitionTimer = null
    try { session.worklet?.disconnect() } catch (e) {}
    try { session.source?.disconnect() } catch (e) {}
    try { session.silent?.disconnect() } catch (e) {}
    try { session.stream?.getTracks().forEach(track => track.stop()) } catch (e) {}
    try { if (session.context && session.context.state !== 'closed') await session.context.close() } catch (e) {}
    session.worklet = null
    session.source = null
    session.silent = null
    session.stream = null
    session.context = null
  }

  const closeSocket = (session, sendCancel = false) => {
    if (!session) return
    session.socketGeneration += 1
    const socket = session.socket
    session.socket = null
    if (sendCancel && socket?.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: 'cancel' })) } catch (e) {}
    }
    try { socket?.close() } catch (e) {}
  }

  const dispose = async (session, close = true) => {
    await stopAudio(session)
    if (close) closeSocket(session)
    if (sessionRef.current === session) sessionRef.current = null
  }

  const retainFailure = async (session, message, partialText = '') => {
    if (!ownsSession(session) || session.retaining) return
    session.retaining = true
    session.finishing = true
    await stopAudio(session)
    closeSocket(session)
    session.retaining = false
    const stats = getPcmArchiveStats(session.pcmChunks)
    resetTimingState()
    setNetworkInterrupted(false)
    if (!stats.canRetry) {
      session.terminal = true
      if (sessionRef.current === session) sessionRef.current = null
      updateState('error')
      errorRef.current?.(message || '语音识别失败', String(partialText || '').trim())
      return
    }
    setHasRetainedAudio(true)
    setRetainedDurationSec(Math.max(1, Math.ceil(stats.durationMs / 1000)))
    updateState('error')
    errorRef.current?.(`${message || '语音识别失败'}，录音已保留`, String(partialText || '').trim())
  }

  const armRecognitionTimeout = (session) => {
    if (session.recognitionTimer) clearTimeout(session.recognitionTimer)
    session.recognitionTimer = setTimeout(() => {
      session.recognitionTimer = null
      retainFailure(session, '语音识别等待超时')
    }, RECOGNITION_TIMEOUT_MS)
  }

  const handleConnectionFailure = (session, message, partialText = '') => {
    if (!ownsSession(session) || session.connectionFailed) return
    session.connectionFailed = true
    session.connectionFailureMessage = message || '语音连接已断开'
    session.connectionFailurePartial = String(partialText || '').trim()
    const socket = session.socket
    session.socket = null
    try { socket?.close() } catch (e) {}
    const action = connectionFailureAction(session)
    if (action === 'defer') return
    if (action === 'retain') {
      retainFailure(session, session.connectionFailureMessage, session.connectionFailurePartial)
      return
    }
    setNetworkInterrupted(true)
    errorRef.current?.(`${session.connectionFailureMessage}，仍在本地录音`, session.connectionFailurePartial)
  }

  const handleRecognitionMessage = async (session, socket, generation, event) => {
    let msg
    try { msg = JSON.parse(String(event.data || '')) } catch (e) { return }
    if (!ownsSession(session) || session.socket !== socket || session.socketGeneration !== generation) return
    if (msg.type === 'ready') {
      if (session.finishRequested || session.retrying) updateState('recognizing')
      else updateState('recording')
    } else if (msg.type === 'partial') {
      setPartial(String(msg.text || ''))
    } else if (msg.type === 'final') {
      if (session.finalHandled) return
      const text = String(msg.text || '').trim()
      if (!text) {
        await retainFailure(session, '没有识别到有效内容')
        return
      }
      session.finalHandled = true
      session.terminal = true
      session.pcmChunks.length = 0
      await dispose(session, false)
      try { socket.close() } catch (e) {}
      setPartial('')
      resetTimingState()
      resetRecoveryState()
      updateState('idle')
      finalRef.current?.(text)
    } else if (msg.type === 'cancelled') {
      if (sessionRef.current !== session) return
      session.terminal = true
      session.pcmChunks.length = 0
      await dispose(session, false)
      try { socket.close() } catch (e) {}
      setPartial('')
      resetTimingState()
      resetRecoveryState()
      updateState('idle')
    } else if (msg.type === 'error') {
      handleConnectionFailure(session, msg.message || '语音服务错误', msg.text)
    }
  }

  const connectSocket = (session, replay = false) => {
    if (!ownsSession(session)) return false
    session.connectionFailed = false
    const generation = session.socketGeneration + 1
    session.socketGeneration = generation
    let socket
    try { socket = new WebSocket(speechSocketUrl()) } catch (e) {
      handleConnectionFailure(session, e.message || '语音服务连接失败')
      return false
    }
    socket.binaryType = 'arraybuffer'
    session.socket = socket
    socket.onopen = () => {
      if (!ownsSession(session) || session.socket !== socket || session.socketGeneration !== generation) { socket.close(); return }
      try {
        if (replay || session.finishRequested) {
          const plan = createPcmReplayPlan(session.pcmChunks)
          if (!sendRecognitionFrames(socket, plan, () => armRecognitionTimeout(session))) {
            retainFailure(session, '没有可重新识别的录音'); return
          }
          session.sentChunkCount = session.pcmChunks.length
          updateState('recognizing')
        } else {
          socket.send(JSON.stringify({ type: 'start', format: 'pcm', rate: 16000, bits: 16, channel: 1 }))
          for (let index = session.sentChunkCount; index < session.pcmChunks.length; index += 1) socket.send(session.pcmChunks[index])
          session.sentChunkCount = session.pcmChunks.length
        }
      } catch (e) {
        handleConnectionFailure(session, '语音网络发送失败')
      }
    }
    socket.onmessage = event => { handleRecognitionMessage(session, socket, generation, event) }
    socket.onerror = () => {
      if (session.socket === socket && session.socketGeneration === generation) handleConnectionFailure(session, '语音服务连接失败')
    }
    socket.onclose = () => {
      if (ownsSession(session) && session.socket === socket && session.socketGeneration === generation && !session.finalHandled) {
        handleConnectionFailure(session, '语音识别连接已断开')
      }
    }
    return true
  }

  const refreshTiming = (session) => {
    if (!canRecord(session) || !session.recordingStartedAt) return
    const elapsedMs = Date.now() - session.recordingStartedAt
    const timing = getVoiceTiming(elapsedMs, session.extended)
    setElapsedSec(Math.min(120, Math.max(0, Math.floor(elapsedMs / 1000))))
    setRemainingSec(timing.remainingSec)
    setWarning(timing.warning)
    setCanExtend(timing.canExtend)
    setExtended(Boolean(session.extended))
  }

  const armTiming = (session) => {
    if (session.timer) clearTimeout(session.timer)
    if (session.tickTimer) clearInterval(session.tickTimer)
    const timing = getVoiceTiming(Date.now() - session.recordingStartedAt, session.extended)
    refreshTiming(session)
    session.timer = setTimeout(() => finish(), timing.remainingMs)
    session.tickTimer = setInterval(() => refreshTiming(session), 250)
  }

  const start = async () => {
    if (!['idle', 'error'].includes(stateRef.current) || hasRetainedAudio || sessionRef.current) return false
    if (!navigator.mediaDevices?.getUserMedia || (!window.AudioContext && !window.webkitAudioContext)) {
      updateState('error'); errorRef.current?.('当前设备不支持语音录入'); return false
    }
    const session = {
      cancelled: false, terminal: false, finishing: false, finishRequested: false, finalHandled: false,
      extended: false, retrying: false, retaining: false, flushing: false, connectionFailed: false,
      connectionFailureMessage: '', connectionFailurePartial: '',
      pcmChunks: [], sentChunkCount: 0, socketGeneration: 0, startedAt: Date.now()
    }
    sessionRef.current = session
    setPartial('')
    resetTimingState()
    setCanExtend(true)
    resetRecoveryState()
    updateState('connecting')
    connectSocket(session)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true
      } })
      if (!canRecord(session)) { stream.getTracks().forEach(track => track.stop()); return false }
      session.stream = stream
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      const ctx = new AudioCtx()
      session.context = ctx
      await ctx.audioWorklet.addModule('/pcm-processor.js')
      if (!canRecord(session)) { stream.getTracks().forEach(track => track.stop()); await ctx.close().catch(() => {}); return false }
      const source = ctx.createMediaStreamSource(stream)
      const worklet = new AudioWorkletNode(ctx, 'dsh-pcm-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
      const silent = ctx.createGain(); silent.gain.value = 0
      session.source = source; session.worklet = worklet; session.silent = silent
      worklet.port.onmessage = ({ data }) => {
        if (data && data.type === 'flushed') { session.flushResolve?.(); session.flushResolve = null; return }
        if (!canRecord(session) || !(data instanceof ArrayBuffer) || data.byteLength === 0) return
        session.pcmChunks.push(data)
        if (!session.connectionFailed && session.socket?.readyState === WebSocket.OPEN) {
          try {
            session.socket.send(data)
            session.sentChunkCount = session.pcmChunks.length
          } catch (e) { handleConnectionFailure(session, '语音网络发送失败') }
        }
      }
      source.connect(worklet); worklet.connect(silent); silent.connect(ctx.destination)
      if (ctx.state === 'suspended') await ctx.resume()
      if (!canRecord(session)) { await stopAudio(session); return false }
      session.recordingStartedAt = Date.now()
      armTiming(session)
      if (!session.finishing) updateState('recording')
      return true
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')
      await retainFailure(session, denied ? '请允许巴拉丁使用麦克风' : (e.message || '无法开始录音'))
      return false
    }
  }

  const extend = () => {
    const session = sessionRef.current
    if (!canRecord(session) || session.extended) return false
    session.extended = true
    setExtended(true)
    setCanExtend(false)
    if (session.recordingStartedAt) armTiming(session)
    return true
  }

  const finish = async () => {
    const session = sessionRef.current
    if (!canRecord(session) || session.finishRequested) return
    session.finishRequested = true
    if (session.worklet) {
      session.flushing = true
      await new Promise(resolve => {
        let done = false
        const finishFlush = () => { if (done) return; done = true; resolve() }
        session.flushResolve = finishFlush
        try { session.worklet.port.postMessage({ type: 'flush' }) } catch (e) { finishFlush() }
        setTimeout(finishFlush, 180)
      })
      session.flushing = false
    }
    if (!ownsSession(session)) return
    session.finishing = true
    await stopAudio(session)
    setRemainingSec(null); setWarning(false); setCanExtend(false)
    if (!getPcmArchiveStats(session.pcmChunks).canRetry) {
      await retainFailure(session, '没有录到有效语音')
      return
    }
    if (!session.connectionFailed && session.socket?.readyState === WebSocket.OPEN) {
      updateState('recognizing')
      try {
        sendRecognitionFrames(session.socket, [JSON.stringify({ type: 'finish' })], () => armRecognitionTimeout(session))
      } catch (e) { handleConnectionFailure(session, '语音网络发送失败') }
    } else if (!session.connectionFailed && session.socket?.readyState === WebSocket.CONNECTING) {
      // onopen 会重放完整 PCM+finish，并在全部 send 成功后启动识别超时。
      updateState('recognizing')
    } else {
      await retainFailure(session, session.connectionFailureMessage || '网络不可用，无法完成识别', session.connectionFailurePartial)
    }
  }

  const retry = () => {
    const session = sessionRef.current
    if (!ownsSession(session) || stateRef.current !== 'error' || !getPcmArchiveStats(session.pcmChunks).canRetry) return false
    closeSocket(session)
    session.finishing = true
    session.finishRequested = true
    session.retrying = true
    session.finalHandled = false
    session.connectionFailed = false
    setNetworkInterrupted(false)
    updateState('recognizing')
    // onopen 重放完整 PCM+finish 后再启动识别超时，建连时间不占结果等待预算。
    return connectSocket(session, true)
  }

  const cancel = async () => {
    const session = sessionRef.current
    if (!session) { setPartial(''); resetRecoveryState(); updateState('idle'); return }
    session.cancelled = true
    session.terminal = true
    session.pcmChunks.length = 0
    await stopAudio(session)
    closeSocket(session, true)
    sessionRef.current = null
    setPartial('')
    resetTimingState()
    resetRecoveryState()
    updateState('idle')
  }

  useEffect(() => () => {
    const session = sessionRef.current
    if (session) {
      session.cancelled = true
      session.pcmChunks.length = 0
      dispose(session)
    }
  }, [])

  return {
    state, partial, remainingSec, elapsedSec, warning, canExtend, extended,
    hasRetainedAudio, retainedDurationSec, networkInterrupted,
    start, finish, cancel, extend, retry
  }
}
