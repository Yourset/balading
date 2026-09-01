import React, { useState } from 'react'
import { authUnlock } from '../api.js'

// 锁定页：设备会话过期后，输入自定义密码解锁（不用重新扫码绑定）
export default function LockPage({ deviceId, onUnlocked }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const unlock = async () => {
    if (busy || !pw) return
    setBusy(true); setErr('')
    try { await authUnlock(deviceId, pw); onUnlocked() }
    catch (e) { setErr(e.message || '密码错误') }
    finally { setBusy(false) }
  }

  return (
    <div className="center">
      <div className="logo">🔒</div>
      <h1>私人助手</h1>
      <p>会话已过期，输入密码解锁</p>
      <div style={{ width: '100%', maxWidth: 320 }}>
        <input className="field" type="password" placeholder="输入密码" value={pw}
          onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') unlock() }} />
        {err && <p style={{ color: 'var(--err)', fontSize: 13, marginTop: 10 }}>{err}</p>}
        <button className="btn primary" style={{ width: '100%', marginTop: 16 }} disabled={busy || !pw} onClick={unlock}>
          {busy ? '解锁中…' : '解锁'}
        </button>
      </div>
    </div>
  )
}
