import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildOptimizationCandidates,
  findOptimizationRoot,
  isCacheableTaskTerminal,
  latestTaskTerminal,
  optimizationDescendants,
  selectOptimizationCards,
  statusForTaskTerminal,
  truncateTaskDescription
} from '../src/optimizationTasks.js'
import { activeTabForRoute, isTopLevelRoute, routeBackTarget } from '../src/navigation.js'

const sessions = [
  { sessionId: 'mobile-root', updatedAt: 1, projections: { values: { title: '手机端优化助手' } } },
  { sessionId: 'fitness-root', updatedAt: 2, projections: { values: { title: '健身助手' } } },
  { sessionId: 'run', parentSessionId: 'mobile-root', origin: 'subagent', running: true, updatedAt: 20, projections: { values: { title: '旧标题', subagentTiming: { active: { through: 25 } } } } },
  { sessionId: 'done', parentSessionId: 'mobile-root', origin: 'subagent', running: false, updatedAt: 30 },
  { sessionId: 'nested', parentSessionId: 'run', origin: 'subagent', running: false, updatedAt: 40 },
  { sessionId: 'fitness-task', parentSessionId: 'fitness-root', origin: 'subagent', running: true, updatedAt: 99 }
]

const catalogs = {
  'mobile-root': { entries: [
    { kind: 'child', id: 'run', mode: 'continuable', label: '修复手机工具导航和返回链', activity: 'running' },
    { kind: 'child', id: 'done', mode: 'one-shot', label: '检查监控任务卡显示是否准确', activity: 'inactive' }
  ] },
  run: { entries: [{ kind: 'child', id: 'nested', mode: 'one-shot', label: '嵌套执行分支', activity: 'inactive' }] }
}

test('只收集手机端优化助手后代并保留直接父级传输模式', () => {
  const root = findOptimizationRoot(sessions, '', '手机端优化助手')
  assert.equal(root.sessionId, 'mobile-root')
  assert.equal(findOptimizationRoot(sessions, '', ['优化总管', '手机端优化助手']).sessionId, 'mobile-root')
  assert.deepEqual(optimizationDescendants(sessions, root.sessionId).map(item => item.sessionId), ['run', 'done', 'nested'])
  const candidates = buildOptimizationCandidates(sessions, root.sessionId, catalogs)
  assert.deepEqual(candidates.map(item => [item.sessionId, item.parentSessionId, item.mode]), [
    ['run', 'mobile-root', 'continuable'],
    ['done', 'mobile-root', 'one-shot'],
    ['nested', 'run', 'one-shot']
  ])
  assert.equal(candidates[0].activityAt, 25)
})

test('任务卡运行中优先并保留失败、停止与成功终态', () => {
  const candidates = buildOptimizationCandidates(sessions, 'mobile-root', catalogs)
  const stopped = { ...candidates[1], sessionId: 'stopped', label: '用户停止的优化任务' }
  const cards = selectOptimizationCards([...candidates, stopped], {
    done: latestTaskTerminal({ events: [{ event: { type: 'turn/end', time: 80, data: { reason: { kind: 'completed' } } } }] }),
    stopped: latestTaskTerminal({ events: [{ event: { type: 'turn/end', time: 90, data: { reason: { kind: 'interrupted' } } } }] }),
    nested: latestTaskTerminal({ events: [{ event: { type: 'turn/end', time: 100, data: { reason: { kind: 'max-tokens' } } } }] })
  })
  assert.deepEqual(cards.map(card => [card.sessionId, card.status]), [
    ['run', 'running'],
    ['nested', 'failed'],
    ['stopped', 'stopped'],
    ['done', 'completed']
  ])
  assert.equal(cards[0].category, '手机优化')
  assert.ok(Array.from(cards[1].description).length <= 20)
  assert.equal(truncateTaskDescription('  一段  有空格的任务描述  '), '一段 有空格的任务描述')
})

