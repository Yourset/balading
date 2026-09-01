import { APP_VERSION } from './version.js'

const STORAGE_KEY = 'dsh-client-error-queue-v1'
const MAX_QUEUE = 80
const MAX_TEXT = 500
let queue = []
let sending = false
const recentReports = new Map()
const REPORT_COOLDOWN_MS = 30000

function cleanText(value) {
  return String(value || '')
    .replace(/https?:\/\/[^\s?#]+(?:[?#][^\s]*)?/gi, '[url]')
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .replace(/(?:token|cookie|password|authorization|content)[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, MAX_TEXT)
}

export function sanitizeTelemetry(event = {}) {
  return {
    id: String(event.id || (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random())).slice(0, 80),
    type: cleanText(event.type || 'unknown').slice(0, 60),
    message: cleanText(event.message),
    method: cleanText(event.method).slice(0, 100),
    route: cleanText(event.route || (typeof location !== 'undefined' ? location.hash : '')).slice(0, 120),
    durationMs: Number.isFinite(event.durationMs) ? Math.max(0, Math.round(event.durationMs)) : null,
    status: Number.isFinite(event.status) ? event.status : null,
    version: APP_VERSION,
    time: Date.now(),
    online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  }
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE))) } catch (e) {}
}

export function reportTelemetry(event) {
  const sanitized = sanitizeTelemetry(event)
  const dedupe = sanitized.type === 'route-change' || sanitized.type === 'slow-rpc' || sanitized.type === 'long-task'
  const fingerprint = [sanitized.type, sanitized.method, sanitized.message, sanitized.route].join('|')
  const now = Date.now()
  if (dedupe && now - (recentReports.get(fingerprint) || 0) < REPORT_COOLDOWN_MS) return false
  if (dedupe) recentReports.set(fingerprint, now)
  queue.push(sanitized)
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE)
  persist()
  return true
}

function telemetryBase() {
  try {
    const { protocol, hostname, origin } = location
    if (/^https?:$/.test(protocol) && !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hostname)) return origin
    return (localStorage.getItem('dsh-server-url') || '').replace(/\/+$/, '')
  } catch (e) { return '' }
}

export async function flushTelemetry() {
  if (sending || queue.length === 0) return false
  sending = true
  const batch = queue.slice(0, 20)
  try {
    const res = await fetch(telemetryBase() + '/api/client-errors', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ events: batch })
    })
    if (!res.ok) return false
    queue.splice(0, batch.length); persist(); return true
  } catch (e) { return false } finally { sending = false }
}

export function initTelemetry() {
  try { queue = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').slice(-MAX_QUEUE) } catch (e) { queue = [] }
  addEventListener('error', event => reportTelemetry({ type: 'window-error', message: event.message }))
  addEventListener('unhandledrejection', event => reportTelemetry({ type: 'unhandled-rejection', message: event.reason?.message || event.reason }))
  addEventListener('hashchange', () => reportTelemetry({ type: 'route-change', route: location.hash }))
  if (typeof PerformanceObserver === 'function') {
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (entry.duration >= 100) reportTelemetry({ type: 'long-task', durationMs: entry.duration })
      })
      observer.observe({ type: 'longtask', buffered: true })
    } catch (e) {}
  }
  setInterval(flushTelemetry, 10000)
  addEventListener('online', flushTelemetry)
  setTimeout(flushTelemetry, 1000)
}
