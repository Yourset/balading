import { getSoundPreference } from './preferences.js'
import { announceSoundEvent, playSoundEvent } from './sounds.js'
import { nativeNotificationAvailable } from './nativeNotifications.js'

// APP 内本地通知（Capacitor 壳专用；网页环境自动跳过）
// 同一完成键 30 秒内只触发一次，避免 assistant/message、turn/end 与轮询兜底重复。
const lastNotified = new Map()
const sessionNotified = new Map()
const pendingNotifications = new Set()

function notificationId(value) {
  let hash = 0x811c9dc5
  for (const char of String(value || 'global')) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 0x01000193) }
  return (hash >>> 0) % 2147483646 + 1
}

const channelId = preset => 'dsh-task-' + (preset || 'off')
const soundFile = preset => preset === 'soft' ? 'dsh_soft.wav' : preset === 'digital' ? 'dsh_digital.wav' : 'dsh_chime.wav'

// APP 启动时请求通知权限并建立可切换声音的通知渠道。
export function initNotifications() {
  try {
    const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications
    if (!cap) return
    cap.checkPermissions().then((p) => {
      if (!p || p.display !== 'granted') cap.requestPermissions().catch(() => {})
    }).catch(() => {})
    if (cap.createChannel) {
      const channels = [
        { id: channelId('off'), name: '任务完成（静音）', importance: 3, vibration: false, sound: null },
        { id: channelId('soft'), name: '任务完成（轻柔）', importance: 4, vibration: false, sound: soundFile('soft') },
        { id: channelId('chime'), name: '任务完成（清脆）', importance: 4, vibration: false, sound: soundFile('chime') },
        { id: channelId('digital'), name: '任务完成（数字）', importance: 4, vibration: false, sound: soundFile('digital') }
      ]
      Promise.all(channels.map(item => cap.createChannel(item).catch(() => {}))).catch(() => {})
    }
  } catch (e) { /* 静默 */ }
}

// 常驻通知条状态更新：显示当前正在运行的任务（如「AI 思考中…」「回复完成」）
export function updateKeepAlive(text) {
  try {
    const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.KeepAlive
    if (!p) return // 网页环境无原生插件
    p.updateStatus({ text: text || '运行中，随时待命' })
  } catch (e) { /* 更新失败静默 */ }
}

export async function notifyReplyDone(sessionId, body, completionKey, soundDetails = {}) {
  try {
    const now = Date.now()
    const key = completionKey || sessionId || 'global'
    const sessionKey = sessionId || 'global'
    const pendingSessionKey = '@session:' + sessionKey
    const previous = lastNotified.get(key) || 0
    const previousSession = sessionNotified.get(sessionKey) || 0
    if (now - previous < 30000 || now - previousSession < 8000 || pendingNotifications.has(key) || pendingNotifications.has(pendingSessionKey)) return false
    pendingNotifications.add(key); pendingNotifications.add(pendingSessionKey)

    let success = false
    try {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        const preset = getSoundPreference('task')
        success = preset === 'off' ? true : await playSoundEvent('task', key, { reason: '回复好了', ...soundDetails })
      } else {
        // Android 原生服务负责后台终态通知；避免 WebView 偶尔仍运行时重复弹两条。
        if (nativeNotificationAvailable()) return true
        const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications
        if (!cap) return false
        let perms = await cap.checkPermissions()
        if (!perms || perms.display !== 'granted') {
          const req = await cap.requestPermissions()
          if (!req || req.display !== 'granted') return false
        }
        const preset = getSoundPreference('task')
        await cap.schedule({
          notifications: [{
            id: notificationId(key),
            title: '🤖 巴拉丁',
            body: body || 'AI 回复完成，点开查看',
            schedule: { at: new Date(now + 500) },
            channelId: channelId(preset),
            sound: preset === 'off' ? null : soundFile(preset)
          }]
        })
        if (preset !== 'off') announceSoundEvent('task', key, { reason: '回复好了', ...soundDetails })
        success = true
      }
      if (success) { lastNotified.set(key, now); sessionNotified.set(sessionKey, now) }
      return success
    } finally {
      pendingNotifications.delete(key); pendingNotifications.delete(pendingSessionKey)
    }
  } catch (e) { return false }
}
