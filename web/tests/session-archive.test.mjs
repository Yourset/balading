import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { filterArchivedSessions, withSessionTitle } from '../src/sessionArchive.js'

test('主列表与任务副列表共用归档过滤', () => {
  const sessions = [{ sessionId: 'normal' }, { sessionId: 'archived' }, { sessionId: 'task', origin: 'subagent' }]
  assert.deepEqual(filterArchivedSessions(sessions, ['archived']).map(session => session.sessionId), ['normal', 'task'])
  assert.deepEqual(filterArchivedSessions(sessions, null), sessions)
})

test('重命名成功后只更新标题投影并保留原会话字段', () => {
  const original = { sessionId: 's1', updatedAt: 123, projections: { values: { sessionListMetadata: { title: '旧标题' } } } }
  const renamed = withSessionTitle(original, ' 新标题 ')
  assert.equal(renamed.projections.values.title, '新标题')
  assert.equal(renamed.updatedAt, 123)
  assert.equal(original.projections.values.title, undefined)
})

test('会话页读取归档集合并提供待选择标记、三点菜单、语音重命名和归档接口', () => {
  const source = readFileSync(new URL('../src/pages/ChatsPage.jsx', import.meta.url), 'utf8')
  const apiSource = readFileSync(new URL('../src/api.js', import.meta.url), 'utf8')
  assert.match(source, /Promise\.all\(\[api\.listSessions\(\), api\.listWorkspaces\(\)\]\)/)
  assert.match(source, /filterArchivedSessions\(items\.filter/)
  assert.match(source, /className="session-menu-trigger"/)
  assert.match(source, /subscribeMux/)
  assert.match(source, /reducePendingQuestions/)
  assert.match(source, /session\.pendingInteraction === 'question'/)
  assert.match(source, /❓ 待选择/)
  assert.match(source, /<strong>重命名<\/strong>/)
  assert.match(source, /useVoiceRecorder/)
  assert.match(source, /api\.rename\(\{ sessionId: session\.sessionId, title: next \}\)/)
  assert.match(source, /api\.archiveSession\(\{ sessionId: session\.sessionId \}\)/)
  assert.match(apiSource, /archiveSession: \(p\) => raw\('workspace\.archiveSession', p\)/)
})
