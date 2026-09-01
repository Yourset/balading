import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { initNotifications } from './notify.js'
import { initSounds } from './sounds.js'
import { initTelemetry } from './telemetry.js'
import { APP_VERSION } from './version.js'
import './styles.css'
ReactDOM.createRoot(document.getElementById('root')).render(<App />)

// APP 壳内：启动即请求通知权限；首次交互时解锁浏览器音效。
initNotifications()
initSounds()
initTelemetry()

// PWA：注册 Service Worker（静态资源缓存 + API SWR + 离线兜底）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // 注册 URL 带构建时间戳：绕过浏览器对旧 sw.js 的缓存，保证每次发版都能拉到最新 SW。
    const registrationPromise = navigator.serviceWorker.register('/sw.js?v=' + (typeof __BUILD_TS__ !== 'undefined' ? __BUILD_TS__ : Date.now())).catch(() => null)
    let lastReload = 0
    const reloadOnce = () => {
      const now = Date.now()
      if (now - lastReload < 5000) return
      lastReload = now
      window.location.reload()
    }
    const checkForUpdate = async () => {
      try { (await registrationPromise)?.update() } catch (e) {}
      // 独立版本清单不经过旧 JS hash；App 回到前台时可直接发现“页面仍是旧版本”。
      try {
        const response = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
        const deployed = await response.json()
        if (response.ok && deployed?.version && deployed.version !== APP_VERSION) reloadOnce()
      } catch (e) {}
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate() })
    window.addEventListener('focus', checkForUpdate)
    setInterval(checkForUpdate, 60000)
    navigator.serviceWorker.addEventListener('controllerchange', reloadOnce)
    checkForUpdate()
  })
}
