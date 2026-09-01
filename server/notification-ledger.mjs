import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

const TERMINAL = new Set(['completed', 'aborted', 'blocked', 'error', 'max-tokens', 'interrupted'])

export function normalizeTurnReason(reason) {
  const kind = typeof reason?.kind === 'string' ? reason.kind : 'interrupted'
  return TERMINAL.has(kind) ? kind : 'interrupted'
}

export function statusForReason(kind) {
  return kind === 'completed' ? 'completed' : 'error'
}

function titleOf(session) {
  return session?.projections?.values?.title || session?.projections?.values?.sessionListMetadata?.title || '新会话'
}

function terminalKeyOf(event) {
  const turn = Number(event?.data?.turn ?? -1)
  const seq = Number(event?.seq ?? -1)
  return `${turn}:${seq}`
}

/**
 * VPS 侧通知账本。会话状态与设备已读游标都持久化，手机断线后可以按序补齐。
 * 首次发现的历史终态只建立颜色基线，不触发通知；后续新终态才进入未读计数。
 */
export class NotificationLedger {
  constructor(filePath) {
    this.filePath = filePath
    this.state = { version: 1, sequence: 0, sessions: {}, devices: {}, events: [] }
    this.listeners = new Set()
    this.load()
  }

  load() {
    if (!this.filePath || !existsSync(this.filePath)) return
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (parsed?.version === 1 && parsed.sessions && parsed.devices && Array.isArray(parsed.events)) this.state = parsed
    } catch (e) {
      // 状态文件损坏时保守回到空账本；DSH 历史会在下一轮重新建立基线。
    }
  }

  persist() {
    if (!this.filePath) return
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2) + '\n', 'utf8')
    renameSync(tmp, this.filePath)
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(kind, sessionId, extra = {}) {
    const current = this.state.sessions[sessionId]
    // 事件携带不可变状态快照，不能在读取时套用“当前状态”，否则 running/terminal 会被重复解释为同一终态。
    const event = { seq: ++this.state.sequence, time: Date.now(), kind, sessionId, session: current ? { ...current } : null, ...extra }
    this.state.events.push(event)
    if (this.state.events.length > 1000) this.state.events.splice(0, this.state.events.length - 1000)
    this.persist()
    for (const listener of this.listeners) listener(event)
    return event
  }

  setRunning(session) {
    if (!session?.sessionId) return false
    const previous = this.state.sessions[session.sessionId]
    const next = {
      sessionId: session.sessionId,
      title: titleOf(session),
      status: 'running',
      reasonKind: null,
      terminalKey: previous?.terminalKey || null,
      updatedAt: Number(session.updatedAt || Date.now()),
      notifiable: false
    }
    if (previous?.status === 'running' && previous.title === next.title) return false
    this.state.sessions[session.sessionId] = next
    this.emit('state', session.sessionId)
    return true
  }

  setIdle(session) {
    if (!session?.sessionId) return false
    const previous = this.state.sessions[session.sessionId]
    const next = {
      sessionId: session.sessionId,
      title: titleOf(session),
      status: 'idle',
      reasonKind: null,
      terminalKey: previous?.terminalKey || null,
      updatedAt: Number(session.updatedAt || Date.now()),
      notifiable: false
    }
    if (previous?.status === 'idle' && previous.title === next.title) return false
    this.state.sessions[session.sessionId] = next
    this.emit('state', session.sessionId)
    return true
  }

  setTerminal(session, turnEnd, { baseline = false } = {}) {
    if (!session?.sessionId || turnEnd?.type !== 'turn/end') return false
    const reasonKind = normalizeTurnReason(turnEnd.data?.reason)
    const terminalKey = terminalKeyOf(turnEnd)
    const previous = this.state.sessions[session.sessionId]
    const isNewTerminal = previous?.terminalKey !== terminalKey
    const next = {
      sessionId: session.sessionId,
      title: titleOf(session),
      status: statusForReason(reasonKind),
      reasonKind,
      terminalKey,
      updatedAt: Number(session.updatedAt || turnEnd.time || Date.now()),
      notifiable: isNewTerminal ? !baseline : !!previous?.notifiable
    }
    if (!isNewTerminal && previous?.status === next.status && previous.title === next.title) return false
    this.state.sessions[session.sessionId] = next
    this.emit('state', session.sessionId)
    return true
  }

  initializeDevice(deviceId) {
    if (!deviceId) return false
    const existing = this.state.devices[deviceId]
    const reads = existing || (this.state.devices[deviceId] = {})
    if (reads.$initialized) return false
    // 兼容旧账本：已有真实已读键说明设备并非首次出现，只补迁移标记，不能清掉升级前未读。
    if (existing && Object.keys(reads).some(key => key !== '$initialized')) {
      reads.$initialized = true
      this.persist()
      return true
    }
    // 真正的新设备先把当前历史建立为已读基线，避免首次安装出现几百条旧结果角标和通知。
    for (const session of Object.values(this.state.sessions)) {
      if (session.terminalKey) reads[session.sessionId] = session.terminalKey
    }
    reads.$initialized = true
    this.persist()
    return true
  }

  markRead(deviceId, acknowledgements) {
    if (!deviceId) return 0
    this.initializeDevice(deviceId)
    const items = Array.isArray(acknowledgements) ? acknowledgements : [acknowledgements]
    const reads = this.state.devices[deviceId]
    let changed = 0
    for (const acknowledgement of items.filter(Boolean)) {
      const sessionId = acknowledgement?.sessionId
      const terminalKey = acknowledgement?.terminalKey
      const session = this.state.sessions[sessionId]
      // 必须确认客户端实际看到的 terminalKey；请求途中若又结束一轮，不能误读掉新结果。
      if (!session?.terminalKey || terminalKey !== session.terminalKey || reads[sessionId] === terminalKey) continue
      reads[sessionId] = terminalKey
      this.emit('read', sessionId, { deviceId, terminalKey })
      changed++
    }
    if (changed === 0) this.persist()
    return changed
  }

  isUnread(deviceId, session) {
    if (!session?.terminalKey || !session.notifiable) return false
    return this.state.devices[deviceId]?.[session.sessionId] !== session.terminalKey
  }

  snapshot(deviceId) {
    this.initializeDevice(deviceId)
    const sessions = Object.values(this.state.sessions).map(session => ({ ...session, unread: this.isUnread(deviceId, session) }))
    return {
      sequence: this.state.sequence,
      unreadCount: sessions.filter(session => session.unread).length,
      runningCount: sessions.filter(session => session.status === 'running').length,
      sessions
    }
  }

  eventsAfter(deviceId, after = 0) {
    this.initializeDevice(deviceId)
    const floor = Number(after || 0)
    const oldest = this.state.events[0]?.seq || this.state.sequence
    const reset = floor > 0 && floor < oldest - 1
    const events = reset ? [] : this.state.events.filter(event => event.seq > floor && (event.kind !== 'read' || event.deviceId === deviceId)).map(event => {
      const snapshot = event.session
      const current = this.state.sessions[event.sessionId]
      const unread = !!snapshot?.terminalKey && current?.terminalKey === snapshot.terminalKey && this.isUnread(deviceId, current)
      return { ...event, session: snapshot ? { ...snapshot, unread } : null }
    })
    return { ...this.snapshot(deviceId), reset, events }
  }
}

export function latestTurnEnd(history) {
  const events = (history?.events || []).map(item => item?.event || item).filter(Boolean)
  return [...events].reverse().find(event => event.type === 'turn/end') || null
}
