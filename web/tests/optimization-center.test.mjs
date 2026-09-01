import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const readSource = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')

test('优化中心拥有独立底栏、反馈入口和任务数据链', () => {
  const app = readSource('../src/App.jsx')
  const page = readSource('../src/pages/OptimizationPage.jsx')
  const taskHook = readSource('../src/useOptimizationTaskCards.js')
  const styles = readSource('../src/styles.css')
  assert.match(app, /\['#\/optimize', '优化', '📱'\]/)
  assert.match(app, /<OptimizationPage \/>/)
  assert.match(page, /href="#\/assistant\/mobile-optimizer\?from=optimize"/)
  assert.match(page, /useOptimizationTaskCards/)
  assert.match(taskHook, /api\.listSessions\(\)/)
  assert.match(taskHook, /api\.listSubagents/)
  assert.match(taskHook, /api\.subagentHistory/)
  assert.match(taskHook, /selectOptimizationCards/)
  assert.match(page, /optimization-task-grid/)
  assert.match(page, /status === 'failed' \? '失败'/)
  assert.match(page, /status === 'stopped' \? '已停止'/)
  assert.match(page, /from-optimize/)
  assert.match(styles, /\.optimization-task-card\.failed/)
  assert.match(styles, /\.optimization-task-card\.stopped/)
})

test('资源监控不再加载或渲染优化任务', () => {
  const monitor = readSource('../src/pages/MonitorPage.jsx')
  assert.doesNotMatch(monitor, /loadOptimizationTasks|optimizationCards|optimization-tasks-title/)
  assert.match(monitor, /monitor-tools-link/)
  assert.match(monitor, /monitoringLatest/)
})
