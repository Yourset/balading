import test from 'node:test'
import assert from 'node:assert/strict'
import { MOBILE_SOURCE_MARKER, withMobileSource } from '../src/mobilePrompt.js'
import { readHistoryCache, readModelCache, warmAllSessionCaches } from '../src/sessionCache.js'

function installStorage() {
  const values = new Map()
  globalThis.localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  }
  globalThis.window = { dispatchEvent() {} }
}

test('所有手机 prompt 自动附带且只附带一次隐藏来源标记', () => {
  const payload = { sessionId: 's1', content: [{ type: 'text', text: '你好' }] }
  const marked = withMobileSource('session.prompt', payload)
  assert.equal(marked.content[0].text, MOBILE_SOURCE_MARKER)
  assert.equal(marked.content[0].clientHidden, true)
  assert.equal(marked.content[1].text, '你好')
  assert.equal(withMobileSource('session.prompt', marked).content.length, 2)
  assert.equal(withMobileSource('session.create', payload), payload)
})

test('列表预同步按最近会话优先并缓存消息首屏与模型信息', async () => {
  installStorage()
  const calls = []
  const api = {
    async history({ sessionId }) {
      calls.push('history:' + sessionId)
      return { events: [{ event: { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: sessionId }] } } }] }
    },
    async models({ sessionId }) {
      calls.push('models:' + sessionId)
      return { current: { provider: 'p', model: sessionId }, groups: [] }
    }
  }
  const sessions = [
    { sessionId: 'old', updatedAt: 10 },
    { sessionId: 'new', updatedAt: 20 }
  ]
  const result = await warmAllSessionCaches(sessions, api, { concurrency: 1, historyLimit: 15 })
  assert.deepEqual(calls, ['history:new', 'models:new', 'history:old', 'models:old'])
  assert.equal(result.histories, 2)
  assert.equal(readHistoryCache('new').events[0].data.content[0].text, 'new')
  assert.equal(readModelCache('old').value.current.model, 'old')

  calls.length = 0
  await warmAllSessionCaches(sessions, api, { concurrency: 1, historyLimit: 15 })
  assert.deepEqual(calls, [])
})
