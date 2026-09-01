import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { subscribeMux } from '../mux.js'
import { notifyReplyDone, updateKeepAlive } from '../notify.js'
import { playAcceptedPromptSound } from '../sounds.js'
import { beginPromptAttempt, finishPromptAttempt } from '../promptIdempotency.js'
import { readHistoryCache as readHistorySnapshot, writeHistoryCache } from '../sessionCache.js'
import { withOptimizerPolicy } from '../optimizerPrompt.js'
import MessageBubble from '../components/MessageBubble.jsx'
import Composer from '../components/Composer.jsx'
import Markdown from '../md.jsx'

const RENDERABLE = ['user/message', 'assistant/message', 'tool/call', 'tool/result']
const PAGE = 15 // 每次加载的消息条数（性能：单条消息含上千个流式 chunk 事件）

// 事件 → 渲染项（含流式 live 聚合）
function applyEvent(prev, event) {
  const type = event.type
  if (type === 'assistant/chunk') {
    const chunk = event.data?.chunk || {}
    // 思考增量不拼入正文；正文只接收文本增量
    if ((chunk.type || 'text-delta') === 'reasoning-delta') return prev
    const text = chunk.text || ''
    if (!text) return prev
    const last = prev[prev.length - 1]
    if (last && last.live) return [...prev.slice(0, -1), { ...last, text: last.text + text }]
    return [...prev, { live: true, text }]
  }
  if (RENDERABLE.includes(type)) {
    if (type === 'assistant/message') {
      // 最终消息到达：清掉所有流式 live 残留（避免同一段正文显示两遍）
      const withoutLive = prev.filter(it => !it.live)
      return [...withoutLive, { event }]
    }
    return [...prev, { event }]
  }
  return prev
}

function toRenderables(events) {
  return (events || []).map(e => e.event).filter(e => e && RENDERABLE.includes(e.type))
}

function readHistoryCache(sessionId) {
  return readHistorySnapshot(sessionId)?.events?.filter(Boolean) || []
}

function readSoundSource(sessionId) {
  try { return String(localStorage.getItem('dsh-title-' + sessionId) || '').trim() } catch (e) { return '' }
}

function cachedRenderItems(events) {
  return (events || []).map(event => ({ event }))
}

function makeQuestionDrafts(questions) {
  const drafts = {}
  for (const q of questions || []) drafts[q.id] = { selected: [], custom: '', skipped: false }
  return drafts
}

