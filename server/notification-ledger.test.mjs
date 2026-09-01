import assert from 'node:assert/strict'
import test from 'node:test'
import { NotificationLedger, latestTurnEnd, normalizeTurnReason, statusForReason } from './notification-ledger.mjs'

const session = (overrides = {}) => ({
  sessionId: 's1', updatedAt: 100, projections: { values: { title: '测试会话' } }, ...overrides
})
const end = (kind, seq = 8) => ({ type: 'turn/end', seq, time: 100, data: { turn: 1, reason: { kind } } })

test('结束原因映射为三色状态', () => {
  assert.equal(statusForReason(normalizeTurnReason({ kind: 'completed' })), 'completed')
  for (const kind of ['aborted', 'blocked', 'error', 'max-tokens', 'interrupted']) {
    assert.equal(statusForReason(normalizeTurnReason({ kind })), 'error')
  }
  assert.equal(normalizeTurnReason({ kind: 'future-value' }), 'interrupted')
})

test('历史终态建立基线但不制造未读洪峰', () => {
  const ledger = new NotificationLedger('')
  ledger.setTerminal(session(), end('completed'), { baseline: true })
  const snapshot = ledger.snapshot('device-a')
  assert.equal(snapshot.sessions[0].status, 'completed')
  assert.equal(snapshot.sessions[0].unread, false)
  assert.equal(snapshot.unreadCount, 0)
})

test('新终态进入未读并按 terminalKey 确认', () => {
  const ledger = new NotificationLedger('')
  ledger.initializeDevice('device-a')
  ledger.initializeDevice('device-b')
  ledger.setRunning(session({ updatedAt: 200 }))
  ledger.setTerminal(session({ updatedAt: 300 }), end('error', 12))
  assert.equal(ledger.snapshot('device-a').unreadCount, 1)
  assert.equal(ledger.snapshot('device-b').unreadCount, 1)
  assert.equal(ledger.markRead('device-a', { sessionId: 's1', terminalKey: '1:12' }), 1)
  assert.equal(ledger.snapshot('device-a').unreadCount, 0)
  assert.equal(ledger.snapshot('device-b').unreadCount, 1)
  assert.equal(ledger.eventsAfter('device-a', 0).events.at(-1).kind, 'read')
})

test('新设备把既有终态设为基线但能收到后续新终态', () => {
  const ledger = new NotificationLedger('')
  ledger.setTerminal(session(), end('completed', 8))
  assert.equal(ledger.snapshot('new-device').unreadCount, 0)
  ledger.setRunning(session({ updatedAt: 200 }))
  ledger.setTerminal(session({ updatedAt: 300 }), end('completed', 15))
  assert.equal(ledger.snapshot('new-device').unreadCount, 1)
})

test('旧设备迁移保留升级前尚未读取的新终态', () => {
  const ledger = new NotificationLedger('')
  ledger.setTerminal(session(), end('completed', 15))
  ledger.state.devices['legacy-device'] = { s1: '1:8' }
  assert.equal(ledger.snapshot('legacy-device').unreadCount, 1)
  assert.equal(ledger.state.devices['legacy-device'].$initialized, true)
})

test('过期 terminalKey 不会误读掉更新结果', () => {
  const ledger = new NotificationLedger('')
  ledger.initializeDevice('device-a')
  ledger.setTerminal(session(), end('completed', 8))
  ledger.setTerminal(session({ updatedAt: 300 }), end('completed', 15))
  assert.equal(ledger.markRead('device-a', { sessionId: 's1', terminalKey: '1:8' }), 0)
  assert.equal(ledger.snapshot('device-a').unreadCount, 1)
})

test('增量事件保留当时状态，不把 running 重解释为 terminal', () => {
  const ledger = new NotificationLedger('')
  ledger.initializeDevice('device-a')
  ledger.setRunning(session({ updatedAt: 200 }))
  ledger.setTerminal(session({ updatedAt: 300 }), end('completed', 15))
  const events = ledger.eventsAfter('device-a', 0).events.filter(event => event.kind === 'state')
  assert.deepEqual(events.map(event => event.session.status), ['running', 'completed'])
})

test('相同 turn/end 重放不会重复产生终态', () => {
  const ledger = new NotificationLedger('')
  assert.equal(ledger.setTerminal(session(), end('completed')), true)
  const sequence = ledger.snapshot('device-a').sequence
  assert.equal(ledger.setTerminal(session(), end('completed')), false)
  assert.equal(ledger.snapshot('device-a').sequence, sequence)
})

test('从 history 包装结构读取最后一个 turn/end', () => {
  const first = end('error', 3)
  const last = end('completed', 9)
  assert.equal(latestTurnEnd({ events: [{ event: first }, { event: { type: 'assistant/message' } }, { event: last }] }), last)
})
