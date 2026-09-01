import test from 'node:test'
import assert from 'node:assert/strict'
import { speechLimits, speechProtocol } from './speech-stream.mjs'

function payload(frame) {
  const size = frame.readUInt32BE(4)
  return frame.subarray(8, 8 + size)
}

test('full request uses JSON and 16k mono PCM contract', () => {
  const frame = speechProtocol.fullRequestFrame('req-1')
  assert.deepEqual([...frame.subarray(0, 4)], [0x11, 0x10, 0x10, 0])
  const body = JSON.parse(payload(frame).toString('utf8'))
  assert.equal(body.audio.format, 'pcm')
  assert.equal(body.audio.sample_rate, 16000)
  assert.equal(body.audio.channel, 1)
  assert.equal(body.request.reqid, 'req-1')
  assert.equal(body.request.sequence, 1)
})

test('audio frames carry raw PCM and final flag without sequence field', () => {
  const pcm = Buffer.from([1, 2, 3, 4])
  const regular = speechProtocol.audioFrame(pcm, false)
  const final = speechProtocol.audioFrame(pcm, true)
  assert.deepEqual([...regular.subarray(0, 4)], [0x11, 0x20, 0x00, 0])
  assert.deepEqual([...final.subarray(0, 4)], [0x11, 0x22, 0x00, 0])
  assert.deepEqual(payload(final), pcm)
})

test('flags=2 terminal server result has no sequence field', () => {
  const body = Buffer.from(JSON.stringify({ result: { text: '你好' } }))
  const frame = Buffer.alloc(4 + 4 + body.length)
  frame.set([0x11, 0x92, 0x10, 0], 0)
  frame.writeUInt32BE(body.length, 4)
  body.copy(frame, 8)
  const parsed = speechProtocol.parseServerFrame(frame)
  assert.equal(parsed.sequence, null)
  assert.equal(parsed.isLast, true)
  assert.equal(parsed.value.result.text, '你好')
})

test('flags=3 terminal server result carries a signed sequence', () => {
  const body = Buffer.from(JSON.stringify({ result: { text: '世界' } }))
  const frame = Buffer.alloc(4 + 4 + 4 + body.length)
  frame.set([0x11, 0x93, 0x10, 0], 0)
  frame.writeInt32BE(-3, 4)
  frame.writeUInt32BE(body.length, 8)
  body.copy(frame, 12)
  const parsed = speechProtocol.parseServerFrame(frame)
  assert.equal(parsed.sequence, -3)
  assert.equal(parsed.isLast, true)
  assert.equal(parsed.value.result.text, '世界')
})

test('truncated response is rejected', () => {
  assert.throws(() => speechProtocol.parseServerFrame(Buffer.from([0x11, 0x90, 0x10, 0])))
})

test('gateway accepts the same two-minute maximum as the mobile recorder', () => {
  assert.equal(speechLimits.maxRecordMs, 120_000)
  assert.ok(speechLimits.absoluteTimeoutMs >= 125_000)
  assert.ok(speechLimits.maxPcmBytes >= 16_000 * 2 * 120)
})