// ask_user_question 是 mux 瞬态交互，不是历史 tool/call；回答必须回显请求 rpcId。
function QuestionPanel({ request, onSettled }) {
  const questions = request.payload.questions || []
  const [drafts, setDrafts] = useState(() => makeQuestionDrafts(questions))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setDrafts(makeQuestionDrafts(questions))
    setSubmitting(false)
    setError('')
    setCollapsed(false)
  }, [request.rpcId])

  const updateDraft = (id, update) => {
    setDrafts(prev => ({ ...prev, [id]: update(prev[id] || { selected: [], custom: '', skipped: false }) }))
    setError('')
  }
  const choose = (q, label) => updateDraft(q.id, current => {
    if (q.multiSelect) {
      const selected = current.selected.includes(label)
        ? current.selected.filter(x => x !== label)
        : [...current.selected, label]
      return { ...current, selected, skipped: false }
    }
    return { selected: [label], custom: '', skipped: false }
  })
  const custom = (q, text) => updateDraft(q.id, current => ({
    ...current,
    selected: q.multiSelect ? current.selected : [],
    custom: text,
    skipped: false
  }))
  const skip = (q) => updateDraft(q.id, () => ({ selected: [], custom: '', skipped: true }))

  const sendResult = async (result) => {
    if (submitting) return
    setSubmitting(true); setError('')
    try {
      const receipt = await api.respond({ type: 'client-response', rpcId: request.rpcId, result })
      if (!receipt.accepted) {
        setSubmitting(false)
        setError(receipt.reason === 'not-pending' ? '此问题已在其他页面处理，请刷新后重试。' : '回答格式未被 DSH 接受，请检查后重试。')
        return
      }
      onSettled(request.rpcId)
    } catch (e) {
      setSubmitting(false)
      setError(e.message || '提交失败，请重试。')
    }
  }

  const submit = () => {
    const missing = questions.find(q => {
      const d = drafts[q.id] || { selected: [], custom: '', skipped: false }
      return !d.skipped && !d.selected.length && !d.custom.trim()
    })
    if (missing) { setError('请回答或跳过“' + missing.question + '”。'); return }
    const answers = questions.map(q => {
      const d = drafts[q.id]
      if (d.skipped) return { id: q.id, selected: [] }
      const text = d.custom.trim()
      return {
        id: q.id,
        selected: text && !q.multiSelect ? [] : d.selected,
        ...(text ? { custom: text } : {})
      }
    })
    sendResult({ ok: true, value: { sessionId: request.payload.sessionId, answer: { answers } } })
  }

  const cancel = () => sendResult({
    ok: false,
    error: { code: 'cancelled', message: 'the user closed this question request', details: {} }
  })

  if (collapsed) return <section className="question-card question-card-collapsed" aria-label="需要你的回答（已收起）">
    <button type="button" className="question-collapse-bar" onClick={() => setCollapsed(false)} aria-expanded="false">
      <span>❓</span>
      <span className="question-collapse-summary">待回答：{questions[0]?.question || '需要你的回答'}</span>
      <strong>展开⌃</strong>
    </button>
  </section>

  return <section className="question-card" aria-label="需要你的回答">
    <div className="question-card-head">
      <span>❓</span><strong>需要你的回答</strong>
      <button type="button" className="question-collapse-toggle" onClick={() => setCollapsed(true)} aria-expanded="true">收起⌄</button>
    </div>
    {questions.map((q, index) => {
      const d = drafts[q.id] || { selected: [], custom: '', skipped: false }
      return <div className="question-item" key={q.id}>
        {q.header && <div className="question-header">{q.header}</div>}
        <div className="question-title">{index + 1}. {q.question}</div>
        {q.detail && <div className="question-detail"><Markdown text={q.detail} /></div>}
        {!!q.options?.length && <div className="question-options">
          {q.options.map(option => {
            const selected = d.selected.includes(option.label)
            return <button type="button" key={option.label}
              className={'question-option' + (selected ? ' selected' : '')}
              aria-pressed={selected} disabled={submitting}
              onClick={() => choose(q, option.label)}>
              <span className="question-option-mark">{q.multiSelect ? (selected ? '☑' : '☐') : (selected ? '●' : '○')}</span>
              <span><span className="question-option-label">{option.label}</span>
                {option.description && <span className="question-option-desc">{option.description}</span>}
              </span>
            </button>
          })}
        </div>}
        <textarea className="question-custom" rows={2} value={d.custom}
          disabled={submitting} placeholder="其他回答（可选）"
          onChange={e => custom(q, e.target.value)} />
        <button type="button" className={'question-skip' + (d.skipped ? ' active' : '')}
          disabled={submitting} onClick={() => skip(q)}>{d.skipped ? '已跳过此题' : '跳过此题'}</button>
      </div>
    })}
    {error && <div className="question-error" role="alert">{error}</div>}
    <div className="question-actions">
      <button type="button" className="btn ghost" disabled={submitting} onClick={cancel}>取消整个提问</button>
      <button type="button" className="btn primary" disabled={submitting} onClick={submit}>{submitting ? '提交中…' : '提交回答'}</button>
    </div>
  </section>
}

