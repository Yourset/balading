import React, { useEffect, useRef, useState } from 'react'
import { getHealthProbeBase } from '../api.js'

const CHECK_INTERVAL_MS = 5000
const FAILURE_THRESHOLD = 3
let lastKnown = { state: 'init', gwMs: null, dshMs: null }

async function probe(url, timeoutMs) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const startedAt = Date.now()
    const res = await fetch(url, { cache: 'no-store', credentials: 'include', signal: ctrl.signal })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return { ms: Date.now() - startedAt, json: await res.json().catch(() => null) }
  } finally { clearTimeout(timer) }
}

export default function ConnectionStatus() {
  const [state, setState] = useState(lastKnown.state)
  const [gwMs, setGwMs] = useState(lastKnown.gwMs)
  const [dshMs, setDshMs] = useState(lastKnown.dshMs)
  const inFlight = useRef(false)
  const failureStreak = useRef(0)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      if (inFlight.current) return
      inFlight.current = true
      const healthBase = getHealthProbeBase()
      try {
        const [gateway, dsh] = await Promise.allSettled([
          probe(healthBase + '/api/link/gateway?t=' + Date.now(), 4000),
          probe(healthBase + '/api/link/dsh?t=' + Date.now(), 6000)
        ])
        if (!alive) return
        const gwOk = gateway.status === 'fulfilled'
        const dshValue = dsh.status === 'fulfilled' && dsh.value.json?.ok ? dsh.value.json.value : null
        const dshOk = !!(dshValue && dshValue.ms >= 0)
        if (gwOk && dshOk) {
          failureStreak.current = 0
          const nextGwMs = gateway.value.ms
          const nextDshMs = dshValue.ms
          const nextState = nextGwMs > 500 || nextDshMs > 500 ? 'slow' : 'ok'
          lastKnown = { state: nextState, gwMs: nextGwMs, dshMs: nextDshMs }
          setGwMs(nextGwMs); setDshMs(nextDshMs); setState(nextState)
        } else {
          failureStreak.current += 1
          const nextState = failureStreak.current >= FAILURE_THRESHOLD ? (gwOk ? 'dsh-down' : 'down') : 'unstable'
          lastKnown = { ...lastKnown, state: nextState }
          setState(nextState)
        }
      } finally {
        inFlight.current = false
      }
    }
    tick()
    const timer = setInterval(tick, CHECK_INTERVAL_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  const label = state === 'init' ? '检测中…'
    : state === 'unstable' ? '网络波动'
      : state === 'down' ? '连接断开'
        : state === 'dsh-down' ? '电脑端断开'
          : '📱' + (gwMs ?? '?') + 'ms · 🖥' + (dshMs ?? '?') + 'ms'

  return <div className={'conn-status conn-' + state} title={'连续三次失败才判定断开（每5秒检测）'}>
    <span className="conn-dot" /><span className="conn-label">{label}</span>
  </div>
}
