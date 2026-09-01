// 订阅 /api/events.mux 实时事件。
// DSH HTTP 层对 GET /api/events.mux 返回 426，必须走 WebSocket（浏览器同源 Cookie，网关升级透传）。
// 帧格式：{type:'server-request', rpcId, method, payload}，payload.type 为 'session/event' 等。
// 断线自动重连；App 从后台恢复时强制替换可能“假在线”的 WebSocket。
import { getServerUrl } from './api.js'

export function subscribeMux(onFrame, opts = {}) {
  const srv = getServerUrl()
  const proto = (srv ? /^https:/.test(srv) : location.protocol === 'https:') ? 'wss' : 'ws'
  const host = srv ? srv.replace('https://', '').replace('http://', '') : location.host
  let ws = null
  let closed = false
  let retry = 0
  let retryTimer = null
  let generation = 0
  let appListener = null

  const scheduleReconnect = () => {
    if (closed || retryTimer) return
    const delay = Math.min(1500 * Math.pow(2, retry), 15000)
    retry++
    retryTimer = setTimeout(() => { retryTimer = null; connect() }, delay)
    opts.onRetry?.(delay)
  }

  const connect = (force = false) => {
    if (closed) return
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    if (!force && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    if (force && ws) {
      try { ws.onclose = null; ws.close() } catch (e) {}
    }
    const current = ++generation
    let socket
    try { socket = new WebSocket(proto + '://' + host + '/api/events.mux') }
    catch (e) { opts.onError?.(e); scheduleReconnect(); return }
    ws = socket
    socket.onopen = () => {
      if (closed || current !== generation) { try { socket.close() } catch (e) {}; return }
      retry = 0
      opts.onOpen?.()
    }
    socket.onmessage = (e) => {
      if (closed || current !== generation) return
      try { onFrame(JSON.parse(e.data)) }
      catch (err) { opts.onError?.(err) }
    }
    socket.onerror = () => { if (current === generation) opts.onError?.('mux error') }
    socket.onclose = () => {
      if (closed || current !== generation) return
      scheduleReconnect()
    }
  }

  const resume = () => {
    if (closed) return
    opts.onResume?.()
    connect(true)
  }
  const onVisibility = () => { if (document.visibilityState === 'visible') resume() }
  document.addEventListener('visibilitychange', onVisibility)
  try {
    const app = window.Capacitor?.Plugins?.App
    if (app?.addListener) {
      Promise.resolve(app.addListener('appStateChange', state => { if (state?.isActive) resume() }))
        .then(handle => { if (closed) handle?.remove?.(); else appListener = handle })
        .catch(() => {})
    }
  } catch (e) {}

  connect()
  return () => {
    closed = true
    generation++
    if (retryTimer) clearTimeout(retryTimer)
    document.removeEventListener('visibilitychange', onVisibility)
    try { appListener?.remove?.() } catch (e) {}
    try { ws?.close() } catch (e) {}
  }
}
