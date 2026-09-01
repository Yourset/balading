import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DAY_MS = 24 * 60 * 60 * 1000

function localKey(timestamp, offsetMinutes, size = 10) {
  return new Date(Number(timestamp) + offsetMinutes * 60_000).toISOString().slice(0, size)
}

export class SpeechUsageLedger {
  constructor(file, options = {}) {
    this.file = file || ''
    this.offsetMinutes = Number.isFinite(Number(options.offsetMinutes)) ? Number(options.offsetMinutes) : 480
    this.state = { version: 1, days: {}, recordedFrom: null, updatedAt: null }
    this.load()
  }

  load() {
    if (!this.file || !existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      if (parsed && parsed.version === 1 && parsed.days && typeof parsed.days === 'object') {
        this.state = { ...this.state, ...parsed, days: { ...parsed.days } }
      }
    } catch (error) {}
  }

  save() {
    if (!this.file) return
    mkdirSync(path.dirname(this.file), { recursive: true })
    const temp = this.file + '.tmp'
    writeFileSync(temp, JSON.stringify(this.state, null, 2) + '\n', 'utf8')
    renameSync(temp, this.file)
  }

  record(durationMs, timestamp = Date.now()) {
    const duration = Math.max(0, Math.round(Number(durationMs) || 0))
    if (!duration) return false
    const day = localKey(timestamp, this.offsetMinutes)
    this.state.days[day] = Math.max(0, Number(this.state.days[day]) || 0) + duration
    this.state.recordedFrom = this.state.recordedFrom || Number(timestamp)
    this.state.updatedAt = Number(timestamp)
    const cutoff = localKey(Number(timestamp) - 400 * DAY_MS, this.offsetMinutes)
    for (const key of Object.keys(this.state.days)) if (key < cutoff) delete this.state.days[key]
    this.save()
    return true
  }

  summary(timestamp = Date.now()) {
    const day = localKey(timestamp, this.offsetMinutes)
    const month = localKey(timestamp, this.offsetMinutes, 7)
    const entries = Object.entries(this.state.days)
    return {
      todayMs: Number(this.state.days[day]) || 0,
      monthMs: entries.filter(([key]) => key.startsWith(month)).reduce((sum, [, value]) => sum + (Number(value) || 0), 0),
      allTimeMs: entries.reduce((sum, [, value]) => sum + (Number(value) || 0), 0),
      recordedFrom: this.state.recordedFrom,
      updatedAt: this.state.updatedAt,
      timeZoneOffsetMinutes: this.offsetMinutes,
    }
  }
}
