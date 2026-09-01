import React, { useState } from 'react'
import { authSetPassword } from '../api.js'

// 绑定后设置自定义密码（可跳过）。设置后：会话过期时可用密码解锁，不用重新绑定。
export default function SetupPassword({ onDone }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (busy) return
    if (pw.length < 4) { setErr('密码至少 4 位'); return }
    if (pw !== pw2) { setErr('两次输入不一致'); return }
    setBusy(true); setErr('')
    try { await authSetPassword(pw); onDone(true) }
    catch (e) { setErr(e.message || '设置失败') }
    finally { setBusy(false) }
  }

  return (
    <div className="center">
      <div className="logo">🔒</div>
      <h1>设置密码（可选）</h1>
      <p style={{ maxWidth: 320 }}>设置后，会话过期时用密码解锁即可，无需重新扫码绑定</p>
      <div style={{ width: '100%', maxWidth: 320 }}>
        <input className="field" type="password" placeholder="设置密码（至少4位）" value={pw}
          onChange={(e) => setPw(e.target.value)} style={{ marginBottom: 10 }} />
        <input className="field" type="password" placeholder="再次输入密码" value={pw2}
          onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
        {err && <p style={{ color: 'var(--err)', fontSize: 13, marginTop: 10 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn ghost" style={{ flex: 1 }} disabled={busy} onClick={() => onDone(false)}>跳过</button>
          <button className="btn primary" style={{ flex: 1 }} disabled={busy || !pw} onClick={save}>
            {busy ? '保存中…' : '保存密码'}
          </button>
        </div>
      </div>
    </div>
  )
}
