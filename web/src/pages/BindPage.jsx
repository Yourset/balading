import React, { useState } from 'react'
import { authBind, clearServerUrl } from '../api.js'

// 设备绑定：输入万能授权码（服务器配置，可随时调整）或一次性令牌
export default function BindPage({ onBound }) {
  const [token, setToken] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const doBind = async () => {
    if (!token.trim() || busy) return
    setBusy(true); setErr('')
    try { const d = await authBind(token.trim()); onBound(d.deviceId) }
    catch (e) { setErr(e.message || '绑定失败') }
    finally { setBusy(false) }
  }
  return (
    <div className="center">
      <div className="logo">🤖</div>
      <h1>绑定设备</h1>
      <p>输入授权码绑定此设备</p>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <input className="field" placeholder="输入授权码" value={token}
          onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doBind() }} />
        {err && <p style={{ color: 'var(--err)', fontSize: 13, marginTop: 10 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn primary" style={{ flex: 1 }} disabled={busy || !token.trim()} onClick={doBind}>
            {busy ? '绑定中…' : '绑定并进入'}
          </button>
        </div>
        <p style={{ marginTop: 22, fontSize: 12, color: 'var(--text-2)', textAlign: 'center' }}>
          授权码由服务器配置，可在服务器端随时修改
        </p>
        <button className="btn ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => { if (confirm('确定更换服务器地址？')) { clearServerUrl(); window.location.reload() } }}>
          ⚙️ 更换服务器
        </button>
      </div>
    </div>
  )
}
