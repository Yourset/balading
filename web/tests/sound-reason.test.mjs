import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SOUND_REASON_DISPLAY_MS,
  formatSoundReason,
  playAcceptedPromptSound,
  playSoundEvent,
  subscribeSoundEvents
} from '../src/sounds.js'

function installBrowser(soundPreset = 'chime') {
  const values = new Map([
    ['dsh-sound-task-complete', soundPreset],
    ['dsh-sound-voice-send', soundPreset],
    ['dsh-title-session-1', '健身助手']
  ])
  globalThis.localStorage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value))
  }
  class AudioContextMock {
    state = 'running'
    currentTime = 1
    destination = {}
    createOscillator() {
      return { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {}, type: 'sine' }
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }
    }
    async resume() { this.state = 'running' }
  }
  globalThis.window = { AudioContext: AudioContextMock, addEventListener() {} }
}

test('提示音原因短句优先使用会话与事件上下文', () => {
  installBrowser()
  assert.equal(SOUND_REASON_DISPLAY_MS, 1200)
  assert.equal(formatSoundReason('task', { source: '手机端优化助手', reason: '任务完成' }), '手机端优化助手：任务完成')
  assert.equal(formatSoundReason('voice', {}, 'session-1:123'), '健身助手：语音已发送')
  assert.equal(formatSoundReason('send'), '消息已发送')
  assert.equal(formatSoundReason('task', { source: '设置', preview: true }), '设置：试听任务提示音')
})

test('只有真正播放成功的 Web Audio 从统一入口发布原因事件', async () => {
  installBrowser()
  const events = []
  const unsubscribe = subscribeSoundEvents(event => events.push(event))
  try {
    const played = await playSoundEvent('send', 'sound-reason-' + Date.now(), { source: '私人助手', reason: '消息已发送' })
    assert.equal(played, true)
    assert.equal(events.length, 1)
    assert.equal(events[0].kind, 'send')
    assert.equal(events[0].text, '私人助手：消息已发送')
  } finally {
    unsubscribe()
  }
})

test('RPC 接受后的语音提示音按 rpcId 只播放一次', async () => {
  installBrowser()
  const events = []
  const unsubscribe = subscribeSoundEvents(event => events.push(event))
  const rpcId = 'accepted-voice-' + Date.now()
  try {
    assert.equal(await playAcceptedPromptSound({ kind: 'voice', rpcId, sessionId: 'session-1', source: '私人助手' }), true)
    assert.equal(await playAcceptedPromptSound({ kind: 'voice', rpcId, sessionId: 'session-1', source: '私人助手' }), false)
    assert.deepEqual(events.map(event => [event.kind, event.text]), [['voice', '私人助手：语音消息已发送']])
  } finally {
    unsubscribe()
  }
})

test('Composer 不再自行播放语音成功音，由 ChatPage 唯一入口负责', () => {
  const source = readFileSync(new URL('../src/components/Composer.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /playSoundEvent|playAcceptedPromptSound/)
})

test('ChatPage 只在 prompt RPC 成功返回后触发发送提示音', () => {
  const source = readFileSync(new URL('../src/pages/ChatPage.jsx', import.meta.url), 'utf8')
  const soundAt = source.indexOf('void playAcceptedPromptSound')
  assert.ok(soundAt > source.indexOf('await api.subagentPrompt'))
  assert.ok(soundAt > source.indexOf('await api.prompt'))
  assert.ok(soundAt < source.indexOf('finishPromptAttempt(sessionId, attempt, true)'))
  assert.equal((source.match(/void playAcceptedPromptSound/g) || []).length, 1)
  assert.doesNotMatch(source, /playSoundEvent\('send'/)
})
