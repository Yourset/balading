import { getServerUrl } from './api.js'

let nativeConfigured = false

function plugin() {
  return window.Capacitor?.Plugins?.KeepAlive || null
}

export function nativeNotificationAvailable() {
  return nativeConfigured
}

/** 配置原生后台同步地址；只有 Cookie 已可用时才接管 WebView 的后台通知兜底。 */
export async function configureNativeNotifications(deviceId) {
  const value = plugin()
  if (!value?.configure) return false
  const serverUrl = getServerUrl() || window.location.origin
  const result = await value.configure({ serverUrl, deviceId: deviceId || '' })
  nativeConfigured = !!result?.authenticated
  return nativeConfigured
}

export async function setNativeAppVisibility(active) {
  try { await plugin()?.setVisibility?.({ active: !!active }) } catch (e) {}
}

export async function dismissNativeSession(sessionId) {
  try { await plugin()?.dismissSession?.({ sessionId }) } catch (e) {}
}

export async function consumeNativeNotificationOpen() {
  try {
    const result = await plugin()?.consumeOpen?.()
    return result?.sessionId || ''
  } catch (e) { return '' }
}
