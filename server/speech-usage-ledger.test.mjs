import test from 'node:test'
import assert from 'node:assert/strict'
import { SpeechUsageLedger } from './speech-usage-ledger.mjs'

test('records successful speech duration by China-local day and month', () => {
  const ledger = new SpeechUsageLedger('', { offsetMinutes: 480 })
  ledger.record(60_000, Date.parse('2026-08-27T15:59:00Z'))
  ledger.record(120_000, Date.parse('2026-08-27T16:01:00Z'))
  const summary = ledger.summary(Date.parse('2026-08-27T16:02:00Z'))
  assert.equal(summary.todayMs, 120_000)
  assert.equal(summary.monthMs, 180_000)
  assert.equal(summary.allTimeMs, 180_000)
})

test('ignores empty durations', () => {
  const ledger = new SpeechUsageLedger('')
  assert.equal(ledger.record(0), false)
  assert.equal(ledger.summary().allTimeMs, 0)
})
