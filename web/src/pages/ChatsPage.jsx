import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { DRAFT_EVENT, readDraft } from '../drafts.js'
import { warmAllSessionCaches } from '../sessionCache.js'
import { ASSISTANTS, isAutomatedTaskSession, readAssistantSessionIds } from '../assistantCatalog.js'
import { filterArchivedSessions, withSessionTitle } from '../sessionArchive.js'
import { selectLatestSessionWindow } from '../sessionListWindow.js'
import { emptyPendingQuestions, hasPendingQuestion, reducePendingQuestions } from '../pendingQuestions.js'
import { subscribeMux } from '../mux.js'
import { useVoiceRecorder } from '../voice.js'

const CACHE_KEY = 'dsh-session-list'
const CACHE_TTL = 300000
const INITIAL_RENDER_LIMIT = 10
const RENDER_PAGE_SIZE = 10
const LIST_REFRESH_MS = 30000
let memorySessionList = null

function rel(ts) {
  if (!ts) return ''
  const s = (Date.now() - ts) / 1000
  if (s < 60) return '刚刚'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  if (s < 2592000) return Math.floor(s / 86400) + ' 天前'
  return new Date(ts).toLocaleDateString('zh-CN')
}

function readCache() {
  const now = Date.now()
  if (memorySessionList && now - memorySessionList.t < CACHE_TTL) return memorySessionList
  memorySessionList = null
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    // 旧缓存不含归档集合，不能用于首屏，避免升级后短暂闪出已归档会话。
    if (cached && Array.isArray(cached.items) && Array.isArray(cached.archivedSessionIds)
      && now - Number(cached.t || 0) < CACHE_TTL) {
      memorySessionList = cached
      return cached
    }
  } catch (e) {}
  return null
}

function writeCache(items, archivedSessionIds) {
  const cached = { t: Date.now(), items, archivedSessionIds }
  memorySessionList = cached
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cached)) } catch (e) {}
}

function sessionTitle(session) {
  return session.projections?.values?.title || session.projections?.values?.sessionListMetadata?.title || '新会话'
}

function displayStatus(session, ledgerStatus) {
  if (session.running || ledgerStatus?.status === 'running') return { key: 'running', label: '执行中', unread: false }
  if (ledgerStatus?.status === 'error') return { key: 'error', label: '异常结束', unread: !!ledgerStatus.unread }
  if (ledgerStatus?.status === 'completed' || session.completed) return { key: 'completed', label: '已完成', unread: !!ledgerStatus?.unread }
  return { key: 'off', label: '空闲', unread: false }
}

