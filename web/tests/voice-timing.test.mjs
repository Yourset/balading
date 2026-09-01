import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  EXTENDED_VOICE_LIMIT_MS,
  NORMAL_VOICE_LIMIT_MS,
  getVoiceTiming
} from '../src/voiceTiming.js'

test('普通语音从开始到到期前都可首次切换继续说话', () => {
  assert.equal(NORMAL_VOICE_LIMIT_MS, 60_000)
  assert.deepEqual(getVoiceTiming(49_999, false), {
    limitMs: 60_000,
    remainingMs: 10_001,
    remainingSec: 11,
    warning: false,
    canExtend: true,
    expired: false
  })
  assert.equal(getVoiceTiming(0, false).canExtend, true)
  assert.equal(getVoiceTiming(59_999, false).canExtend, true)
  assert.equal(getVoiceTiming(60_000, false).canExtend, false)

  const warning = getVoiceTiming(50_000, false)
  assert.equal(warning.remainingSec, 10)
  assert.equal(warning.warning, true)
  assert.equal(warning.canExtend, true)
})

test('续说沿用同一次录音且总时长最多两分钟', () => {
  assert.equal(EXTENDED_VOICE_LIMIT_MS, 120_000)
  const continued = getVoiceTiming(60_000, true)
  assert.equal(continued.remainingSec, 60)
  assert.equal(continued.canExtend, false)
  assert.equal(continued.expired, false)

  const finalWarning = getVoiceTiming(110_000, true)
  assert.equal(finalWarning.warning, true)
  assert.equal(finalWarning.remainingSec, 10)
  assert.equal(getVoiceTiming(120_000, true).expired, true)
})

test('长按阶段始终提供双滑区且首次右滑不依赖最后十秒', () => {
  const composer = readFileSync(new URL('../src/components/Composer.jsx', import.meta.url), 'utf8')
  const voice = readFileSync(new URL('../src/voice.js', import.meta.url), 'utf8')
  assert.match(composer, /const insideContinue = !voice\.extended/)
  assert.match(composer, /\{!voice\.extended && <div ref=\{continueZoneRef\}/)
  assert.match(composer, /handsFreeVoiceRef\.current && \['connecting', 'recording'\]\.includes\(voice\.state\)/)
  assert.match(composer, /if \(\['connecting', 'recording'\]\.includes\(voice\.state\)\) return/)
  assert.doesNotMatch(composer, /if \(voice\.state === 'recording'\) return/)
  assert.doesNotMatch(voice, /timing\?\.canExtend/)
  assert.match(voice, /if \(session\.recordingStartedAt\) armTiming\(session\)/)
})
