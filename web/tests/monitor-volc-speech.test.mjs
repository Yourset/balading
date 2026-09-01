import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/MonitorPage.jsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

test('资源监控包含豆包语音用量、费用、余额与剩余小时', () => {
  assert.match(page, /\['volc-speech', '豆包语音'\]/)
  assert.match(page, /豆包语音 SeedASR 2\.0/)
  assert.match(page, /todayEstimatedCost/)
  assert.match(page, /monthEstimatedCost/)
  assert.match(page, /availableBalance/)
  assert.match(page, /remainingHours/)
  const card = page.match(/<article className="monitor-card volc-speech wide">([\s\S]*?)<\/article>/)?.[1] || ''
  assert.doesNotMatch(card, /<Gauge/)
  assert.match(card, /volc-overview/)
  assert.match(card, /volc-usage-list/)
  assert.match(styles, /\.monitor-card\.wide \{ grid-column: 1 \/ -1; \}/)
  assert.doesNotMatch(styles, /\.monitor-details b[^}]*text-overflow: ellipsis/)
})

test('监控页在顶部下拉超过阈值后松手立即刷新', () => {
  assert.match(page, /scroll\.scrollTop > 2/)
  assert.match(page, /event\.cancelable\) event\.preventDefault\(\)/)
  assert.match(page, /pullValue\.current >= 52/)
  assert.match(page, /松开立即刷新/)
  assert.match(page, /load\(true\)/)
})
