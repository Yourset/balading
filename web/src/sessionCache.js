// 会话列表阶段的后台预同步缓存。
// localStorage 只保存每个会话最新一屏的“可见事件”，确保点开会话可同步首帧显示，避免缓存流式 chunk 和大块工具参数。
const HISTORY_PREFIX = 'dsh-hist-'
const MODEL_PREFIX = 'dsh-model-directory-'
const MODEL_TTL = 5 * 60 * 1000
const warmingSessions = new Set()
export const HISTORY_CACHE_EVENT = 'dsh-history-cache-updated'

function storage() {
  try { return localStorage } catch (e) { return null }
}

function compactEvent(event) {
  if (!event?.type) return null
  const base = { type: event.type, seq: event.seq, time: event.time }
  if (event.type === 'user/message') return { ...base, data: { content: event.data?.content || [] } }
  if (event.type === 'assistant/message') {
    const message = event.data?.message || {}
    return { ...base, data: { message: { content: message.content || [], source: message.source || {} } } }
  }
  if (event.type === 'tool/result') {
    const failed = (event.data?.message?.content || []).some(block => block?.isError)
    return { ...base, data: { message: { content: [{ type: 'tool-result', isError: failed }] } } }
  }
  if (event.type === 'tool/call') return base
  return null
}

export function compactRenderableEvents(events) {
  return (events || []).map(item => compactEvent(item?.event || item)).filter(Boolean)
}

export function readHistoryCache(sessionId) {
  try {
    const cached = JSON.parse(storage()?.getItem(HISTORY_PREFIX + sessionId) || 'null')
    return cached && Array.isArray(cached.events) ? cached : null
  } catch (e) { return null }
}

export function writeHistoryCache(sessionId, events, sessionUpdatedAt = 0) {
  const cached = {
    t: Date.now(),
    sessionUpdatedAt: Number(sessionUpdatedAt || 0),
    events: compactRenderableEvents(events)
  }
  try { storage()?.setItem(HISTORY_PREFIX + sessionId, JSON.stringify(cached)) } catch (e) {}
  try { window.dispatchEvent(new CustomEvent(HISTORY_CACHE_EVENT, { detail: { sessionId } })) } catch (e) {}
  return cached
}

export function readModelCache(sessionId) {
  try {
    const cached = JSON.parse(storage()?.getItem(MODEL_PREFIX + sessionId) || 'null')
    return cached && cached.value ? cached : null
  } catch (e) { return null }
}

export function writeModelCache(sessionId, value) {
  if (!value) return
  try { storage()?.setItem(MODEL_PREFIX + sessionId, JSON.stringify({ t: Date.now(), value })) } catch (e) {}
}

function needsHistoryRefresh(session) {
  const cached = readHistoryCache(session.sessionId)
  if (!cached?.events?.length || session.running) return true
  return Number(cached.sessionUpdatedAt || 0) < Number(session.updatedAt || 0)
}

function needsModelRefresh(sessionId) {
  const cached = readModelCache(sessionId)
  return !cached || Date.now() - Number(cached.t || 0) > MODEL_TTL
}

// 最近更新的会话先同步；低并发继续把列表中的其余会话全部预热。
// 不绑定页面生命周期：用户在同步中点进会话时，后台队列仍继续完成。
export async function warmAllSessionCaches(sessions, api, options = {}) {
  const queue = (sessions || [])
    .filter(session => session?.sessionId && !session.blank)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
  const historyLimit = Number(options.historyLimit || 15)
  const concurrency = Math.max(1, Math.min(4, Number(options.concurrency || 2)))
  let cursor = 0
  const result = { total: queue.length, histories: 0, models: 0, failed: 0 }

  async function worker() {
    while (cursor < queue.length) {
      const session = queue[cursor++]
      if (warmingSessions.has(session.sessionId)) continue
      const tasks = []
      if (needsHistoryRefresh(session)) {
        tasks.push(api.history({ sessionId: session.sessionId, maxMessages: historyLimit })
          .then(value => {
            writeHistoryCache(session.sessionId, value?.events || [], session.updatedAt)
            result.histories += 1
          }))
      }
      if (needsModelRefresh(session.sessionId)) {
        tasks.push(api.models({ sessionId: session.sessionId })
          .then(value => {
            writeModelCache(session.sessionId, value)
            result.models += 1
          }))
      }
      if (!tasks.length) continue
      warmingSessions.add(session.sessionId)
      try {
        const settled = await Promise.allSettled(tasks)
        result.failed += settled.filter(item => item.status === 'rejected').length
      } finally {
        warmingSessions.delete(session.sessionId)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()))
  return result
}
