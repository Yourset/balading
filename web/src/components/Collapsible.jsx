import React, { useState } from 'react'

// 默认折叠的内容块：点击头部展开/收起
export default function Collapsible({ label, badge, children, defaultOpen = false, tone = '' }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={'fold' + (tone ? ' fold-' + tone : '')}>
      <button type="button" className="fold-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="fold-arrow">{open ? '▾' : '▸'}</span>
        <span className="fold-label">{label}</span>
        {badge != null && <span className="fold-badge">{badge}</span>}
      </button>
      {open && <div className="fold-body">{children}</div>}
    </div>
  )
}
