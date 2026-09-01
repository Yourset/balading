import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { latestListEdge, readSessionSortOrder, selectLatestSessionWindow, writeSessionSortOrder } from '../src/sessionListWindow.js'

const sessions = Array.from({ length: 100 }, (_, index) => ({ sessionId: String(index + 1) }))

test('最新在上时首屏截取开头 10 条最新会话', () => {
  const newestFirst = [...sessions].reverse()
  assert.deepEqual(selectLatestSessionWindow(newestFirst, 10, 'newest-first').map(item => item.sessionId),
    Array.from({ length: 10 }, (_, index) => String(100 - index)))
  assert.equal(latestListEdge('newest-first'), 'top')
})

test('最新在下时首屏截取末尾 10 条最新会话', () => {
  assert.deepEqual(selectLatestSessionWindow(sessions, 10, 'oldest-first').map(item => item.sessionId),
    Array.from({ length: 10 }, (_, index) => String(index + 91)))
  assert.equal(latestListEdge('oldest-first'), 'bottom')
})

test('自动继续加载每次只扩大 10 条且不改变展示方向', () => {
  assert.deepEqual(selectLatestSessionWindow(sessions, 20, 'oldest-first').map(item => item.sessionId),
    Array.from({ length: 20 }, (_, index) => String(index + 81)))
})

test('排序设置写入后可稳定读回最新在下', () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
  assert.equal(writeSessionSortOrder('oldest-first', storage), 'oldest-first')
  assert.equal(readSessionSortOrder(storage), 'oldest-first')
})

test('设置页与列表页共用 App 的同一个排序状态', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const chats = readFileSync(new URL('../src/pages/ChatsPage.jsx', import.meta.url), 'utf8')
  assert.match(app, /<ChatsPage mode=\{sessionListMode\} sortOrder=\{sessionSortOrder\}/)
  assert.match(app, /sessionSortOrder=\{sessionSortOrder\}/)
  assert.match(chats, /function ChatsPage\(\{ mode = 'main', sortOrder = 'newest-first'/)
  assert.doesNotMatch(chats, /localStorage\.getItem\(SORT_KEY\)/)
})
