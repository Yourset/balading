import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const readSource = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')

test('优化总管保留旧会话身份并接入聊天顶部任务板', () => {
  const catalog = readSource('../src/assistantCatalog.js')
  const assistantPage = readSource('../src/pages/AssistantPage.jsx')
  const dock = readSource('../src/components/OptimizerTaskDock.jsx')
  const styles = readSource('../src/styles.css')
  assert.match(catalog, /title: '优化总管'/)
  assert.match(catalog, /legacyTitles: \['手机端优化助手'\]/)
  assert.match(assistantPage, /knownTitles = new Set\(\[assistant\.title, \.\.\.\(assistant\.legacyTitles \|\| \[\]\)\]\)/)
  assert.match(assistantPage, /<OptimizerTaskDock rootSessionId=\{sid\}/)
  assert.match(dock, /有一件事等你确认/)
  assert.match(dock, /稍后会有结果/)
  assert.match(dock, /已形成结果，点开查看/)
  assert.match(styles, /\.optimizer-task-dock/)
  assert.match(styles, /\.assistant-chat-body \{ flex: 1; min-height: 0; \}/)
})

test('仅优化总管隐藏工具流水，普通聊天保持原显示能力', () => {
  const assistantPage = readSource('../src/pages/AssistantPage.jsx')
  const chatPage = readSource('../src/pages/ChatPage.jsx')
  const bubble = readSource('../src/components/MessageBubble.jsx')
  assert.match(assistantPage, /hideTechnicalEvents=\{isOptimizer\}/)
  assert.match(chatPage, /hideTechnicalEvents=\{hideTechnicalEvents\}/)
  assert.match(bubble, /if \(hideTechnicalEvents\) return null/)
  assert.match(bubble, /🛠 已调用工具/)
  assert.match(bubble, /✅ 工具完成/)
})

test('优化中心与聊天顶部共用统一任务快照', () => {
  const center = readSource('../src/pages/OptimizationPage.jsx')
  const dock = readSource('../src/components/OptimizerTaskDock.jsx')
  const hook = readSource('../src/useOptimizationTaskCards.js')
  assert.match(center, /useOptimizationTaskCards/)
  assert.match(dock, /useOptimizationTaskCards/)
  assert.match(hook, /terminalCache/)
  assert.match(hook, /selectOptimizationCards/)
})
