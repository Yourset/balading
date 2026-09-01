const terminalTypes = new Set(['turn/end', 'turn/error', 'turn/cancel'])
const stoppedReasonKinds = new Set(['abort', 'aborted', 'interrupt', 'interrupted', 'cancel', 'cancelled', 'canceled', 'stopped'])

export const MAX_OPTIMIZATION_TASKS = 6
export const MAX_RECENT_TASK_CHECKS = 12

function parentId(session) {
  return session?.parentSessionId || session?.parentId || ''
}

function titleOf(session) {
  return session?.projections?.values?.title || session?.projections?.values?.sessionListMetadata?.title || ''
}

export function findOptimizationRoot(sessions, preferredId, assistantTitle) {
  const visible = (sessions || []).filter(session => !session?.blank)
  const titles = new Set((Array.isArray(assistantTitle) ? assistantTitle : [assistantTitle]).filter(Boolean))
  return visible.find(session => preferredId && session.sessionId === preferredId)
    || visible.find(session => titles.has(titleOf(session)))
    || null
}

export function optimizationDescendants(sessions, rootId) {
  const byId = new Map((sessions || []).map(session => [session.sessionId, session]))
  return (sessions || []).filter(session => {
    if (!session || session.blank || session.sessionId === rootId) return false
    let current = session
    const seen = new Set()
    while (current && !seen.has(current.sessionId)) {
      seen.add(current.sessionId)
      const nextParent = parentId(current)
      if (!nextParent) return false
      if (nextParent === rootId) return current.origin === 'subagent' || Boolean(parentId(current))
      current = byId.get(nextParent)
    }
    return false
  })
}

export function buildOptimizationCandidates(sessions, rootId, catalogsByParent) {
  return optimizationDescendants(sessions, rootId).flatMap(session => {
    const directParentId = parentId(session)
    const catalog = catalogsByParent?.[directParentId]
    const entry = catalog?.entries?.find(item => item.kind === 'child' && item.id === session.sessionId)
    if (!entry) return []
    const timing = session.projections?.values?.subagentTiming
    return [{
      sessionId: session.sessionId,
      parentSessionId: directParentId,
      mode: entry.mode,
      label: entry.label || titleOf(session) || '正在处理优化任务',
      running: Boolean(session.running || entry.activity === 'running'),
      activityAt: Number(timing?.active?.through) || Number(session.updatedAt) || 0
    }]
  })
}

export function latestTaskTerminal(history) {
  const events = Array.isArray(history?.events) ? history.events : []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]?.event || events[index]
    if (!terminalTypes.has(event?.type)) continue
    const nestedReasonKind = typeof event?.data?.reason?.kind === 'string' ? event.data.reason.kind.trim().toLowerCase() : ''
    const reasonKind = nestedReasonKind || (event.type === 'turn/error' ? 'error' : event.type === 'turn/cancel' ? 'cancelled' : '')
    return { type: event.type, time: Number(event.time) || 0, reasonKind }
  }
  return null
}

export function statusForTaskTerminal(terminal) {
  if (!terminal) return null
  if (terminal.type === 'turn/error') return 'failed'
  if (terminal.type === 'turn/cancel') return 'stopped'
  if (terminal.type !== 'turn/end') return null
  if (!terminal.reasonKind || terminal.reasonKind === 'completed') return 'completed'
  return stoppedReasonKinds.has(terminal.reasonKind) ? 'stopped' : 'failed'
}

export function isCacheableTaskTerminal(terminal) {
  return statusForTaskTerminal(terminal) !== null
}

export function truncateTaskDescription(value, maxLength = 20) {
  const text = String(value || '').replace(/\s+/g, ' ').trim() || '正在处理优化任务'
  return Array.from(text).slice(0, maxLength).join('')
}

export function selectOptimizationCards(candidates, terminalsBySession, options = {}) {
  const max = options.max || MAX_OPTIMIZATION_TASKS
  const category = options.category || '手机优化'
  return (candidates || []).flatMap(candidate => {
    const terminal = terminalsBySession?.[candidate.sessionId]
    const terminalStatus = statusForTaskTerminal(terminal)
    if (!candidate.running && !terminalStatus) return []
    return [{
      ...candidate,
      category,
      description: truncateTaskDescription(candidate.label),
      status: candidate.running ? 'running' : terminalStatus,
      activityAt: candidate.running ? candidate.activityAt : (terminal.time || candidate.activityAt)
    }]
  }).sort((left, right) => {
    if (left.running !== right.running) return left.running ? -1 : 1
    return right.activityAt - left.activityAt
  }).slice(0, max)
}
