import { getSoundPreference } from './preferences.js'

let audioContext = null
const played = new Map()
const playing = new Set()
const soundEventListeners = new Set()

export const SOUND_REASON_DISPLAY_MS = 1200

const FALLBACK_REASON = {
  task: '回复好了',
  send: '消息已发送',
  voice: '语音已发送'
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').replace(/[：:，,。.!！]+$/g, '').trim()
}

function sessionTitleFromKey(dedupeKey) {
  const sessionId = compactText(dedupeKey).split(':')[0]
  if (!sessionId) return ''
  try { return compactText(localStorage.getItem('dsh-title-' + sessionId)) } catch (e) { return '' }
}

export function formatSoundReason(kind, details = {}, dedupeKey = '') {
  const source = compactText(details.source || details.assistantName || details.sessionName || details.title || sessionTitleFromKey(dedupeKey))
  let reason = compactText(details.reason || details.action)
  if (!reason) {
    if (details.preview) reason = kind === 'voice' ? '试听语音提示音' : '试听任务提示音'
    else reason = FALLBACK_REASON[kind] || '提示音已响'
  }
  let text = source && !reason.startsWith(source) ? `${source}：${reason}` : reason
  if (!text) text = '提示音已响'
  return text.length > 44 ? text.slice(0, 43) + '…' : text
}

function publishSoundEvent(kind, dedupeKey, details) {
  const event = { kind, text: formatSoundReason(kind, details, dedupeKey), at: Date.now() }
  for (const listener of [...soundEventListeners]) {
    try { listener(event) } catch (e) {}
  }
  return event
}

export function subscribeSoundEvents(listener) {
  soundEventListeners.add(listener)
  return () => soundEventListeners.delete(listener)
}

// 原生后台通知音不走 Web Audio，但仍从同一个原因事件入口登记；页面隐藏时浮条自然不可见。
export function announceSoundEvent(kind, dedupeKey = '', details = {}) {
  return publishSoundEvent(kind, dedupeKey, details)
}

function context() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  if (!audioContext) audioContext = new Ctx()
  return audioContext
}

export function initSounds() {
  const unlock = () => {
    try {
      const ctx = context()
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
    } catch (e) {}
  }
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock, { passive: true })
}

function tone(ctx, at, frequency, duration, gainValue, type = 'sine') {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(frequency, at)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(gainValue, at + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  osc.connect(gain); gain.connect(ctx.destination)
  osc.start(at); osc.stop(at + duration + 0.02)
}

export function playAcceptedPromptSound({ kind = 'text', rpcId = '', sessionId = '', source = '' } = {}) {
  const voice = kind === 'voice'
  const dedupeKey = `${sessionId}:prompt:${rpcId}`
  return playSoundEvent(voice ? 'voice' : 'send', dedupeKey, {
    source,
    reason: voice ? '语音消息已发送' : '消息已发送'
  })
}

export async function playSoundEvent(kind, dedupeKey = '', details = {}) {
  const preset = getSoundPreference(kind === 'voice' ? 'voice' : 'task')
  if (preset === 'off') return false
  const key = kind + ':' + dedupeKey
  const now = Date.now()
  if (played.size > 200) for (const [oldKey, at] of played) if (now - at > 60000) played.delete(oldKey)
  if (dedupeKey && (playing.has(key) || played.has(key) && now - played.get(key) < 30000)) return false
  if (dedupeKey) playing.add(key)
  try {
    const ctx = context()
    if (!ctx) return false
    if (ctx.state === 'suspended') await ctx.resume()
    const at = ctx.currentTime + 0.015
    if (preset === 'soft') {
      tone(ctx, at, 520, 0.16, 0.08)
      tone(ctx, at + 0.11, 660, 0.2, 0.07)
    } else if (preset === 'digital') {
      tone(ctx, at, 740, 0.08, 0.07, 'square')
      tone(ctx, at + 0.1, 980, 0.09, 0.06, 'square')
      tone(ctx, at + 0.21, 780, 0.12, 0.055, 'square')
    } else {
      tone(ctx, at, 660, 0.14, 0.09)
      tone(ctx, at + 0.1, 880, 0.18, 0.08)
      tone(ctx, at + 0.22, 1100, 0.24, 0.07)
    }
    if (dedupeKey) played.set(key, now)
    publishSoundEvent(kind, dedupeKey, details)
    return true
  } catch (e) { return false }
  finally { if (dedupeKey) playing.delete(key) }
}
