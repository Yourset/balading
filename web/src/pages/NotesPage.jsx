import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createNoteCapsule, listNotes, readNote, retryNoteCapsule } from '../api.js'
import { NOTE_SORT_KEY, sortNotes } from '../noteSorting.js'
import { useVoiceRecorder } from '../voice.js'

function rel(ts) {
  if (!ts) return ''
  const s = (Date.now() - ts) / 1000
  if (s < 60) return '刚刚'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  if (s < 2592000) return Math.floor(s / 86400) + ' 天前'
  return new Date(ts).toLocaleDateString('zh-CN')
}

function clock(seconds) {
  const value = Math.max(0, Number(seconds) || 0)
  return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0')
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function inline(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}
function mdToHtml(md) {
  const lines = String(md || '').split('\n')
  const out = []
  let inTable = false
  let tableRows = []
  let inCode = false
  let codeBuf = []
  let inList = false
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false } }
  const closeTable = () => {
    if (inTable) {
      const head = tableRows[0] || []
      const body = tableRows.slice(1)
      let h = '<table><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>'
      h += body.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('')
      out.push(h + '</tbody></table>')
      tableRows = []; inTable = false
    }
  }
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('```')) {
      if (inCode) { out.push('<pre>' + escapeHtml(codeBuf.join('\n')) + '</pre>'); codeBuf = []; inCode = false }
      else { closeList(); closeTable(); inCode = true }
      continue
    }
    if (inCode) { codeBuf.push(line); continue }
    if (!t) { closeList(); closeTable(); out.push('<br>'); continue }
    if (/^\|/.test(t) && /\|\s*$/.test(t)) {
      closeList()
      const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
      if (cells.every(c => /^:?-{2,}:?$/.test(c || ''))) continue
      if (!inTable && tableRows.length === 0) inTable = true
      tableRows.push(cells)
      continue
    }
    if (inTable) closeTable()
    if (/^#{1,3}\s/.test(t)) {
      closeList()
      const level = t.match(/^#+/)[0].length
      out.push('<h' + level + '>' + inline(t.replace(/^#+\s*/, '')) + '</h' + level + '>')
      continue
    }
    if (/^[-*]\s/.test(t)) {
      if (!inList) { inList = true; out.push('<ul>') }
      out.push('<li>' + inline(t.replace(/^[-*]\s*/, '')) + '</li>')
      continue
    }
    if (/^>\s?/.test(t)) {
      closeList(); out.push('<blockquote>' + inline(t.replace(/^>\s?/, '')) + '</blockquote>'); continue
    }
    closeList(); out.push('<p>' + inline(t) + '</p>')
  }
  closeList(); closeTable()
  if (inCode) out.push('<pre>' + escapeHtml(codeBuf.join('\n')) + '</pre>')
  return out.join('\n')
}

function readSort() {
  try { return localStorage.getItem(NOTE_SORT_KEY) || 'updated' } catch (error) { return 'updated' }
}

function CapsuleRecorder({ onCreated }) {
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [recoveredText, setRecoveredText] = useState('')
  const requestIdRef = useRef('')

  const saveTranscript = async (transcript) => {
    const text = String(transcript || '').trim()
    if (!text || saving) return
    if (!requestIdRef.current) requestIdRef.current = `capsule-${Date.now()}-${Math.random().toString(16).slice(2)}`
    setSaving(true); setError(''); setMessage('正在把原话保存到云端…')
    try {
      const capsule = await createNoteCapsule(text, requestIdRef.current)
      requestIdRef.current = ''
      setRecoveredText('')
      setMessage('原话已保存，AI 正在生成标题、分类和精炼稿。')
      onCreated?.(capsule)
    } catch (saveError) {
      setError(saveError.message || '闪念保存失败')
      setRecoveredText(text)
      setMessage('')
    } finally { setSaving(false) }
  }

  const voice = useVoiceRecorder({
    onFinal: saveTranscript,
    onError: (reason, partialText) => {
      setError(reason || '语音识别失败')
      if (partialText) setRecoveredText(String(partialText).trim())
    }
  })

  const active = ['connecting', 'recording'].includes(voice.state)
  const start = async () => {
    requestIdRef.current = ''
    setMessage(''); setError(''); setRecoveredText('')
    await voice.start()
  }
  const mainAction = () => {
    if (active) voice.finish()
    else if (voice.state === 'idle' || voice.state === 'error') start()
  }
  const mainLabel = voice.state === 'connecting' ? '正在连接，点击结束'
    : voice.state === 'recording' ? `点击结束并整理 · ${clock(voice.elapsedSec)}`
      : voice.state === 'recognizing' ? '正在识别原话…'
        : saving ? '正在保存原话…' : '🎙 记录一个闪念'

  return <section className={'capsule-recorder card' + (active ? ' active' : '')}>
    <div className="capsule-recorder-title"><strong>💊 语音闪念胶囊</strong><span>原话先上云，再由 AI 整理</span></div>
    <button className={'capsule-record-button' + (active ? ' recording' : '')} onClick={mainAction}
      disabled={saving || voice.state === 'recognizing' || (voice.state === 'error' && voice.hasRetainedAudio)}>{mainLabel}</button>
    {voice.partial && <div className="capsule-live-text">{voice.partial}</div>}
    {voice.warning && !voice.extended && <button className="capsule-secondary" onClick={voice.extend}>继续说到 2 分钟</button>}
    {voice.hasRetainedAudio && <div className="capsule-recovery">
      <span>已保留约 {voice.retainedDurationSec} 秒录音</span>
      <button onClick={voice.retry}>重新识别</button><button onClick={voice.cancel}>放弃本次</button>
    </div>}
    {recoveredText && !voice.hasRetainedAudio && <button className="capsule-secondary" onClick={() => saveTranscript(recoveredText)}>保存当前已识别文字</button>}
    {message && <div className="capsule-success">✓ {message}</div>}
    {error && <div className="capsule-error">{error}</div>}
  </section>
}

export default function NotesPage() {
  const [hash, setHash] = useState(window.location.hash || '')
  useEffect(() => {
    const update = () => setHash(window.location.hash || '')
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  if (hash.startsWith('#/notes/')) return <NoteDetail name={decodeURIComponent(hash.slice('#/notes/'.length))} />
  return <NoteList />
}

function NoteList() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [sortMode, setSortMode] = useState(readSort)
  const load = useCallback((quiet = false) => {
    if (!quiet) setLoading(true)
    return listNotes().then(value => { setItems(value?.items || []); setErr('') })
      .catch(error => setErr(error.message)).finally(() => { if (!quiet) setLoading(false) })
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!items.some(item => item.status === 'processing')) return
    const timer = setTimeout(() => load(true), 3500)
    return () => clearTimeout(timer)
  }, [items, load])

  const visible = useMemo(() => sortNotes(items.filter(item => item.name !== 'memory.md'), sortMode), [items, sortMode])
  const chooseSort = event => {
    const value = event.target.value
    setSortMode(value)
    try { localStorage.setItem(NOTE_SORT_KEY, value) } catch (error) {}
  }
  const created = capsule => {
    setItems(previous => [capsule, ...previous.filter(item => item.name !== capsule.name)])
    setTimeout(() => load(true), 2500)
  }

  return <div className="notes-page">
    <CapsuleRecorder onCreated={created} />
    <div className="notes-toolbar">
      <div><strong>📓 AI 笔记</strong><small>闪念、总结、方案与记忆归档</small></div>
      <select value={sortMode} onChange={chooseSort} aria-label="笔记排列方式">
        <option value="updated">最近更新</option>
        <option value="created">最近创建</option>
        <option value="category">按分类</option>
      </select>
    </div>
    {loading && !items.length && <div className="loading"><span className="spin"></span>加载笔记…</div>}
    {err && <div className="placeholder">加载失败：{err}</div>}
    <div className="note-list">
      {visible.map(note => <a key={note.name} href={'#/notes/' + encodeURIComponent(note.name)} className="note-list-link">
        <article className={'card note-list-card ' + (note.status || 'ready')}>
          <div className="note-list-top">
            <span className="note-category">{note.category || '归档'}</span>
            {note.kind === 'capsule' && <span className={'note-status ' + note.status}>{note.status === 'processing' ? 'AI 整理中' : note.status === 'failed' ? '整理失败' : '闪念'}</span>}
          </div>
          <div className="title">{note.title}</div>
          {!!note.tags?.length && <div className="note-tags">{note.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
          <div className="sub">{rel(sortMode === 'created' ? note.createdAt : note.updatedAt)}{note.size ? ' · ' + Math.max(1, Math.round(note.size / 1024)) + 'KB' : ''}</div>
        </article>
      </a>)}
    </div>
    {!loading && !visible.length && <div className="placeholder">还没有笔记，先说出第一个闪念吧</div>}
  </div>
}

function NoteDetail({ name }) {
  const [note, setNote] = useState(null)
  const [err, setErr] = useState('')
  const [retrying, setRetrying] = useState(false)
  const load = useCallback(() => readNote(name).then(value => { setNote(value); setErr('') }).catch(error => setErr(error.message)), [name])
  useEffect(() => { setNote(null); setErr(''); load() }, [load])
  useEffect(() => {
    if (note?.status !== 'processing') return
    const timer = setTimeout(load, 3500)
    return () => clearTimeout(timer)
  }, [note, load])

  const legacyHtml = useMemo(() => note?.kind === 'note' ? mdToHtml(note.content) : '', [note])
  const refinedHtml = useMemo(() => note?.kind === 'capsule' ? mdToHtml(note.refined) : '', [note])
  const retry = async () => {
    setRetrying(true); setErr('')
    try { setNote(await retryNoteCapsule(note.id)) } catch (error) { setErr(error.message) }
    finally { setRetrying(false) }
  }

  if (err && !note) return <div className="placeholder">读取失败：{err}</div>
  if (!note) return <div className="loading"><span className="spin"></span>读取笔记…</div>
  if (note.kind !== 'capsule') return <div>
    <div className="note-head card"><div className="title">{note.title}</div><div className="sub">{new Date(note.updatedAt).toLocaleString('zh-CN')} 更新</div></div>
    <div className="card note-md" dangerouslySetInnerHTML={{ __html: legacyHtml }} />
  </div>

  return <div className="capsule-detail">
    <div className="note-head card">
      <div className="note-list-top"><span className="note-category">{note.category}</span><span className={'note-status ' + note.status}>{note.status === 'processing' ? 'AI 整理中' : note.status === 'failed' ? '整理失败' : '已整理'}</span></div>
      <div className="title">{note.title}</div>
      {!!note.tags?.length && <div className="note-tags">{note.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
      <div className="sub">创建于 {new Date(note.createdAt).toLocaleString('zh-CN')} · {rel(note.updatedAt)}更新</div>
    </div>
    {err && <div className="capsule-error">{err}</div>}
    {note.status === 'failed' && <div className="card capsule-failed"><strong>原话已经安全保存</strong><span>{note.error || 'AI 暂时没有整理成功'}</span><button onClick={retry} disabled={retrying}>{retrying ? '正在重试…' : '重新让 AI 整理'}</button></div>}
    <section className="card capsule-refined"><h2>AI 精炼</h2><div className="note-md" dangerouslySetInnerHTML={{ __html: refinedHtml }} /></section>
    <details className="card capsule-original"><summary>查看原始逐字稿</summary><div>{note.transcript}</div></details>
  </div>
}
