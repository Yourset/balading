import test from 'node:test'
import assert from 'node:assert/strict'
import {
  connectionFailureAction,
  createPcmReplayPlan,
  getPcmArchiveStats,
  RECOGNITION_TIMEOUT_MS,
  sendRecognitionFrames
} from '../src/voiceRecovery.js'

test('PCM 录音统计可判断本地录音是否能重试', () => {
  const first = new ArrayBuffer(16_000)
  const second = new ArrayBuffer(16_000)
  assert.deepEqual(getPcmArchiveStats([first, null, new ArrayBuffer(0), second]), {
    chunks: 2,
    bytes: 32_000,
    durationMs: 1000,
    canRetry: true
  })
  assert.equal(getPcmArchiveStats([]).canRetry, false)
})

test('重识别计划在新连接中按 start、原 PCM、finish 顺序重放', () => {
  const first = new ArrayBuffer(320)
  const second = new ArrayBuffer(640)
  const source = [first, second]
  const plan = createPcmReplayPlan(source)

  assert.deepEqual(JSON.parse(plan[0]), {
    type: 'start', format: 'pcm', rate: 16000, bits: 16, channel: 1
  })
  assert.equal(plan[1], first)
  assert.equal(plan[2], second)
  assert.deepEqual(JSON.parse(plan[3]), { type: 'finish' })
  assert.deepEqual(source, [first, second], '生成重放计划不能清空原录音')
})

test('空录音不会生成无效重识别请求', () => {
  assert.deepEqual(createPcmReplayPlan([null, new ArrayBuffer(0)]), [])
})

test('客户端识别看门狗晚于服务端最终结果超时', () => {
  assert.equal(RECOGNITION_TIMEOUT_MS, 24_000)
  assert.ok(RECOGNITION_TIMEOUT_MS > 20_000)
})

test('只有 PCM 与 finish 全部 send 成功后才启动识别看门狗', () => {
  const frames = createPcmReplayPlan([new ArrayBuffer(320), new ArrayBuffer(640)])
  const sent = []
  let armedAfter = -1
  const socket = { send: frame => sent.push(frame) }

  assert.equal(sendRecognitionFrames(socket, frames, () => { armedAfter = sent.length }), true)
  assert.equal(armedAfter, frames.length)
  assert.deepEqual(JSON.parse(sent.at(-1)), { type: 'finish' })
})

test('PCM 发送中途失败不会启动识别看门狗', () => {
  const frames = createPcmReplayPlan([new ArrayBuffer(320)])
  let sends = 0
  let armed = false
  const socket = { send() { sends += 1; if (sends === 2) throw new Error('network') } }

  assert.throws(() => sendRecognitionFrames(socket, frames, () => { armed = true }), /network/)
  assert.equal(armed, false)
})

test('finish flush 期间断线延后收口，flush 后才保留失败录音', () => {
  assert.equal(connectionFailureAction({ flushing: true, finishRequested: true }), 'defer')
  assert.equal(connectionFailureAction({ flushing: false, finishRequested: true }), 'retain')
  assert.equal(connectionFailureAction({ flushing: false, retrying: true }), 'retain')
  assert.equal(connectionFailureAction({ flushing: false }), 'continue-recording')
})
