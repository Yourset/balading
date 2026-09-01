export const NORMAL_VOICE_LIMIT_MS = 60_000
export const EXTENDED_VOICE_LIMIT_MS = 120_000
export const VOICE_WARNING_MS = 10_000

/**
 * 计算一次语音录制当前所处阶段。
 * 普通录音期间可随时首次切到“继续说话”，切换后本次总时长最多 2 分钟。
 */
export function getVoiceTiming(elapsedMs, extended = false) {
  const safeElapsed = Math.max(0, Number(elapsedMs) || 0)
  const limitMs = extended ? EXTENDED_VOICE_LIMIT_MS : NORMAL_VOICE_LIMIT_MS
  const remainingMs = Math.max(0, limitMs - safeElapsed)
  const warning = remainingMs > 0 && remainingMs <= VOICE_WARNING_MS
  return {
    limitMs,
    remainingMs,
    remainingSec: Math.ceil(remainingMs / 1000),
    warning,
    canExtend: !extended && remainingMs > 0,
    expired: remainingMs <= 0
  }
}
