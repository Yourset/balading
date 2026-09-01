import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/pages/ChatPage.jsx', import.meta.url), 'utf8')

test('会话详情接近顶部时自动加载更早历史', () => {
  assert.match(source, /el\.scrollTop <= 240 && hasOlder && !olderLoadingRef\.current/)
  assert.match(source, /void loadOlder\(\)/)
  assert.doesNotMatch(source, /onClick=\{loadOlder\}/)
  assert.doesNotMatch(source, /加载更早消息'}<\/button>/)
})

test('历史 prepend 后保持原阅读位置', () => {
  assert.match(source, /olderScrollAnchorRef\.current = \{ height: scroller\.scrollHeight, top: scroller\.scrollTop \}/)
  assert.match(source, /scroller\.scrollTop = anchor\.top \+ Math\.max\(0, scroller\.scrollHeight - anchor\.height\)/)
})

test('历史不足一屏时自动继续补页', () => {
  assert.match(source, /scroller\.scrollHeight <= scroller\.clientHeight \+ 1/)
  assert.match(source, /\[loading, hasOlder, items\.length, sessionId\]/)
})
