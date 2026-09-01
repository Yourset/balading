import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyPendingQuestions, hasPendingQuestion, reducePendingQuestions } from '../src/pendingQuestions.js'

const requested = (rpcId, sessionId) => ({
  type: 'server-request', rpcId, payload: { type: 'question/requested', sessionId, questions: [] }
})
const resolved = (questionRpcId, sessionId) => ({
  type: 'server-request', rpcId: 'resolve-' + questionRpcId,
  payload: { type: 'question/resolved', sessionId, questionRpcId }
})

test('实时问题请求会点亮对应会话，解决后熄灭', () => {
  let state = reducePendingQuestions(emptyPendingQuestions(), requested('q1', 's1'))
  assert.equal(hasPendingQuestion(state, 's1'), true)
  state = reducePendingQuestions(state, resolved('q1', 's1'))
  assert.equal(hasPendingQuestion(state, 's1'), false)
})

test('同一会话多个问题必须全部解决后才移除标记', () => {
  let state = reducePendingQuestions(emptyPendingQuestions(), requested('q1', 's1'))
  state = reducePendingQuestions(state, requested('q2', 's1'))
  state = reducePendingQuestions(state, requested('q2', 's1'))
  assert.equal(state.sessionCounts.s1, 2)
  state = reducePendingQuestions(state, resolved('q1', 's1'))
  assert.equal(hasPendingQuestion(state, 's1'), true)
  state = reducePendingQuestions(state, resolved('q2', 's1'))
  assert.equal(hasPendingQuestion(state, 's1'), false)
})

test('未知解决事件和无关 mux 帧不会污染状态', () => {
  const initial = emptyPendingQuestions()
  assert.equal(reducePendingQuestions(initial, resolved('missing', 's1')), initial)
  assert.equal(reducePendingQuestions(initial, { payload: { type: 'session/event', sessionId: 's1' } }), initial)
})
