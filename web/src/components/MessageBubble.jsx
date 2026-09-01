import React, { useState } from 'react'
import Markdown from '../md.jsx'
import Collapsible from './Collapsible.jsx'
import ImageView, { PhotoViewer } from './ImageView.jsx'

// 系统注入类文本（system-reminder / 记忆摘要 / 指令头），用户无需在手机上看到
const SYSTEM_JUNK = /(<system-reminder>|<system_warning>|Instructions from:|memory_summary\.md|codex memory summary|^User Profile|AGENTS\.md|Codex\s*memory)/i
function isSystemText(t) {
  const s = String(t || '').trim()
  if (!s) return false
  return SYSTEM_JUNK.test(s)
}
// 只保留对用户有意义的内容块
function visibleBlocks(blocks, hideTechnicalEvents = false) {
  if (!blocks) return []
  return blocks.filter(b => {
    if (b.clientHidden) return false
    if (b.type === 'reasoning') return false
    if (hideTechnicalEvents && (b.type === 'tool-call' || b.type === 'tool-result')) return false
    if (b.type === 'text' && isSystemText(b.text)) return false
    return true
  })
}

function Base64Image({ src, alt }) {
  const [open, setOpen] = useState(false)
  return <div className="msg-image">
    <img src={src} alt={alt} className="msg-img-thumb" onClick={() => setOpen(true)} />
    {open && <PhotoViewer src={src} onClose={() => setOpen(false)} />}
  </div>
}

// 渲染 content 块（text→Markdown；reasoning/tool 默认折叠）
function Blocks({ blocks, sessionId }) {
  if (!blocks) return null
  return blocks.map((b, i) => {
    if (b.type === 'text') return <Markdown key={i} text={b.text} />
    if (b.type === 'reasoning') return null
    if (b.type === 'tool-call') return <div key={i} className="tool-mini">🛠 已调用工具</div>
    if (b.type === 'tool-result') return <div key={i} className={'tool-mini' + (b.isError ? ' err' : '')}>{b.isError ? '⚠️ 工具出错' : '✅ 工具完成'}</div>
    if (b.type === 'image') {
      // 附件引用（history 标准格式）：缩略图 + 点击看原图；老格式带 data 直接显示
      if (b.attachment) return <ImageView key={i} sessionId={sessionId} attachment={b.attachment} />
      if (b.data) return <Base64Image key={i} src={'data:' + (b.mediaType || 'image/png') + ';base64,' + b.data} alt={b.name || '图片'} />
      return <div key={i} className="msg-image">🖼 {b.name || '图片'}</div>
    }
    return <div key={i}>{typeof b === 'string' ? b : JSON.stringify(b)}</div>
  })
}

// 发送确认勾（两档）：灰单勾=已收到/执行中；蓝双勾=已处理完
function Tick({ status }) {
  if (status === 'received') return <span className="tick received">✓</span>
  if (status === 'done') return <span className="tick done">✓✓</span>
  return <span className="tick sent">✓</span>
}

// 消息：event 中的一条，按 type 渲染
export default function MessageBubble({ event, sessionId, status, hideTechnicalEvents = false }) {
  const d = event.data || {}
  if (event.type === 'user/message') {
    const blocks = visibleBlocks(d.content, hideTechnicalEvents)
    if (!blocks.length) return null // 整条都是系统内容 → 不显示
    return (
      <div className="msg user">
        <div className="bubble-wrap">
          <div className="bubble"><Blocks blocks={blocks} sessionId={sessionId} /></div>
          <Tick status={status} />
        </div>
      </div>
    )
  }
  if (event.type === 'assistant/message') {
    const src = d.message?.source || {}
    const blocks = visibleBlocks(d.message?.content, hideTechnicalEvents)
    if (!blocks.length) return null
    return <div className="msg assistant"><div className="bubble">
      <Blocks blocks={blocks} sessionId={sessionId} />
      {src.model && <div className="meta">{src.model}</div>}
    </div></div>
  }
  if (event.type === 'tool/call' || event.type === 'tool/result') {
    if (hideTechnicalEvents) return null
    const isResult = event.type === 'tool/result'
    const blocks = d.message?.content || []
    const isError = isResult && blocks.some(block => block.isError)
    const time = new Date(event.time || Date.now())
    const hh = String(time.getHours()).padStart(2, '0')
    const mm = String(time.getMinutes()).padStart(2, '0')
    return <div className={'tool-mini' + (isError ? ' err' : '')}>
      {isResult ? (isError ? '⚠️ 工具出错' : '✅ 工具完成') : '🛠 已调用工具'} · <span className="tool-mini-time">{hh}:{mm}</span>
    </div>
  }
  return null
}
