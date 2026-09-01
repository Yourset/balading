import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { monitoringCollect, monitoringLatest } from '../api.js'

const SOURCES = [
  ['tencent-traffic', '腾讯云流量'],
  ['deepseek-balance', 'DeepSeek 余额'],
  ['glm-quota', 'GLM 额度'],
  ['codex-quota', 'Codex 额度'],
  ['volc-speech', '豆包语音']
]
const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0))
const formatBytes = (value) => {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return '—'
  return (bytes / 1024 / 1024 / 1024).toFixed(bytes >= 100 * 1024 ** 3 ? 1 : 2)
}
const formatTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未采集'
const formatWindow = (minutes) => Number(minutes) >= 1440 ? (Number(minutes) / 1440).toFixed(Number(minutes) % 1440 ? 1 : 0) + ' 天' : Number(minutes) >= 60 ? (Number(minutes) / 60).toFixed(Number(minutes) % 60 ? 1 : 0) + ' 小时' : (Number(minutes) || '—') + ' 分钟'
const formatReset = (seconds) => seconds ? new Date(Number(seconds) * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
const formatHours = (hours) => Number(hours || 0) < 1 ? (Number(hours || 0) * 60).toFixed(1) + ' 分钟' : Number(hours || 0).toFixed(2) + ' 小时'
const formatMoney = (value) => '¥' + Number(value || 0).toFixed(Number(value || 0) < 1 ? 3 : 2)

function Gauge({ percent, color, value, unit, caption, neutral = false }) {
  return (
    <div className="monitor-gauge" style={{ '--monitor-percent': clamp(percent) + '%', '--monitor-color': color }}>
      <div className={'monitor-gauge-ring' + (neutral ? ' neutral' : '')}>
        <div className="monitor-gauge-core">
          <strong>{value}</strong>
          <span>{unit}</span>
        </div>
      </div>
      <div className="monitor-gauge-caption">{caption}</div>
    </div>
  )
}

function StatusBadge({ status }) {
  const text = status === 'ok' ? '正常' : status === 'disabled' ? '未配置' : '异常'
  return <span className={'monitor-status ' + (status || 'error')}><i />{text}</span>
}

function failureText(row) {
  if (!row) return '无返回数据'
  if (row.status === 'disabled') return '未配置'
  const detail = row.error?.message || row.error || row.message
  return typeof detail === 'string' && detail.trim() ? detail.trim() : '更新失败'
}

export default function MonitorPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const [pullDistance, setPullDistance] = useState(0)
  const pullStart = useRef(null)
  const pullValue = useRef(0)
  const pullReadyRef = useRef(false)
  const noticeTimer = useRef(null)

  const showNotice = useCallback((type, text) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    setNotice({ type, text })
    noticeTimer.current = setTimeout(() => setNotice(null), type === 'success' ? 2200 : 5200)
  }, [])

  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])

  const load = useCallback(async (force = false) => {
    force ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const response = force ? await monitoringCollect() : await monitoringLatest()
      const nextRows = Array.isArray(response.data) ? response.data : []
      setRows(nextRows)
      if (force) {
        const bySource = Object.fromEntries(nextRows.map(row => [row.source, row]))
        const failed = SOURCES
          .map(([source, label]) => ({ label, row: bySource[source] }))
          .filter(item => item.row?.status !== 'ok')
        if (!failed.length) showNotice('success', '数据已全部更新')
        else showNotice('error', '更新未完成：' + failed.map(item => item.label + '（' + failureText(item.row) + '）').join('；'))
      }
    } catch (e) {
      const message = e && e.message ? e.message : '监控数据加载失败'
      setError(message)
      if (force) showNotice('error', '更新失败：' + message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [showNotice])

  useEffect(() => {
    load(false)
    const timer = setInterval(() => load(false), 60000)
    return () => clearInterval(timer)
  }, [load])

  const onTouchStart = (event) => {
    const scroll = event.currentTarget.closest('.scroll')
    if (refreshing || (scroll && scroll.scrollTop > 2)) { pullStart.current = null; return }
    pullStart.current = { y: event.touches[0]?.clientY ?? null, scroll }
    pullValue.current = 0
    pullReadyRef.current = false
  }
  const onTouchMove = (event) => {
    const start = pullStart.current
    if (start?.y == null) return
    if (start.scroll && start.scroll.scrollTop > 2) { pullStart.current = null; setPullDistance(0); return }
    const delta = Math.max(0, (event.touches[0]?.clientY || 0) - start.y)
    if (delta <= 0) return
    if (event.cancelable) event.preventDefault()
    const next = Math.min(104, Math.pow(delta, 0.82) * 0.9)
    const ready = next >= 52
    if (ready && !pullReadyRef.current && navigator.vibrate) navigator.vibrate(10)
    pullReadyRef.current = ready
    pullValue.current = next
    setPullDistance(next)
  }
  const onTouchEnd = () => {
    const shouldRefresh = pullValue.current >= 52
    pullStart.current = null
    pullValue.current = 0
    pullReadyRef.current = false
    setPullDistance(0)
    if (shouldRefresh && !refreshing) load(true)
  }

  const data = useMemo(() => Object.fromEntries(rows.map(row => [row.source, row])), [rows])
  const tencent = data['tencent-traffic'] || {}
  const deepseek = data['deepseek-balance'] || {}
  const glm = data['glm-quota'] || {}
  const codex = data['codex-quota'] || {}
  const volc = data['volc-speech'] || {}
  const tp = tencent.payload || {}
  const dp = deepseek.payload || {}
  const gp = glm.payload || {}
  const cp = codex.payload || {}
  const vp = volc.payload || {}
  const balance = dp.balanceInfos && dp.balanceInfos[0]
  const five = gp.fiveHourTokens || {}
  const weekly = gp.weeklyTokens || {}
  const codexWindows = [cp.primary, cp.secondary].filter(Boolean).sort((a, b) => Number(a.windowDurationMins) - Number(b.windowDurationMins))
  const codexWindow = codexWindows[0] || {}
  const codexLongWindow = codexWindows.length > 1 ? codexWindows[codexWindows.length - 1] : null
  const latestAt = Math.max(0, ...rows.map(row => Number(row.collectedAt) || 0))
  const pullReady = pullDistance >= 52

  return (
    <section className="monitor-page" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <a className="monitor-tools-link" href="#/tools"><span>🧰</span><strong>打开工具</strong><small>AI 绘画等常用能力</small><b>›</b></a>

      <div className={'monitor-pull' + (refreshing ? ' refreshing' : '') + (pullDistance > 0 ? ' active' : '') + (pullReady ? ' ready' : '')}
        style={pullDistance ? { minHeight: Math.max(34, pullDistance) } : undefined}>
        {(refreshing || pullDistance > 4) && <span className="monitor-pull-spinner" />}
        <span>{refreshing ? '正在刷新监控数据…' : pullReady ? '松开立即刷新' : '↓ 下拉刷新'}</span>
      </div>

      {notice && <div className={'monitor-toast ' + notice.type} role="status">{notice.type === 'success' ? '✓ ' : '⚠ '}{notice.text}</div>}
      <header className="monitor-section-head resource-head"><div><small>额度与流量</small><h2>资源监控</h2></div><span>下拉立即更新</span></header>
      {error && <div className="monitor-error">{error}</div>}
      {loading && !rows.length ? <div className="monitor-loading"><span className="spin" />正在读取监控数据</div> : (
        <div className="monitor-grid">
          <article className="monitor-card traffic">
            <header><div><small>腾讯云 Lighthouse</small><h3>本月流量</h3></div><StatusBadge status={tencent.status} /></header>
            <Gauge percent={100 - (Number(tp.usagePercent) || 0)} color="#2797ff" value={formatBytes(tp.remainingBytes)} unit="GiB 剩余" caption={'剩余 ' + (100 - (Number(tp.usagePercent) || 0)).toFixed(2) + '% · 已用 ' + (tp.usagePercent ?? '—') + '%'} />
            <div className="monitor-details"><span>总量 <b>{formatBytes(tp.totalBytes)} GiB</b></span><span>实例 <b title={tp.instanceId}>{tp.instanceId ? tp.instanceId.replace(/^lhins-/, '') : '—'}</b></span></div>
          </article>

          <article className="monitor-card deepseek">
            <header><div><small>DeepSeek</small><h3>账户余额</h3></div><StatusBadge status={deepseek.status} /></header>
            <Gauge percent={dp.available ? 100 : 0} color="#16b877" value={balance ? balance.totalBalance.toFixed(2) : '—'} unit={balance ? balance.currency : 'CNY'} caption={dp.available ? 'API 可用' : 'API 不可用'} neutral />
            <div className="monitor-details"><span>充值余额 <b>{balance ? balance.toppedUpBalance.toFixed(2) : '—'}</b></span><span>赠送余额 <b>{balance ? balance.grantedBalance.toFixed(2) : '—'}</b></span></div>
          </article>

          <article className="monitor-card glm">
            <header><div><small>GLM Coding Plan</small><h3>5 小时额度</h3></div><StatusBadge status={glm.status} /></header>
            <Gauge percent={100 - (Number(five.percentageUsed) || 0)} color="#7659e8" value={five.remaining ?? '—'} unit="剩余" caption={'剩余 ' + (100 - (Number(five.percentageUsed) || 0)).toFixed(1) + '% · 已用 ' + (five.percentageUsed ?? '—') + '%'} />
            <div className="monitor-details"><span>5 小时总量 <b>{five.total ?? '—'}</b></span><span>周剩余 <b>{weekly.remaining ?? '—'} / {weekly.total ?? '—'}</b></span></div>
          </article>

          <article className="monitor-card codex">
            <header><div><small>OpenAI Codex / GPT</small><h3>{formatWindow(codexWindow.windowDurationMins)}额度</h3></div><StatusBadge status={codex.status} /></header>
            <Gauge percent={codexWindow.remainingPercent} color="#ef8f35" value={codexWindow.remainingPercent == null ? '—' : codexWindow.remainingPercent.toFixed(0) + '%'} unit="剩余额度" caption={'已用 ' + (codexWindow.usedPercent ?? '—') + '%'} />
            <div className="monitor-details"><span>重置时间 <b>{formatReset(codexWindow.resetsAt)}</b></span><span>{codexLongWindow ? '长期剩余' : '额度窗口'} <b>{codexLongWindow ? codexLongWindow.remainingPercent.toFixed(0) + '%' : formatWindow(codexWindow.windowDurationMins)}</b></span></div>
          </article>

          <article className="monitor-card volc-speech wide">
            <header><div><small>豆包语音 SeedASR 2.0</small><h3>语音用量与费用</h3></div><StatusBadge status={volc.status} /></header>
            <div className="volc-overview">
              <div><small>账户余额</small><strong>{formatMoney(vp.availableBalance)}</strong><span>火山引擎可用余额</span></div>
              <div><small>预计可用</small><strong>{vp.remainingHours == null ? '—' : Number(vp.remainingHours).toFixed(1) + ' 小时'}</strong><span>{vp.remainingBasis === 'resource-package' ? '按语音资源包余量' : '按当前余额估算'}</span></div>
            </div>
            <div className="volc-usage-list">
              <div><span>今日语音</span><b>{formatHours(vp.todayHours)}</b><em>估算 {formatMoney(vp.todayEstimatedCost)}</em></div>
              <div><span>本月语音</span><b>{formatHours(vp.monthHours)}</b><em>估算 {formatMoney(vp.monthEstimatedCost)}</em></div>
              <div><span>官方月账单</span><b>{formatMoney(vp.monthlyBilledCost)}</b><em>账单可能延迟生成</em></div>
            </div>
          </article>
        </div>
      )}

      <footer className="monitor-update">最后更新：{formatTime(latestAt)} · 每分钟自动刷新</footer>
    </section>
  )
}