function SessionRenameDialog({ session, onClose, onSaved }) {
  const [title, setTitle] = useState(() => sessionTitle(session))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const voice = useVoiceRecorder({
    onFinal: recognized => {
      setTitle(String(recognized || '').trim())
      setError('')
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    onError: (message, partialText) => {
      if (partialText) setTitle(String(partialText).trim())
      setError(message || '语音识别失败')
    }
  })
  const voiceActive = voice.state === 'connecting' || voice.state === 'recording'
  const recognizing = voice.state === 'recognizing'

  useEffect(() => { requestAnimationFrame(() => inputRef.current?.focus()) }, [])

  const toggleVoice = async () => {
    setError('')
    if (voiceActive) voice.finish()
    else await voice.start()
  }

  const submit = async event => {
    event.preventDefault()
    const next = title.trim()
    if (!next || saving || voiceActive || recognizing) return
    setSaving(true); setError('')
    try {
      const result = await api.rename({ sessionId: session.sessionId, title: next })
      onSaved(result?.title || next)
    } catch (renameError) {
      setError(renameError.message || '重命名失败')
    } finally { setSaving(false) }
  }

  return <div className="session-dialog-layer" role="presentation">
    <button type="button" className="session-dialog-backdrop" aria-label="关闭重命名" onClick={onClose} />
    <form className="session-rename-dialog" role="dialog" aria-modal="true" aria-label="重命名会话" onSubmit={submit}>
      <div className="session-dialog-head"><strong>重命名会话</strong><button type="button" onClick={onClose} aria-label="关闭">×</button></div>
      <input ref={inputRef} className="field" value={title} maxLength={120} onChange={event => setTitle(event.target.value)}
        placeholder="输入新标题" aria-label="会话新标题" />
      {voice.partial && <div className="session-voice-partial">{voice.partial}</div>}
      <button type="button" className={'session-voice-button' + (voiceActive ? ' active' : '')} onClick={toggleVoice}
        disabled={saving || recognizing || voice.hasRetainedAudio}>
        {recognizing ? '正在识别…' : voiceActive ? `点击结束并识别 · ${voice.elapsedSec}秒` : '🎙 语音输入标题'}
      </button>
      {voice.hasRetainedAudio && <div className="session-voice-recovery">
        <span>录音已保留，可重新识别</span><button type="button" onClick={voice.retry}>重新识别</button><button type="button" onClick={voice.cancel}>放弃录音</button>
      </div>}
      {error && <div className="session-action-error">{error}</div>}
      <div className="session-dialog-actions">
        <button type="button" className="btn ghost" onClick={onClose}>取消</button>
        <button type="submit" className="btn primary" disabled={!title.trim() || saving || voiceActive || recognizing}>{saving ? '保存中…' : '保存标题'}</button>
      </div>
    </form>
  </div>
}

export default function ChatsPage({ mode = 'main', sortOrder = 'newest-first', notificationState, onModeChange }) {
  const cached = useRef(readCache())
  const rootRef = useRef(null)
  const didAutoScroll = useRef(false)
  const pendingScrollAnchorRef = useRef(null)
  const loadingMoreRef = useRef(false)
  const [, setDraftVersion] = useState(0)
  const [items, setItems] = useState(cached.current?.items || [])
  const [archivedSessionIds, setArchivedSessionIds] = useState(cached.current?.archivedSessionIds || [])
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_LIMIT)
  const [pendingQuestions, setPendingQuestions] = useState(() => emptyPendingQuestions())
  const taskModesRef = useRef({})
  const [taskModes, setTaskModes] = useState({})
  const [loading, setLoading] = useState(!cached.current)
  const [err, setErr] = useState('')
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [menuSession, setMenuSession] = useState(null)
  const [renameSession, setRenameSession] = useState(null)
  const [actionBusy, setActionBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [pinned, setPinned] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dsh-pinned') || '[]') } catch (e) { return [] }
  })

  const togglePin = id => {
    setPinned(previous => {
      const next = previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]
      try { localStorage.setItem('dsh-pinned', JSON.stringify(next)) } catch (e) {}
      return next
    })
    setMenuSession(null)
  }

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 2600)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    let alive = true
    let timer = null
    let warmTimer = null
    const refresh = async () => {
      try {
        const [value, workspaceValue] = await Promise.all([api.listSessions(), api.listWorkspaces()])
        if (!alive) return
        const list = value?.items || []
        const archived = workspaceValue?.archivedSessionIds || []
        writeCache(list, archived)
        setItems(list)
        setArchivedSessionIds(archived)
        setErr('')
        // 首屏先让列表完成渲染，再低优先级预热少量普通会话；助手/自动任务按各自页面按需加载。
        // 避免超大会话历史与重复轮询同时占满 DSH/FRP 通道。
        if (warmTimer) clearTimeout(warmTimer)
        const assistantIds = readAssistantSessionIds()
        const assistantTitles = new Set(ASSISTANTS.map(assistant => assistant.title))
        const unarchived = filterArchivedSessions(list, archived)
        const warmable = unarchived
          .filter(session => !isAutomatedTaskSession(session) && !assistantIds.has(session.sessionId) && !assistantTitles.has(sessionTitle(session)))
          .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
          .slice(0, 6)
        warmTimer = setTimeout(() => {
          if (alive) warmAllSessionCaches(warmable, api, { historyLimit: 15, concurrency: 1 }).catch(() => {})
        }, 1500)

        if (mode === 'tasks') {
          // 只在副列表打开时补齐子代理传输模式；已识别的任务不重复请求目录。
          const unresolved = unarchived.filter(session => isAutomatedTaskSession(session) && !taskModesRef.current[session.sessionId])
          const parents = [...new Set(unresolved.map(session => session.parentSessionId || session.parentId).filter(Boolean))]
          const catalogs = await Promise.all(parents.map(parentSessionId => api.listSubagents({ parentSessionId }).then(catalog => ({ parentSessionId, catalog })).catch(() => null)))
          if (!alive) return
          const modes = { ...taskModesRef.current }
          for (const result of catalogs.filter(Boolean)) {
            for (const entry of result.catalog?.entries || []) {
              if (entry.kind === 'child') modes[entry.id] = { parentSessionId: result.parentSessionId, mode: entry.mode }
            }
          }
          taskModesRef.current = modes
          setTaskModes(modes)
        }
      } catch (e) {
        if (!cached.current) setErr(e.message)
      } finally {
        if (alive) setLoading(false)
      }
    }
    refresh()
    timer = setInterval(refresh, LIST_REFRESH_MS)
    return () => { alive = false; if (timer) clearInterval(timer); if (warmTimer) clearTimeout(warmTimer) }
  }, [mode])

  useEffect(() => {
    const refreshDrafts = () => setDraftVersion(value => value + 1)
    window.addEventListener(DRAFT_EVENT, refreshDrafts)
    window.addEventListener('storage', refreshDrafts)
    return () => {
      window.removeEventListener(DRAFT_EVENT, refreshDrafts)
      window.removeEventListener('storage', refreshDrafts)
    }
  }, [])

  // session.list 只返回持久化摘要；待回答问题属于 events.mux 瞬态状态，必须从实时流及其重连回放中维护。
  useEffect(() => subscribeMux(
    envelope => setPendingQuestions(previous => reducePendingQuestions(previous, envelope)),
    { onOpen: () => setPendingQuestions(emptyPendingQuestions()) }
  ), [])

  useEffect(() => {
    didAutoScroll.current = false
    pendingScrollAnchorRef.current = null
    loadingMoreRef.current = false
    setRenderLimit(INITIAL_RENDER_LIMIT)
  }, [mode, sortOrder])

  useEffect(() => {
    if (sortOrder !== 'oldest-first' || loading || !items.length || didAutoScroll.current) return
    didAutoScroll.current = true
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const scroller = rootRef.current?.closest('.scroll')
        if (scroller) scroller.scrollTop = scroller.scrollHeight
      })
    })
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame) }
  }, [items.length, loading, mode, sortOrder])

  const createMobile = async () => {
    setCreating(true); setCreateErr('')
    try {
      const result = await api.create({ agentPreset: 'mobile' })
      if (result?.sessionId) { window.location.hash = '#/chat/' + result.sessionId; return }
      throw new Error('未返回会话 id')
    } catch (e) { setCreateErr('创建失败：' + (e.message || e)) }
    finally { setCreating(false) }
  }

  const archive = async session => {
    if (!session || actionBusy) return
    setActionBusy(session.sessionId); setNotice('')
    try {
      const result = await api.archiveSession({ sessionId: session.sessionId })
      const archived = result?.archivedSessionIds || [...new Set([...archivedSessionIds, session.sessionId])]
      setArchivedSessionIds(archived)
      writeCache(items, archived)
      setPinned(previous => {
        const next = previous.filter(id => id !== session.sessionId)
        try { localStorage.setItem('dsh-pinned', JSON.stringify(next)) } catch (e) {}
        return next
      })
      setMenuSession(null)
      setNotice('已归档“' + sessionTitle(session) + '”')
    } catch (archiveError) {
      setNotice('归档失败：' + (archiveError.message || archiveError))
    } finally { setActionBusy('') }
  }

  const finishRename = title => {
    const targetId = renameSession.sessionId
    setItems(previous => {
      const next = previous.map(session => session.sessionId === targetId ? withSessionTitle(session, title) : session)
      writeCache(next, archivedSessionIds)
      return next
    })
    setRenameSession(null)
    setNotice('标题已更新')
  }

  const assistantIds = readAssistantSessionIds()
  const assistantTitles = new Set(ASSISTANTS.map(assistant => assistant.title))
  const visible = filterArchivedSessions(items.filter(session => !session.blank), archivedSessionIds)
  const taskSessions = visible.filter(isAutomatedTaskSession)
  const mainSessions = visible.filter(session => !isAutomatedTaskSession(session) && !assistantIds.has(session.sessionId) && !assistantTitles.has(sessionTitle(session)))
  const source = mode === 'tasks' ? taskSessions : mainSessions
  const direction = sortOrder === 'oldest-first' ? 1 : -1
  const sorted = [...source].sort((a, b) => direction * ((a.updatedAt || 0) - (b.updatedAt || 0)))
  const pinSet = new Set(pinned)
  const starred = sorted.filter(session => pinSet.has(session.sessionId))
  const regular = sorted.filter(session => !pinSet.has(session.sessionId))
  const grouped = mode === 'tasks'
    ? sorted
    : (sortOrder === 'oldest-first' ? [...regular, ...starred] : [...starred, ...regular])
  const statusMap = new Map((notificationState?.sessions || []).map(status => [status.sessionId, status]))
  // 无论视觉方向如何，首屏只取最近 10 条；滑到旧内容一端时自动补下一批。
  const rendered = selectLatestSessionWindow(grouped, renderLimit, sortOrder)
  const revealMore = () => {
    if (loadingMoreRef.current || renderLimit >= grouped.length) return
    const scroller = rootRef.current?.closest('.scroll')
    if (sortOrder === 'oldest-first' && scroller) {
      pendingScrollAnchorRef.current = { height: scroller.scrollHeight, top: scroller.scrollTop }
    }
    loadingMoreRef.current = true
    setRenderLimit(limit => Math.min(grouped.length, limit + RENDER_PAGE_SIZE))
  }

  // “最新在下”会在顶部插入旧会话；补完后抵消新增高度，保持用户当前看到的位置不跳动。
  useLayoutEffect(() => {
    const scroller = rootRef.current?.closest('.scroll')
    const anchor = pendingScrollAnchorRef.current
    if (scroller && anchor && sortOrder === 'oldest-first') {
      scroller.scrollTop = anchor.top + Math.max(0, scroller.scrollHeight - anchor.height)
    }
    pendingScrollAnchorRef.current = null
    loadingMoreRef.current = false

    // 10 条不足一屏时不会产生滚动事件，自动继续补页直到可滚动或已无更早会话。
    if (scroller && scroller.scrollHeight <= scroller.clientHeight + 1 && renderLimit < grouped.length) {
      if (sortOrder === 'oldest-first') {
        pendingScrollAnchorRef.current = { height: scroller.scrollHeight, top: scroller.scrollTop }
      }
      loadingMoreRef.current = true
      setRenderLimit(limit => Math.min(grouped.length, limit + RENDER_PAGE_SIZE))
    }
  }, [renderLimit, grouped.length, sortOrder])

  useEffect(() => {
    if (loading) return
    const scroller = rootRef.current?.closest('.scroll')
    if (!scroller) return
    const onScroll = () => {
      if (loadingMoreRef.current || rendered.length >= grouped.length) return
      const nearOlderEdge = sortOrder === 'oldest-first'
        ? scroller.scrollTop <= 240
        : scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 240
      if (nearOlderEdge) revealMore()
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [loading, sortOrder, rendered.length, grouped.length])

  if (loading) return <div className="loading"><span className="spin"></span>加载会话…</div>
  if (err && !items.length) return <div className="placeholder">加载失败：{err}</div>

  return (
    <div ref={rootRef} className={'chats-page ' + (mode === 'tasks' ? 'task-list-mode' : 'main-list-mode')}>
      {createErr && <div className="new-chat-error">{createErr}</div>}
      {notice && <div className={'session-action-notice' + (notice.startsWith('归档失败') ? ' error' : '')}>{notice}</div>}
      {mode === 'tasks' && <div className="task-list-summary">
        <span>AI 自动任务</span>
        <strong>{taskSessions.filter(session => session.running).length} 执行中</strong>
        <small>共 {taskSessions.length} 个分支</small>
      </div>}
      <div className={mode === 'tasks' ? 'task-session-grid' : 'main-session-list'}>
        {rendered.map(session => {
          const title = sessionTitle(session)
          const draft = readDraft(session.sessionId).trim()
          const viewStatus = displayStatus(session, statusMap.get(session.sessionId))
          const needsAnswer = hasPendingQuestion(pendingQuestions, session.sessionId)
            || session.pendingInteraction === 'question'
            || session.pendingInteraction === 'plan-review'
          if (mode === 'tasks') {
            const address = taskModes[session.sessionId]
            const parentTitle = sessionTitle(items.find(item => item.sessionId === (session.parentSessionId || session.parentId)) || {})
            const href = address ? `#/task/${encodeURIComponent(address.parentSessionId)}/${encodeURIComponent(session.sessionId)}/${address.mode}` : ''
            const body = <div className={'task-session-card' + (viewStatus.key === 'running' ? ' active' : '') + (viewStatus.unread ? ' unread' : '') + (needsAnswer ? ' awaiting-answer' : '')}>
              <div className="task-session-head"><span className={'dot ' + viewStatus.key + (viewStatus.unread ? ' unread' : '')}></span><span>{viewStatus.label}</span>{needsAnswer && <b className="session-question-badge">❓ 待选择</b>}</div>
              <div className="task-session-title">{title}</div>
              <div className="task-session-parent">来自：{parentTitle === '新会话' ? '助手派发' : parentTitle}</div>
              <div className="task-session-time">{rel(session.updatedAt)}{address?.mode === 'one-shot' ? ' · 只读' : ''}</div>
            </div>
            return href
              ? <a key={session.sessionId} href={href} style={{ color: 'inherit' }} onClick={() => { try { localStorage.setItem('dsh-title-' + session.sessionId, title) } catch (e) {} }}>{body}</a>
              : <div key={session.sessionId}>{body}</div>
          }
          return <div key={session.sessionId} className="session-card-shell">
            <div className={'card' + (viewStatus.key === 'running' ? ' active' : '') + (viewStatus.unread ? ' unread' : '') + (needsAnswer ? ' awaiting-answer' : '')}>
              <div className="row">
                <span className={'dot ' + viewStatus.key + (viewStatus.unread ? ' unread' : '')} aria-label={viewStatus.label}></span>
                <a className="session-card-link grow" href={'#/chat/' + session.sessionId}
                  onClick={() => { try { localStorage.setItem('dsh-title-' + session.sessionId, title) } catch (e) {} }}>
                  <div className="session-title-row"><div className="title">{title}</div>{needsAnswer && <span className="session-question-badge">❓ 待选择</span>}</div>
                  {draft
                    ? <div className="sub draft-sub"><strong>草稿</strong><span> · {draft.replace(/\s+/g, ' ').slice(0, 42)}</span></div>
                    : <div className="sub">{rel(session.updatedAt)}{viewStatus.key !== 'off' ? ' · ' + viewStatus.label : ''}</div>}
                </a>
                <button type="button" className="session-menu-trigger" aria-label={'打开“' + title + '”菜单'}
                  onClick={() => setMenuSession(session)}>⋯</button>
              </div>
            </div>
          </div>
        })}
      </div>
      {source.length === 0 && <div className="placeholder">
        {mode === 'tasks' ? '还没有 AI 自动派发的任务' : '还没有会话，点右下角 ＋ 开始'}
      </div>}
      {menuSession && <div className="session-menu-layer">
        <button type="button" className="session-menu-backdrop" aria-label="关闭会话菜单" onClick={() => setMenuSession(null)} />
        <section className="session-action-sheet" role="menu" aria-label="会话操作">
          <div className="session-action-title">{sessionTitle(menuSession)}</div>
          <button type="button" role="menuitem" onClick={() => togglePin(menuSession.sessionId)}>
            <span>★</span><span><strong>{pinSet.has(menuSession.sessionId) ? '取消置顶' : '置顶会话'}</strong><small>调整它在会话列表中的位置</small></span>
          </button>
          <button type="button" role="menuitem" onClick={() => { setRenameSession(menuSession); setMenuSession(null) }}>
            <span>✎</span><span><strong>重命名</strong><small>支持键盘或语音输入标题</small></span>
          </button>
          <button type="button" role="menuitem" className="archive" disabled={actionBusy === menuSession.sessionId} onClick={() => archive(menuSession)}>
            <span>▣</span><span><strong>{actionBusy === menuSession.sessionId ? '归档中…' : '归档'}</strong><small>归档后不再显示在手机会话列表</small></span>
          </button>
        </section>
      </div>}
      {renameSession && <SessionRenameDialog session={renameSession} onClose={() => setRenameSession(null)} onSaved={finishRename} />}
      <button type="button" className={'list-mode-fab ' + (mode === 'tasks' ? 'tasks-active' : '')}
        onClick={() => onModeChange?.(mode === 'tasks' ? 'main' : 'tasks')}
        aria-label={mode === 'tasks' ? '切回正常会话' : '查看 AI 自动任务'}>
        <span>{mode === 'tasks' ? '💬' : '⚙️'}</span>
        {mode !== 'tasks' && taskSessions.length > 0 && <b>{taskSessions.length > 99 ? '99+' : taskSessions.length}</b>}
      </button>
      <button type="button" className="new-chat-fab" onClick={createMobile} disabled={creating} aria-label="新建手机对话">
        {creating ? <span className="spin" /> : '＋'}
      </button>
    </div>
  )
}
