import test from 'node:test'
import assert from 'node:assert/strict'
import { MOBILE_OPTIMIZER_POLICY, withOptimizerPolicy } from '../src/optimizerPrompt.js'

test('手机端优化助手保留原始口述并追加一条隐藏确认策略', () => {
  const original = [{ type: 'text', text: '这个按钮太小了，帮我改一下' }]
  const result = withOptimizerPolicy(original)

  assert.equal(result.length, 2)
  assert.deepEqual(result[0], original[0])
  assert.equal(result[1].clientHidden, true)
  assert.equal(result[1].text, MOBILE_OPTIMIZER_POLICY)
  assert.equal(original.length, 1)
})

test('确认策略要求先弹确认卡，获批前禁止修改和部署', () => {
  assert.match(MOBILE_OPTIMIZER_POLICY, /ask_user_question/)
  assert.match(MOBILE_OPTIMIZER_POLICY, /mobile_optimizer_apply/)
  assert.match(MOBILE_OPTIMIZER_POLICY, /同意并开始（推荐）/)
  assert.match(MOBILE_OPTIMIZER_POLICY, /收到“同意并开始”之前，禁止写文件/)
  assert.match(MOBILE_OPTIMIZER_POLICY, /部署后必须报告巴拉丁短版本号/)
})

test('派发策略要求优先复用同类任务且禁止按执行步骤重复开分支', () => {
  assert.match(MOBILE_OPTIMIZER_POLICY, /list_agents\(scope="children"\)/)
  assert.match(MOBILE_OPTIMIZER_POLICY, /send_message 继续最相关的 continuable 子任务/)
  assert.match(MOBILE_OPTIMIZER_POLICY, /不要按“分析\/编码\/测试\/提交”分别创建子任务/)
  assert.match(MOBILE_OPTIMIZER_POLICY, /已有相关子任务仍在运行时/)
  assert.match(MOBILE_OPTIMIZER_POLICY, /真正独立、可并行且文件范围不冲突/)
})

test('同一策略不会重复附加，空策略保持普通会话不变', () => {
  const once = withOptimizerPolicy([{ type: 'text', text: '反馈' }])
  assert.equal(withOptimizerPolicy(once).length, 2)

  const plain = [{ type: 'text', text: '普通聊天' }]
  assert.equal(withOptimizerPolicy(plain, ''), plain)
})
