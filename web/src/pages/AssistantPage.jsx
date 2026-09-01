import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { ASSISTANTS, assistantStorageKey } from '../assistantCatalog.js'
import { findOptimizationRoot, optimizationDescendants } from '../optimizationTasks.js'
import { MOBILE_OPTIMIZER_POLICY } from '../optimizerPrompt.js'
import OptimizerTaskDock from '../components/OptimizerTaskDock.jsx'
import ChatPage from './ChatPage.jsx'

async function resolveSession(assistant) {
  const key = assistantStorageKey(assistant.id)
  let cached = null
  try { cached = localStorage.getItem(key) || (assistant.legacyStorageKey ? localStorage.getItem(assistant.legacyStorageKey) : '') } catch (e) {}
  if (cached) {
    try { localStorage.setItem(key, cached) } catch (e) {}
    return cached
  }

  try {
    const v = await api.listSessions()
    const items = (v && v.items) || []
    const knownTitles = new Set([assistant.title, ...(assistant.legacyTitles || [])])
    const found = items.find(session => knownTitles.has(session.projections?.values?.title) && !session.blank)
    if (found) {
      try { localStorage.setItem(key, found.sessionId) } catch (e) {}
      return found.sessionId
    }
  } catch (e) {}

  try {
    const v = await api.create({ title: assistant.title, agentPreset: assistant.preset, cwd: assistant.cwd })
    if (v?.sessionId) {
      try {
        localStorage.setItem(key, v.sessionId)
        if (assistant.legacyStorageKey) localStorage.setItem(assistant.legacyStorageKey, v.sessionId)
      } catch (e) {}
      try { await api.rename({ sessionId: v.sessionId, title: assistant.title }) } catch (e) {}
      return v.sessionId
    }
  } catch (e) {}
  return null
}

function AssistantHub() {
  const [taskSummary, setTaskSummary] = useState({ total: 0, running: 0 })

  useEffect(() => {
    let alive = true
    api.listSessions().then(value => {
      if (!alive) return
      const sessions = value?.items || []
      const optimizer = ASSISTANTS.find(assistant => assistant.id === 'mobile-optimizer')
      let preferredId = ''
      try { preferredId = localStorage.getItem(assistantStorageKey('mobile-optimizer')) || '' } catch (e) {}
      const root = findOptimizationRoot(sessions, preferredId, [optimizer?.title, ...(optimizer?.legacyTitles || [])])
      const tasks = root ? optimizationDescendants(sessions, root.sessionId) : []
      setTaskSummary({ total: tasks.length, running: tasks.filter(session => session.running).length })
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  return (
    <section className="assistants-page">
      <div className="assistant-grid">
        {ASSISTANTS.filter(assistant => !assistant.hidden).map(assistant => {
          const isOptimizer = assistant.id === 'mobile-optimizer'
          return <a key={assistant.id} href={'#/assistant/' + assistant.id} className="assistant-square" aria-label={assistant.title}>
            <span className="assistant-square-icon">{assistant.icon}</span>
            {isOptimizer && taskSummary.running > 0 && <span className="assistant-running-badge">{taskSummary.running}</span>}
            <strong>{assistant.title}</strong>
            <small>{assistant.description}</small>
            <span className="assistant-square-meta">
              {isOptimizer
                ? (taskSummary.running ? `${taskSummary.running} 个执行中 · 共 ${taskSummary.total} 个任务` : `共 ${taskSummary.total} 个自动任务`)
                : '进入专属对话'}
            </span>
          </a>
        })}
      </div>
    </section>
  )
}

function AssistantChat({ assistant, onTitle }) {
  const [sid, setSid] = useState(undefined)
  const [empty, setEmpty] = useState(true)
  const [running, setRunning] = useState(false)
  const [waitingForUser, setWaitingForUser] = useState(false)
  const isOptimizer = assistant.id === 'mobile-optimizer'

  useEffect(() => {
    let alive = true
    resolveSession(assistant).then(id => { if (alive) setSid(id || null) })
    return () => { alive = false }
  }, [assistant.id])

  if (sid === undefined) return <div className="loading"><span className="spin"></span>打开{assistant.title}…</div>
  if (sid === null) return <div className="placeholder">{assistant.title}打开失败，请稍后重试</div>

  return (
    <div className="assistant-chat-host">
      {isOptimizer && <OptimizerTaskDock rootSessionId={sid} rootRunning={running} waitingForUser={waitingForUser} />}
      {empty && !isOptimizer && (
        <div className="assistant-welcome">
          <div className="aw-title">{assistant.icon} {assistant.title}</div>
          <div className="aw-sub">{isOptimizer
            ? '直接说哪里不舒服。AI 会先理解需求、检查现状并给出确认卡；你同意后才会修改、验证和热更新。'
            : `${assistant.description}。自动派发的执行分支会集中收纳到“会话”页的 AI 任务副列表。`}</div>
          {isOptimizer && <div className="optimizer-flow" aria-label="手机端安全优化流程">
            <span>1 随口反馈</span><b>→</b><span>2 确认方案</span><b>→</b><span>3 修改上线</span>
          </div>}
        </div>
      )}
      <div className="assistant-chat-body">
        <ChatPage sessionId={sid} onTitle={() => onTitle?.(assistant.title)} onHasMessages={(has) => setEmpty(!has)}
          onRunningChange={setRunning} onPendingQuestionChange={setWaitingForUser} optimizerPolicy={isOptimizer ? MOBILE_OPTIMIZER_POLICY : ''} hideTechnicalEvents={isOptimizer} />
      </div>
    </div>
  )
}

export default function AssistantPage({ assistantId, onTitle }) {
  if (!assistantId) return <AssistantHub />
  const assistant = ASSISTANTS.find(item => item.id === assistantId)
  if (!assistant) return <div className="placeholder">没有找到这个助手</div>
  return <AssistantChat assistant={assistant} onTitle={onTitle} />
}
