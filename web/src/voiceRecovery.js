export const PCM_SAMPLE_RATE = 16000
export const PCM_BYTES_PER_SAMPLE = 2
export const PCM_CHANNELS = 1
export const RECOGNITION_TIMEOUT_MS = 24_000

export function isPcmChunk(chunk) {
  return chunk instanceof ArrayBuffer && chunk.byteLength > 0
}

export function getPcmArchiveStats(chunks) {
  const validChunks = Array.from(chunks || []).filter(isPcmChunk)
  const bytes = validChunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const bytesPerSecond = PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE * PCM_CHANNELS
  return {
    chunks: validChunks.length,
    bytes,
    durationMs: Math.round(bytes / bytesPerSecond * 1000),
    canRetry: bytes > 0
  }
}

/**
 * 生成一次重识别需要按顺序发给新 WebSocket 的完整帧序列。
 * 返回新数组，但保留原 PCM ArrayBuffer 引用，避免重试前复制整段录音。
 */
export function createPcmReplayPlan(chunks) {
  const audio = Array.from(chunks || []).filter(isPcmChunk)
  if (!audio.length) return []
  return [
    JSON.stringify({ type: 'start', format: 'pcm', rate: PCM_SAMPLE_RATE, bits: 16, channel: PCM_CHANNELS }),
    ...audio,
    JSON.stringify({ type: 'finish' })
  ]
}

/** 所有识别帧都被 WebSocket 接受后才启动结果等待计时。 */
export function sendRecognitionFrames(socket, frames, onSent) {
  const plan = Array.from(frames || [])
  if (!socket || !plan.length) return false
  for (const frame of plan) socket.send(frame)
  onSent?.()
  return true
}

/** flush 期间的断线必须延后到 finish 唯一收口，避免停止 worklet 丢尾帧。 */
export function connectionFailureAction(session = {}) {
  if (session.flushing) return 'defer'
  if (session.finishRequested || session.finishing || session.retrying) return 'retain'
  return 'continue-recording'
}
