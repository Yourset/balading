import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import ChatPage from './ChatPage.jsx'
import { DSH_WORKSPACE } from '../workspaceConfig.js'

// AI绘画固定会话：描述 → 本机 DSH 调画图能力（imagegen）→ 图片回显。
// 会话查找/创建策略与私人助手一致；快捷提示词直接走 session.prompt 发送。
const PAINT_TITLE = 'AI绘画'
const PAINT_PRESET = 'mobile'
const PAINT_CWD = DSH_WORKSPACE
const KEY = 'dsh-paint-sid'

const QUICK = [
  '画一只柴犬头像，暖色简约风格',
  '画一张太空站餐厅内部场景插画，手绘暖色',
  '生成一个游戏物品图标：青苹果，圆润可爱',
  '画一个卡通太空厨师角色，Q版'
]

async function resolveSession() {
  // 缓存命中 → 直接复用（sessionId 始终有效，不依赖列表）
  let cached = null
  try { cached = localStorage.getItem(KEY) } catch (e) {}
  if (cached) return cached
  // 按标题找已有会话（跳过 blank 空会话）
  try {
    const v = await api.listSessions()
    const items = (v && v.items) || []
    const found = items.find(s => (s.projections && s.projections.values && s.projections.values.title) === PAINT_TITLE && !s.blank)
    if (found) { try { localStorage.setItem(KEY, found.sessionId) } catch (e) {}; return found.sessionId }
  } catch (e) {}
  // 创建新会话并设置标题
  try {
    const v = await api.create({ title: PAINT_TITLE, agentPreset: PAINT_PRESET, cwd: PAINT_CWD })
    if (v && v.sessionId) {
      try { localStorage.setItem(KEY, v.sessionId) } catch (e) {}
      try { await api.rename({ sessionId: v.sessionId, title: PAINT_TITLE }) } catch (e) {}
      return v.sessionId
    }
  } catch (e) {}
  return null
}

export default function PaintPage({ onTitle }) {
  const [sid, setSid] = useState(undefined)
  const [empty, setEmpty] = useState(true)
  const [sending, setSending] = useState('')

  useEffect(() => {
    let alive = true
    resolveSession().then(id => { if (!alive) return; setSid(id || null) })
    return () => { alive = false }
  }, [])

  const sendQuick = async (text) => {
    if (!sid || sending) return
    setSending(text)
    try {
      await api.prompt({ sessionId: sid, mode: 'steer', content: [{ type: 'text', text }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    } catch (e) { /* ChatPage 会显示发送失败 */ }
    finally { setSending('') }
  }

  if (sid === undefined) return <div className="loading"><span className="spin"></span>打开 AI 绘画…</div>
  if (sid === null) return <div className="placeholder">AI 绘画会话打开失败，请稍后重试</div>

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      {empty && (
        <div className="paint-welcome">
          <div className="aw-title">🎨 AI 绘画</div>
          <div className="aw-sub">描述你想画的画面，AI 帮你生成图片。试试下面的示例，或直接输入自己的描述：</div>
          <div className="chips">
            {QUICK.map(t => (
              <button key={t} className="chip" disabled={!!sending} onClick={() => sendQuick(t)}>
                {sending === t ? '生成中…' : t}
              </button>
            ))}
          </div>
        </div>
      )}
      <ChatPage sessionId={sid} onTitle={onTitle} onHasMessages={(has) => setEmpty(!has)} />
    </div>
  )
}
