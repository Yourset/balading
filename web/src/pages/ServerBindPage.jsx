import React, { useState } from 'react'
import { probeServer, setServerUrl } from '../api.js'

// 首启服务器绑定：输入你自己的巴拉丁网关地址（域名或 VPS IP:端口），校验连通后保存。
// APK（Capacitor 壳）必须配置；PWA（浏览器直接访问服务器域名）同源自动跳过本页。
export default function ServerBindPage({ onDone }) {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const normalize = (v) => {
    let s = String(v || '').trim()
    if (!s) return ''
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s
    return s.replace(/\/+$/, '')
  }

  const doConnect = async () => {
    const target = normalize(url)
    if (!target || busy) return
    setBusy(true); setErr('')
    try {
      const j = await probeServer(target)
      // 严格校验：确认目标确实是巴拉丁网关（返回 {ok:true,value:{t:服务器时间戳}}），而非任意 HTTP 服务
      if (!j || !j.ok || !j.value || typeof j.value.t !== 'number') {
        throw new Error('目标不是巴拉丁网关（或网关未启动）')
      }
      setServerUrl(target)
      onDone(target)
    } catch (e) {
      setErr('无法连接：' + (e.message || '网络错误') + '。请确认地址正确、服务器已部署网关、HTTPS 证书有效。')
    } finally { setBusy(false) }
  }

  return (
    <div className="center">
      <div className="logo">🌐</div>
      <h1>连接你的服务器</h1>
      <p>巴拉丁需要一台已部署的云服务器（含网关 + 域名/IP 中转）才能使用。<br />输入你自己的网关地址：</p>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <input className="field" placeholder="m.yourdomain.com 或 1.2.3.4:8788" value={url} autoCapitalize="off" autoCorrect="off" spellCheck={false}
          onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doConnect() }} />
        {err && <p style={{ color: 'var(--err)', fontSize: 13, marginTop: 10 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn primary" style={{ flex: 1 }} disabled={busy || !url.trim()} onClick={doConnect}>
            {busy ? '连接中…' : '连接并进入'}
          </button>
        </div>
        <p style={{ marginTop: 22, fontSize: 12, color: 'var(--text-2)', textAlign: 'center', lineHeight: 1.7 }}>
          地址由你的服务器部署者提供；不填协议时自动补全 https://<br />
          部署教程见项目 docs/AGENT-INSTALL.md
        </p>
      </div>
    </div>
  )
}