export default function ChatPage({ sessionId, subagentAddress, onTitle, onHasMessages, onRunningChange, onPendingQuestionChange, optimizerPolicy = '', hideTechnicalEvents = false }) {
  const initialCache = useRef(readHistoryCache(sessionId))
  const loadHistory = (params = {}) => subagentAddress
    ? api.subagentHistory({ ...subagentAddress, ...params })
    : api.history({ sessionId, ...params })
  const [items, setItems] = useState(() => cachedRenderItems(initialCache.current))
  const [loading, setLoading] = useState(() => initialCache.current.length === 0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [olderLoading, setOlderLoading] = useState(false)
  const olderLoadingRef = useRef(false)
  const olderScrollAnchorRef = useRef(null)
  const [hasOlder, setHasOlder] = useState(false)
  const [thinkLines, setThinkLines] = useState([]) // 思考进度文字，按行存储（双行上滚字幕）
  // 用户消息发送确认勾（两档）：sent=已发送 → received=已收到执行中 → done=已处理完
  const [userState, setUserState] = useState({})
  // 瞬态问题按原始 server-request rpcId 键控；重放同一 rpcId 不重复。
  const [pendingQuestions, setPendingQuestions] = useState([])
  const lastUserKey = useRef(null)
  const sendLockRef = useRef(false)
  const seen = useRef(new Set(initialCache.current.map(event => event?.seq).filter(seq => seq != null)))
  const pollFloorRef = useRef(0) // 本次发送前的最大事件 seq；HTTP 兜底只认之后的新 turn/end
  const scrollRef = useRef(null)
  const innerRef = useRef(null) // 消息内容容器（用于监听高度变化自动滚底）
  const scrollTimer = useRef(null)
  const positionedRef = useRef(false) // 首屏定位只执行一次
  const followRef = useRef(true) // 底部跟随模式：在底部=持续跟随，上滑=暂停
  const scrollKey = 'dsh-scroll-' + sessionId
  const [showJump, setShowJump] = useState(false) // 「回到底部」按钮
  const [scrollPad, setScrollPad] = useState(28) // 底部留白（自适应输入栏高度）

  useEffect(() => { onRunningChange?.(running) }, [onRunningChange, running])
  useEffect(() => { onPendingQuestionChange?.(pendingQuestions.length > 0) }, [onPendingQuestionChange, pendingQuestions.length])

  // 自适应底部留白：直接测量滚动区底部与输入栏顶部的重叠量，保证最后气泡完整显示在输入栏上方
  useEffect(() => {
    const comp = document.querySelector('.composer')
    const sc = scrollRef.current
    if (!comp || !sc || typeof ResizeObserver === 'undefined') return
    const update = () => {
      try {
        const overlap = sc.getBoundingClientRect().bottom - comp.getBoundingClientRect().top
        setScrollPad(Math.max(16, Math.round(overlap + 16)))
      } catch (e) {}
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(comp)
    ro.observe(sc)
    window.addEventListener('resize', update)
    return () => { ro.disconnect(); window.removeEventListener('resize', update) }
  }, [sessionId])

  // 有真实消息时通知父级（隐藏欢迎卡等）
  useEffect(() => {
    if (onHasMessages && items.some(it => !it.optimistic)) onHasMessages(true)
  }, [items, onHasMessages])

  const saveScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const offset = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight)
    const atBottom = offset <= 80
    try { sessionStorage.setItem(scrollKey, JSON.stringify({ offset, atBottom, t: Date.now() })) } catch (e) {}
  }
  const onScroll = () => {
    const el = scrollRef.current
    if (el) {
      const offset = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight)
      setShowJump(offset > 220)
      // 底部跟随模式：≤100px 视为在底部（跟随）；上滑超过则暂停跟随
      followRef.current = offset <= 100
      // 接近历史顶部时自动补更早消息，不再要求用户点击按钮。
      if (el.scrollTop <= 240 && hasOlder && !olderLoadingRef.current) void loadOlder()
    }
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(saveScroll, 400)
  }
  const jumpBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setShowJump(false)
  }

  const pushEvents = (list, source = 'live') => {
    setItems((prev) => {
      let acc = prev
      // 收到真实用户消息（mux 回显或刷新回填）→ 移除发送时的乐观占位
      if (list.some(ev => ev && ev.type === 'user/message')) acc = acc.filter(it => !it.optimistic)
      // 回合结束或最终回复到达 → 清掉所有流式 live 残留（防 chunk 顺序错乱导致正文重复/闪烁）
      if (list.some(ev => ev && (ev.type === 'turn/end' || ev.type === 'assistant/message'))) acc = acc.filter(it => !it.live)
      // 批量到达（历史回填 / 分页 / mux 批帧）可能乱序 → 先各自应用，再按 seq 升序合并
      const additions = []
      for (const ev of list) {
        if (ev && ev.type === 'user/message') {
          const key = ev.seq != null ? ev.seq : ('t-' + (ev.time || Date.now()))
          lastUserKey.current = key
          // 实时回显的新用户消息 → 档1「已发送」；历史回填默认 done（早已处理完）
          if (source === 'live' && ev.seq != null) setUserState(s => ({ ...s, [key]: 'sent' }))
        }
        if (ev && ev.seq != null) { if (seen.current.has(ev.seq)) continue; seen.current.add(ev.seq) }
        const applied = applyEvent([], ev)
        for (const a of applied) additions.push(a)
      }
      if (!additions.length) return acc
      const liveAdd = additions.filter(a => a.live)
      const normalAdd = additions.filter(a => !a.live)
      // 关键：把本批所有 live 增量合并成「一个」live 项（否则 mux 批帧/逐字 chunk 会被拆成多个独立气泡）
      let live = null
      for (const a of liveAdd) {
        if (!live) live = a
        else live = { ...live, text: live.text + a.text }
      }
      if (!normalAdd.length) {
        if (!live) return acc
        // 若 acc 末尾已是 live 项 → 继续累积到它（流式打字正常追加）
        const last = acc[acc.length - 1]
        if (last && last.live) return [...acc.slice(0, -1), { ...last, text: last.text + live.text }]
        return [...acc, live]
      }
      const accLive = acc.filter(a => a.live)
      const normal = acc.filter(a => !a.live)
      const merged = [...normal, ...normalAdd].sort((a, b) => {
        const sa = a.event && a.event.seq != null ? a.event.seq : -1
        const sb = b.event && b.event.seq != null ? b.event.seq : -1
        return sa - sb
      })
      // 合并 acc 残留 live + 本批 live → 同样只保留一个 live 项
      let allLive = null
      for (const a of [...accLive, ...(live ? [live] : [])]) {
        if (!allLive) allLive = a
        else allLive = { ...allLive, text: allLive.text + a.text }
      }
      return allLive ? [...merged, allLive] : merged
    })
  }

  useEffect(() => {
    // 会话切换：缓存命中时同步首屏显示，网络请求只在后台补新消息。
    const cachedEvents = readHistoryCache(sessionId)
    setItems(cachedRenderItems(cachedEvents)); seen.current.clear()
    for (const event of cachedEvents) { if (event?.seq != null) seen.current.add(event.seq) }
    setUserState({}); setPendingQuestions([]); lastUserKey.current = null
    setRunning(false); setThinking(false); setThinkLines([]); setErr(''); setLoading(cachedEvents.length === 0)
    setOlderLoading(false); olderLoadingRef.current = false; olderScrollAnchorRef.current = null; setHasOlder(false)
    positionedRef.current = false; setShowJump(false); followRef.current = true

    // 顶部标题：优先用列表页带过来的缓存标题，后台再用列表接口校准
    let cachedTitle = null
    try { cachedTitle = localStorage.getItem('dsh-title-' + sessionId) } catch (e) {}
    if (cachedTitle && onTitle) onTitle(cachedTitle)
    api.listSessions().then((v) => {
      const s = (v?.items || []).find(x => x.sessionId === sessionId)
      if (s?.running) setRunning(true)
      const t = s?.projections?.values?.title || s?.projections?.values?.sessionListMetadata?.title || ''
      if (t) {
        try { localStorage.setItem('dsh-title-' + sessionId, t) } catch (e) {}
        if (onTitle) onTitle(t)
      }
    }).catch(() => {})

    // 历史回填：缓存已同步显示；这里只静默拉取最新 PAGE 条消息。
    const hadCache = cachedEvents.length > 0
    loadHistory({ maxMessages: PAGE }).then((v) => {
      const evs = toRenderables(v?.events)
      pushEvents(evs, 'history')
      writeHistoryCache(sessionId, evs, Date.now())
      setHasOlder(evs.length >= PAGE)
    }).catch((e) => setErr(e.message)).finally(() => {
      setLoading(false)
      // 缓存命中时首帧立即定位（不等主请求）
      if (hadCache) {
        positionedRef.current = false
        setTimeout(() => {
          const el = scrollRef.current
          if (!el) return
          let saved = null
          try { saved = JSON.parse(sessionStorage.getItem(scrollKey) || 'null') } catch (e) {}
          if (saved && !saved.atBottom) el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - (saved.offset || 0))
          else el.scrollTop = el.scrollHeight
          positionedRef.current = true
        }, 50)
      }
    })

    // App 从后台恢复时，无论本地 running 状态是否丢失，都补拉最新历史。
    let refreshPromise = null
    let lastRefreshAt = 0
    const refreshLatest = () => {
      if (refreshPromise) return refreshPromise
      if (Date.now() - lastRefreshAt < 500) return Promise.resolve()
      lastRefreshAt = Date.now()
      refreshPromise = loadHistory({ maxMessages: PAGE }).then((v) => {
        const rawEvents = (v?.events || []).map(item => item?.event).filter(Boolean)
        const evs = rawEvents.filter(event => RENDERABLE.includes(event.type))
        pushEvents(evs, 'history')
        writeHistoryCache(sessionId, evs, Date.now())
        const lifecycle = [...rawEvents].reverse().find(event => ['turn/start', 'turn/end', 'turn/error', 'turn/cancel'].includes(event?.type))
        if (lifecycle?.type === 'turn/start') setRunning(true)
        else if (lifecycle) { setRunning(false); setThinking(false); setThinkLines([]) }
      }).catch(() => {}).finally(() => { refreshPromise = null })
      return refreshPromise
    }

    // 实时流保留完整 server-request 信封；answerable frame 的 rpcId 是回答关联键。
    const unsub = subscribeMux((envelope) => {
      const frame = envelope?.type === 'server-request' ? envelope.payload : (envelope?.payload || envelope)
      if (!frame?.type) return
      const sid = frame.sessionId || frame.event?.sessionId || frame.event?.data?.sessionId
      if (sid && sid !== sessionId) return

      if (frame.type === 'question/requested') {
        if (typeof envelope?.rpcId !== 'string') { setErr('收到无法回答的问题：缺少 rpcId'); return }
        const request = { rpcId: envelope.rpcId, payload: frame }
        setPendingQuestions(prev => {
          const at = prev.findIndex(item => item.rpcId === request.rpcId)
          if (at < 0) return [...prev, request]
          const next = [...prev]; next[at] = request; return next
        })
        setThinking(false); setThinkLines([])
        return
      }
      if (frame.type === 'question/resolved') {
        setPendingQuestions(prev => prev.filter(item => item.rpcId !== frame.questionRpcId))
        return
      }

      const inner = frame.type === 'session/event' ? frame.event : frame
      const t = inner?.type
      const KNOWN = ['user/message', 'assistant/message', 'assistant/chunk', 'tool/call', 'tool/result', 'turn/end', 'turn/start', 'step/start', 'step/end']
      if (!KNOWN.includes(t)) return
      pushEvents([inner])
      // 两档确认勾推进：AI 开始处理（turn/start 或首个输出 chunk）→ 档1 received；回合结束 → 档2 done
      const k = lastUserKey.current
      if (t === 'turn/start' || t === 'assistant/chunk') {
        if (k != null) setUserState(s => (s[k] === 'sent' ? { ...s, [k]: 'received' } : s))
        if (t === 'assistant/chunk') setRunning(true)
      }
      else if (t === 'turn/end' || t === 'assistant/message') {
        if (k != null) setUserState(s => ((s[k] === 'received' || s[k] === 'sent') ? { ...s, [k]: 'done' } : s))
      }
      if (t === 'assistant/chunk') {
        const ctype = inner.data?.chunk?.type || 'text-delta'
        if (ctype === 'reasoning-delta') {
          setThinking(true)
          updateKeepAlive('💭 AI 思考中…')
          // 收集思考进度文字：按行切分（每行最多 16 字），新行写满后整体上滚一行
          const txt = String(inner.data?.chunk?.text || '').replace(/\s+/g, ' ').trim()
          if (txt) {
            const CHARS = 16
            setThinkLines(prev => {
              const lines = prev ? [...prev] : []
              let rest = txt
              if (lines.length) {
                const last = lines[lines.length - 1] + rest
                lines[lines.length - 1] = last.slice(0, CHARS)
                rest = last.slice(CHARS)
              }
              while (rest.length > CHARS) { lines.push(rest.slice(0, CHARS)); rest = rest.slice(CHARS) }
              if (rest.length) lines.push(rest)
              return lines.slice(-20)
            })
          }
        } else { setThinking(false); updateKeepAlive('🔵 AI 生成中…') }
      }
      else if (t === 'assistant/message') {
        // 最终正文到达不等于整个回合结束；等待 turn/end，避免完成提示重复触发。
        setThinking(false); setThinkLines([])
      }
      else if (t === 'turn/end') {
        setRunning(false); setThinking(false); setThinkLines([])
        notifyReplyDone(sessionId, undefined, sessionId + ':turn:' + String(inner.seq ?? 'end'), {
          source: readSoundSource(sessionId),
          reason: '回复好了'
        })
        updateKeepAlive('✅ 回复完成')
        setTimeout(() => updateKeepAlive('运行中，随时待命'), 3000)
      }
    }, {
      // 恢复前台先走 HTTP 补漏，再强制重连实时流；onOpen 再兜底一次。
      onResume: refreshLatest,
      onOpen: refreshLatest
    })
    return () => { try { unsub() } catch (e) {}; saveScroll() }
  }, [sessionId])

  // 手机 WebView 的 WebSocket 可能被系统挂起；生成期间轮询 history 作为 HTTP 兜底。
  useEffect(() => {
    if (!running) return
    let stopped = false
    let timer = null
    const poll = async () => {
      try {
        const v = await loadHistory({ maxMessages: PAGE })
        if (stopped) return
        const events = (v?.events || []).map(item => item?.event).filter(Boolean)
        pushEvents(events.filter(event => RENDERABLE.includes(event.type)), 'history')
        const ended = events.some(event => event.type === 'turn/end' && Number(event.seq || 0) > pollFloorRef.current)
        if (ended) {
          const k = lastUserKey.current
          if (k != null) setUserState(state => ({ ...state, [k]: 'done' }))
          const endedEvent = events.find(event => event.type === 'turn/end' && Number(event.seq || 0) > pollFloorRef.current)
          setRunning(false); setThinking(false); setThinkLines([])
          notifyReplyDone(sessionId, undefined, sessionId + ':turn:' + String(endedEvent?.seq ?? 'poll-end'), {
            source: readSoundSource(sessionId),
            reason: '回复好了'
          })
          return
        }
      } catch (e) {}
      if (!stopped) timer = setTimeout(poll, 3000)
    }
    timer = setTimeout(poll, 1200)
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [sessionId, running])

  // 打开会话：默认定位最底部（最新消息）；若上次退出时上翻过，恢复到记录位置；只执行一次
  useEffect(() => {
    if (loading || positionedRef.current) return
    positionedRef.current = true
    const el = scrollRef.current
    if (!el) return
    let saved = null
    try { saved = JSON.parse(sessionStorage.getItem(scrollKey) || 'null') } catch (e) {}
    if (saved && !saved.atBottom) {
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - (saved.offset || 0))
    } else {
      el.scrollTop = el.scrollHeight
    }
  }, [loading])

  // 底部跟随模式：在底部时新内容实时滚入视野并持续跟随；用户上滑即暂停
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !followRef.current) return
    const raf = requestAnimationFrame(() => { if (el && followRef.current) el.scrollTop = el.scrollHeight })
    return () => cancelAnimationFrame(raf)
  }, [items])

  // 内容高度变化（流式增长/新气泡出现/图片加载）→ 若处于底部跟随模式，自动滚到底确保最后气泡完整可见
  useEffect(() => {
    const el = innerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const sc = scrollRef.current
      if (sc && followRef.current) sc.scrollTop = sc.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [sessionId])

  // 加载更早的消息（beforeSeq 分页）；由顶部滚动阈值自动触发。
  const loadOlder = async () => {
    if (olderLoadingRef.current || !hasOlder) return
    let minSeq = Infinity
    for (const it of items) { if (!it.live && it.event?.seq != null && it.event.seq < minSeq) minSeq = it.event.seq }
    if (minSeq === Infinity) return
    olderLoadingRef.current = true
    setOlderLoading(true)
    try {
      const v = await loadHistory({ beforeSeq: minSeq, maxMessages: PAGE })
      const evs = toRenderables(v?.events)
      if (!evs.length) { setHasOlder(false); return }
      const scroller = scrollRef.current
      if (scroller) olderScrollAnchorRef.current = { height: scroller.scrollHeight, top: scroller.scrollTop }
      // 新拉的更早事件按时间正序排在前面；去重
      setItems((prev) => {
        let acc = []
        for (const ev of evs) {
          if (ev.seq != null) { if (seen.current.has(ev.seq)) continue; seen.current.add(ev.seq) }
          acc = applyEvent(acc, ev)
        }
        return [...acc, ...prev]
      })
      setHasOlder(evs.length >= PAGE)
    } catch (e) { setErr('加载更早失败：' + e.message) }
    finally { olderLoadingRef.current = false; setOlderLoading(false) }
  }

  // prepend 完成后抵消新增内容高度，用户仍停在原来正在阅读的消息位置。
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const anchor = olderScrollAnchorRef.current
    if (!scroller || !anchor) return
    scroller.scrollTop = anchor.top + Math.max(0, scroller.scrollHeight - anchor.height)
    olderScrollAnchorRef.current = null
  }, [items.length])

  // 首批历史不足一屏时没有滚动事件，自动继续补页直到可滚动或没有更早消息。
  useEffect(() => {
    if (loading || !hasOlder || olderLoadingRef.current) return
    const scroller = scrollRef.current
    if (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) void loadOlder()
  }, [loading, hasOlder, items.length, sessionId])

  const send = async (content, metadata = {}) => {
    // ref 同步锁覆盖文字、图片和语音入口，避免 React busy 状态刷新前的双击竞态。
    if (sendLockRef.current) { setErr('已拦截重复发送，请稍候'); return false }
    const attempt = beginPromptAttempt(sessionId, content)
    if (attempt.duplicate) { setErr('已拦截刚刚发送过的相同内容'); return false }
    sendLockRef.current = true
    // 用户主动发送 → 视为要看最新，强制滚到底并恢复底部跟随（上滑暂停跟随的行为不变）
    followRef.current = true
    setShowJump(false)
    const sc = scrollRef.current
    if (sc) {
      sc.scrollTop = sc.scrollHeight
      // 双 rAF：等乐观气泡渲染完成后再次滚底，确保发完消息一定在最底部
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }))
    }
    // 乐观显示自己的消息（即使 mux 回显失败也能立即看到）
    const text = (content || []).map(block =>
      block.type === 'text' ? (block.clientHidden ? '' : block.text) : (block.type === 'image' ? '🖼 ' + (block.name || '图片') : '')
    ).filter(Boolean).join('\n')
    const uid = attempt.rpcId
    lastUserKey.current = uid
    setUserState(state => ({ ...state, [uid]: 'sent' }))
    setItems(previous => previous.some(item => item.optimistic && item.uid === uid)
      ? previous
      : [...previous, { optimistic: true, text, time: Date.now(), uid }])
    let floor = 0
    seen.current.forEach(seq => { if (Number(seq) > floor) floor = Number(seq) })
    pollFloorRef.current = floor
    setBusy(true); setRunning(true); setThinking(true); setErr('')
    updateKeepAlive('💭 AI 思考中…')
    try {
      const waiting = [...pendingQuestions]
      if (waiting.length) {
        // 普通 steer 不能解除 ask_user_question；用户选择继续聊天时，先取消旧问题再排队新消息。
        for (const request of waiting) {
          const receipt = await api.respond({
            type: 'client-response',
            rpcId: request.rpcId,
            result: { ok: false, error: { code: 'cancelled', message: '用户改为发送新的聊天内容', details: {} } }
          })
          if (!receipt.accepted && receipt.reason !== 'not-pending') throw new Error('旧问题未能取消：' + (receipt.reason || 'unknown'))
        }
        setPendingQuestions(prev => prev.filter(item => !waiting.some(request => request.rpcId === item.rpcId)))
      } else {
        // 即使 mux 没把 pending question 送到手机，也先结束服务器当前回合；等价于可靠版 steer。
        try {
          if (subagentAddress?.mode === 'continuable') await api.subagentInterrupt(subagentAddress)
          else if (!subagentAddress) await api.cancel({ sessionId })
        } catch (e) {}
      }
      // 手机端优化助手会在真实口述后追加隐藏安全策略：先出确认卡，获批后才能改动和热更新。
      // 乐观气泡和幂等指纹仍只使用原始 content，避免把内部策略展示给用户或影响重复发送判断。
      const requestContent = optimizerPolicy ? withOptimizerPolicy(content, optimizerPolicy) : content
      const promptPayload = {
        content: requestContent,
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
      if (subagentAddress) {
        if (subagentAddress.mode !== 'continuable') throw new Error('这个执行分支是只读任务，不能继续发送')
        await api.subagentPrompt({ ...subagentAddress, ...promptPayload }, { rpcId: attempt.rpcId })
      } else {
        await api.prompt({ sessionId, mode: 'queue', ...promptPayload }, { rpcId: attempt.rpcId })
      }
      // 只有 RPC 明确接受后才从唯一入口播放；rpcId 同时承担网络重试防重复键。
      void playAcceptedPromptSound({
        kind: metadata.kind === 'voice' ? 'voice' : 'text',
        rpcId: attempt.rpcId,
        sessionId,
        source: readSoundSource(sessionId)
      })
      finishPromptAttempt(sessionId, attempt, true)
      return true
    } catch (e) {
      // 结构化 RPC 错误代表结果已确定；网络断开则保留同一 rpcId，用户重试不会重复入队。
      finishPromptAttempt(sessionId, attempt, e.responseReceived === true)
      setErr('发送失败：' + e.message); setRunning(false); setThinking(false); return false
    } finally {
      sendLockRef.current = false
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <div ref={scrollRef} onScroll={onScroll} className="scroll" style={{ flex: 1, paddingBottom: scrollPad }}>
        <div ref={innerRef}>
        {loading && <div className="loading"><span className="spin"></span>加载消息…</div>}
        {!loading && olderLoading && <div className="loading history-loading"><span className="spin"></span>正在加载更早消息…</div>}
        {running && !thinking && (
          <div className="run-status">
            {items.some(it => it.live) ? '🔵 AI 生成中…' : '🔵 AI 运行中…'}
          </div>
        )}
        {items.map((it, i) => it.optimistic
          ? <div key={'o' + i} className="msg user"><div className="bubble-wrap"><div className="bubble"><Markdown text={it.text} /></div><span className={'tick ' + (userState[it.uid] === 'done' ? 'done' : (userState[it.uid] === 'received' ? 'received' : 'sent'))}>{userState[it.uid] === 'done' ? '✓✓' : '✓'}</span></div></div>
          : it.live
            ? <div key={'l' + i} className="msg assistant"><div className="bubble"><Markdown text={it.text} /><span className="cursor"></span></div></div>
            : <MessageBubble key={it.event.seq ?? i} event={it.event} sessionId={sessionId} hideTechnicalEvents={hideTechnicalEvents}
                status={it.event.type === 'user/message' ? (userState[it.event.seq] || 'done') : undefined} />)}
        {err && <div style={{ color: 'var(--err)', fontSize: 13, padding: 8 }}>{err}</div>}
        {thinking && running && (
          <div className="msg assistant">
            <div className="bubble think-bubble">
              <span className="think-dots">💭 思考中</span>
              {thinkLines.length > 0 && (
                <span className="think-lines">
                  <span className="think-lines-track" style={{ transform: 'translateY(' + (-Math.max(0, thinkLines.length - 2) * 1.3) + 'em)' }}>
                    {thinkLines.map((ln, i) => <span key={i} className="think-line">{ln || '\u00A0'}</span>)}
                  </span>
                </span>
              )}
            </div>
          </div>
        )}
        </div>
      </div>
      {showJump && <button className="jump-bottom" onClick={jumpBottom} aria-label="回到底部">↓ 回到底部</button>}
      {!!pendingQuestions.length && <div className="question-dock" style={{ bottom: Math.max(64, scrollPad - 16) }}>
        {pendingQuestions.map(request => <QuestionPanel key={request.rpcId} request={request}
          onSettled={rpcId => setPendingQuestions(prev => prev.filter(item => item.rpcId !== rpcId))} />)}
        <div className="question-dock-hint">也可以直接发送新消息，系统会跳过上面的旧问题。</div>
      </div>}
      {subagentAddress?.mode === 'one-shot'
        ? <div className="subagent-readonly">该任务由一次性执行分支完成，当前仅供查看</div>
        : <Composer onSend={send} busy={busy} sessionId={sessionId} />}
    </div>
  )
}