test('真实嵌套 reason.kind 映射完成、停止与失败', () => {
  const terminal = kind => latestTaskTerminal({ events: [{ event: { type: 'turn/end', time: 7, data: { reason: { kind } } } }] })
  assert.deepEqual(terminal('completed'), { type: 'turn/end', time: 7, reasonKind: 'completed' })
  for (const kind of ['aborted', 'interrupted', 'cancelled', 'canceled']) assert.equal(statusForTaskTerminal(terminal(kind)), 'stopped')
  for (const kind of ['blocked', 'error', 'max-tokens']) assert.equal(statusForTaskTerminal(terminal(kind)), 'failed')
  assert.equal(statusForTaskTerminal(latestTaskTerminal({ events: [{ event: { type: 'turn/error', time: 8, data: {} } }] })), 'failed')
  assert.equal(statusForTaskTerminal(latestTaskTerminal({ events: [{ event: { type: 'turn/cancel', time: 9, data: {} } }] })), 'stopped')
  assert.equal(statusForTaskTerminal(latestTaskTerminal({ events: [{ event: { type: 'turn/end', time: 10, data: {} } }] })), 'completed')
})

test('任务卡最多保留六条且按活动时间截断', () => {
  const candidates = Array.from({ length: 8 }, (_, index) => ({
    sessionId: 'task-' + index,
    parentSessionId: 'root',
    mode: 'one-shot',
    label: '任务 ' + index,
    running: false,
    activityAt: index
  }))
  const terminals = Object.fromEntries(candidates.map((candidate, index) => [candidate.sessionId, {
    type: 'turn/end', time: 100 + index, reasonKind: index % 2 ? 'completed' : 'error'
  }]))
  const cards = selectOptimizationCards(candidates, terminals)
  assert.equal(cards.length, 6)
  assert.deepEqual(cards.map(card => card.sessionId), ['task-7', 'task-6', 'task-5', 'task-4', 'task-3', 'task-2'])
})

test('临时 history 失败不缓存，保留下一轮重试资格', () => {
  assert.equal(isCacheableTaskTerminal(null), false)
  assert.equal(isCacheableTaskTerminal({ type: 'turn/end', reasonKind: 'completed' }), true)
  const source = readFileSync(new URL('../src/useOptimizationTaskCards.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /terminalCache\.current\.set\(candidate\.sessionId, null\)/)
  assert.match(source, /临时 history 失败不写入缓存/)
})

test('历史终态、工具与优化中心返回链按约定解析', () => {
  assert.deepEqual(latestTaskTerminal({ events: [
    { event: { type: 'turn/end', time: 5 } },
    { event: { type: 'assistant/message', time: 6 } }
  ] }), { type: 'turn/end', time: 5, reasonKind: '' })
  assert.equal(routeBackTarget('#/paint'), '#/tools')
  assert.equal(routeBackTarget('#/tools'), '#/monitor')
  assert.equal(activeTabForRoute('#/paint'), '#/monitor')
  assert.equal(activeTabForRoute('#/tools'), '#/monitor')
  assert.equal(activeTabForRoute('#/optimize'), '#/optimize')
  assert.equal(routeBackTarget('#/assistant/mobile-optimizer?from=optimize'), '#/optimize')
  assert.equal(activeTabForRoute('#/assistant/mobile-optimizer?from=optimize'), '#/optimize')
  assert.equal(routeBackTarget('#/assistant/mobile-optimizer'), '#/assistant')
  assert.equal(routeBackTarget('#/task/parent/child/one-shot/from-optimize'), '#/optimize')
  assert.equal(activeTabForRoute('#/task/parent/child/continuable/from-optimize'), '#/optimize')
  assert.equal(routeBackTarget('#/task/parent/child/one-shot/from-optimizer'), '#/assistant/mobile-optimizer')
  assert.equal(activeTabForRoute('#/task/parent/child/continuable/from-optimizer'), '#/assistant')
  assert.equal(routeBackTarget('#/task/parent/child/one-shot'), '#/')
  assert.equal(activeTabForRoute('#/task/parent/child/continuable'), '#/')
  assert.equal(isTopLevelRoute('#/tools'), false)
  assert.equal(isTopLevelRoute('#/optimize'), true)
  assert.equal(isTopLevelRoute('#/monitor'), true)
})
