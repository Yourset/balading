import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { api, getHealthProbeBase } from '../src/api.js'
import { isAutomatedTaskSession } from '../src/assistantCatalog.js'

test('远程正式页面忽略旧服务器地址并探测当前 origin', () => {
  globalThis.localStorage = { getItem: () => 'https://legacy.example.com' }
  globalThis.window = { location: { protocol: 'https:', hostname: 'm.example.com', origin: 'https://m.example.com' } }
  assert.equal(getHealthProbeBase(), 'https://m.example.com')
})

test('并发 session.list 合并为一次网络请求', async () => {
  globalThis.localStorage = { getItem: () => '' }
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    await Promise.resolve()
    return { status: 200, async json() { return { type: 'server-response', result: { ok: true, value: { items: [{ sessionId: 's1' }] } } } } }
  }
  const [a, b] = await Promise.all([api.listSessions(), api.listSessions()])
  assert.equal(calls, 1)
  assert.deepEqual(a, b)
})

test('列表预热延后、限量并排除助手与自动任务', () => {
  const source = readFileSync(new URL('../src/pages/ChatsPage.jsx', import.meta.url), 'utf8')
  assert.match(source, /setTimeout\([\s\S]*1500/)
  assert.match(source, /slice\(0, 6\)/)
  assert.match(source, /concurrency: 1/)
  assert.match(source, /if \(alive\) warmAllSessionCaches/)
  assert.match(source, /!assistantIds\.has/)
  assert.match(source, /!isAutomatedTaskSession/)
})

test('主列表缓存遵守五分钟 TTL 且每次渐进渲染 10 条', () => {
  const source = readFileSync(new URL('../src/pages/ChatsPage.jsx', import.meta.url), 'utf8')
  assert.match(source, /now - memorySessionList\.t < CACHE_TTL/)
  assert.match(source, /now - Number\(cached\.t \|\| 0\) < CACHE_TTL/)
  assert.match(source, /INITIAL_RENDER_LIMIT = 10/)
  assert.match(source, /RENDER_PAGE_SIZE = 10/)
  assert.match(source, /selectLatestSessionWindow\(grouped, renderLimit, sortOrder\)/)
  assert.match(source, /scroller\.addEventListener\('scroll', onScroll/)
  assert.match(source, /pendingScrollAnchorRef/)
  assert.match(source, /\[mode, sortOrder\]/)
  assert.match(source, /scroller\.scrollHeight <= scroller\.clientHeight \+ 1/)
  assert.match(source, /\[renderLimit, grouped\.length, sortOrder\]/)
  assert.doesNotMatch(source, /list-load-more/)
  assert.doesNotMatch(source, /grouped\.slice\(0, renderLimit\)/)
})

test('只有真正 subagent 进入任务副列表，普通 fork 留在主列表', () => {
  assert.equal(isAutomatedTaskSession({ origin: 'subagent', parentSessionId: 'parent' }), true)
  assert.equal(isAutomatedTaskSession({ parentSessionId: 'parent' }), false)
  assert.equal(isAutomatedTaskSession({ parentId: 'parent' }), false)
})
