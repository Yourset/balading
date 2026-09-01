import crypto from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const ALLOWED_TYPES = new Set(['window-error','unhandled-rejection','route-change','long-task','slow-rpc','rpc-error','health-failure','self-heal'])
const safe = (value, max = 500) => String(value || '').replace(/https?:\/\/[^\s?#]+(?:[?#][^\s]*)?/gi, '[url]').replace(/[A-Za-z]:\\[^\s]+/g, '[path]').replace(/(?:token|cookie|password|authorization|content)[=:]\s*[^\s,;]+/gi, '$1=[redacted]').slice(0, max)

export class ClientErrorStore {
  constructor(file) { this.file = file; this.incidents = new Map(); this.seenIds = new Set() }
  ingest(deviceId, events) {
    const accepted = []
    for (const raw of Array.isArray(events) ? events.slice(0, 20) : []) {
      const id = safe(raw?.id, 80)
      if (!id || this.seenIds.has(id)) continue
      this.seenIds.add(id); if (this.seenIds.size > 5000) this.seenIds = new Set([...this.seenIds].slice(-2500))
      const event = { id, type: ALLOWED_TYPES.has(raw?.type) ? raw.type : 'window-error', message: safe(raw?.message), method: safe(raw?.method,100), route: safe(raw?.route,120), durationMs: Number.isFinite(raw?.durationMs) ? Math.max(0,Math.round(raw.durationMs)) : null, status: Number.isFinite(raw?.status) ? raw.status : null, version: safe(raw?.version,30), time: Number.isFinite(raw?.time) ? raw.time : Date.now(), online: raw?.online !== false, device: crypto.createHash('sha256').update(String(deviceId)).digest('hex').slice(0,12) }
      const fingerprint = crypto.createHash('sha256').update([event.type,event.message,event.method,event.version].join('|')).digest('hex').slice(0,16)
      const previous = this.incidents.get(fingerprint) || { fingerprint, type:event.type, message:event.message, method:event.method, version:event.version, count:0, firstSeen:event.time, lastSeen:event.time, maxDurationMs:0, lastRoute:event.route }
      previous.count += 1; previous.lastSeen = Math.max(previous.lastSeen,event.time); previous.maxDurationMs = Math.max(previous.maxDurationMs,event.durationMs || 0); previous.lastRoute = event.route
      this.incidents.set(fingerprint, previous); accepted.push({ ...event, fingerprint })
    }
    if (accepted.length) { mkdirSync(path.dirname(this.file), { recursive:true }); appendFileSync(this.file, accepted.map(event => JSON.stringify(event)).join('\n')+'\n','utf8') }
    return accepted
  }
  list(limit=100) { return [...this.incidents.values()].sort((a,b)=>b.lastSeen-a.lastSeen).slice(0,Math.max(1,Math.min(200,limit))) }
}
