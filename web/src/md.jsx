import React, { useState } from 'react'
import { PhotoViewer } from './components/ImageView.jsx'

// —— 行内元素：**粗体** / *斜体* / ~~删除~~ / `代码` / [链接](url) ——
// 本机发图服务地址（ssa-chat-image-server 127.0.0.1:8791）在手机上不可达，
// 统一重写为同源 /img/ 路径，由 VPS 网关经 frp 隧道代理回本机。
function escUrl(href) {
  if (/^https?:\/\/(127\.0\.0\.1|localhost):8791\//i.test(href)) {
    return href.replace(/^https?:\/\/(127\.0\.0\.1|localhost):8791\//i, '/img/')
  }
  return /^(https?:|mailto:)/i.test(href) ? href : null
}

async function openExternalLink(event, href) {
  const capacitor = window.Capacitor
  const browser = capacitor?.Plugins?.Browser
  if (browser?.open && /^https?:/i.test(href)) {
    event.preventDefault()
    try {
      await browser.open({ url: href })
      return
    } catch (e) {}
  }
  // 旧 APK 还没有 Browser 插件时，至少在当前 WebView 导航；普通浏览器仍走原生 target=_blank。
  if (capacitor?.isNativePlatform?.()) {
    event.preventDefault()
    window.location.href = href
  }
}

function MarkdownImage({ src, alt }) {
  const [open, setOpen] = useState(false)
  return <>
    <img src={src} alt={alt} className="md-img" loading="lazy" onClick={() => setOpen(true)} />
    {open && <PhotoViewer src={src} onClose={() => setOpen(false)} />}
  </>
}

const INLINE = [
  { re: /!\[([^\]]*)\]\(([^)\s]+)\)/, type: 'image' },
  { re: /`([^`]+)`/, type: 'code' },
  { re: /\*\*\*([^*]+)\*\*\*/, type: 'bolditalic' },
  { re: /\*\*([^*]+)\*\*/, type: 'bold' },
  { re: /~~([^~]+)~~/, type: 'del' },
  { re: /\*([^*\n]+)\*/, type: 'italic' },
  { re: /\[([^\]]+)\]\(([^)\s]+)\)/, type: 'link' }
]

function inline(text, keyPrefix) {
  const nodes = []
  let rest = text
  let k = 0
  while (rest) {
    let best = null
    for (const p of INLINE) {
      const m = rest.match(p.re)
      if (m && (!best || m.index < best.pos)) best = { p, m, pos: m.index }
    }
    if (!best) { nodes.push(rest); break }
    if (best.pos > 0) nodes.push(rest.slice(0, best.pos))
    const { p, m } = best
    const key = keyPrefix + '-' + (k++)
    if (p.type === 'image') {
      const href = escUrl(m[2])
      nodes.push(href ? <MarkdownImage key={key} src={href} alt={m[1]} /> : <span key={key}>{m[0]}</span>)
    }
    else if (p.type === 'code') nodes.push(<code key={key}>{m[1]}</code>)
    else if (p.type === 'bolditalic') nodes.push(<strong key={key}><em>{inline(m[1], key + 'i')}</em></strong>)
    else if (p.type === 'bold') nodes.push(<strong key={key}>{inline(m[1], key + 'i')}</strong>)
    else if (p.type === 'italic') nodes.push(<em key={key}>{inline(m[1], key + 'i')}</em>)
    else if (p.type === 'del') nodes.push(<del key={key}>{inline(m[1], key + 'i')}</del>)
    else if (p.type === 'link') {
      const href = escUrl(m[2])
      nodes.push(href ? <a key={key} href={href} target="_blank" rel="noreferrer" onClick={(event) => openExternalLink(event, href)}>{inline(m[1], key + 't')}</a> : m[0])
    }
    rest = rest.slice(best.pos + m[0].length)
  }
  return nodes
}

// 段落内换行 → <br/>
function paraNodes(t, k) {
  const parts = String(t).split('\n')
  const out = []
  parts.forEach((p, i) => {
    if (i > 0) out.push(<br key={k + '-br' + i} />)
    out.push(inline(p, k + '-' + i))
  })
  return out
}

// —— 块级解析 ——
function parseBlocks(text) {
  const lines = String(text).split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const t = line.trim()
    if (!t) { i++; continue }

    const fence = t.match(/^```(\S*)\s*$/)
    if (fence) {
      const lang = fence[1]
      const buf = []
      i++
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++ }
      i++
      blocks.push({ type: 'code', lang, text: buf.join('\n') })
      continue
    }

    const h = t.match(/^(#{1,6})\s+(.*)$/)
    if (h) { blocks.push({ type: 'h' + h[1].length, text: h[2] }); i++; continue }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { blocks.push({ type: 'hr' }); i++; continue }

    if (t.startsWith('>')) {
      const buf = []
      while (i < lines.length && lines[i].trim().startsWith('>')) { buf.push(lines[i].trim().replace(/^>\s?/, '')); i++ }
      blocks.push({ type: 'quote', text: buf.join('\n') })
      continue
    }

    const ul = t.match(/^[-*+]\s+(.*)$/)
    if (ul) {
      const items = []
      while (i < lines.length) {
        const tt = lines[i].trim()
        const m = tt.match(/^[-*+]\s+(.*)$/)
        if (m) { items.push(m[1]); i++; continue }
        if (tt && items.length && !/^#{1,6}\s/.test(tt) && !/^```/.test(tt)) { items[items.length - 1] += '\n' + tt; i++; continue }
        break
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    const ol = t.match(/^\d+[.)]\s+(.*)$/)
    if (ol) {
      const items = []
      while (i < lines.length) {
        const tt = lines[i].trim()
        const m = tt.match(/^\d+[.)]\s+(.*)$/)
        if (m) { items.push(m[1]); i++; continue }
        if (tt && items.length && !/^#{1,6}\s/.test(tt) && !/^```/.test(tt)) { items[items.length - 1] += '\n' + tt; i++; continue }
        break
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    if (t.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim())
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim()))
        i++
      }
      blocks.push({ type: 'table', head, rows })
      continue
    }

    const buf = [line]
    i++
    while (i < lines.length) {
      const tt = lines[i].trim()
      if (!tt) break
      if (/^```/.test(tt) || /^(#{1,6})\s/.test(tt) || /^[-*+]\s/.test(tt) || /^\d+[.)]\s/.test(tt) || tt.startsWith('>') || /^(-{3,}|\*{3,}|_{3,})$/.test(tt)) break
      buf.push(lines[i])
      i++
    }
    blocks.push({ type: 'p', text: buf.join('\n') })
  }
  return blocks
}

function renderBlock(b, i) {
  switch (b.type) {
    case 'code':
      return <pre key={i} className="md-pre"><code>{b.text}</code></pre>
    case 'h1': return <h1 key={i}>{inline(b.text, 'h1')}</h1>
    case 'h2': return <h2 key={i}>{inline(b.text, 'h2')}</h2>
    case 'h3': return <h3 key={i}>{inline(b.text, 'h3')}</h3>
    case 'h4': return <h4 key={i}>{inline(b.text, 'h4')}</h4>
    case 'h5': return <h5 key={i}>{inline(b.text, 'h5')}</h5>
    case 'h6': return <h6 key={i}>{inline(b.text, 'h6')}</h6>
    case 'hr': return <hr key={i} />
    case 'quote': return <blockquote key={i}>{paraNodes(b.text, 'q' + i)}</blockquote>
    case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}>{paraNodes(it, 'u' + i + '-' + j)}</li>)}</ul>
    case 'ol': return <ol key={i}>{b.items.map((it, j) => <li key={j}>{paraNodes(it, 'o' + i + '-' + j)}</li>)}</ol>
    case 'table':
      return (
        <div key={i} className="md-table-wrap"><table>
          <thead><tr>{b.head.map((c, j) => <th key={j}>{inline(c, 'th' + i + '-' + j)}</th>)}</tr></thead>
          <tbody>{b.rows.map((row, j) => (
            <tr key={j}>{row.map((c, k) => <td key={k}>{inline(c, 'td' + i + '-' + j + '-' + k)}</td>)}</tr>
          ))}</tbody>
        </table></div>
      )
    case 'p':
    default:
      return <p key={i}>{paraNodes(b.text, 'p' + i)}</p>
  }
}

export default function Markdown({ text }) {
  if (!text) return null
  const blocks = parseBlocks(text)
  return <div className="md">{blocks.map((b, i) => renderBlock(b, i))}</div>
}
