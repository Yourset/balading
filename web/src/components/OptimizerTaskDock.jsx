import React, { useState } from 'react'
import { useOptimizationTaskCards } from '../useOptimizationTaskCards.js'

const taskRoute = task => '#/task/' + encodeURIComponent(task.parentSessionId) + '/' + encodeURIComponent(task.sessionId) + '/' + encodeURIComponent(task.mode || 'one-shot') + '/from-optimizer'
const statusLabel = status => status === 'running' ? '进行中' : status === 'failed' ? '遇到问题' : status === 'stopped' ? '已停止' : '有结果'

/**
 * 优化总管顶部任务板：只展示用户能理解的任务、状态和结果入口。
 * 工具调用、参数与执行日志继续留在后台，不进入这个视图。
 */
export default function OptimizerTaskDock({ rootSessionId, rootRunning = false, waitingForUser = false }) {
  const [expanded, setExpanded] = useState(false)
  const { cards, loading, error } = useOptimizationTaskCards({ rootSessionId, category: '优化任务' })
  const runningCount = cards.filter(card => card.status === 'running').length
  const resultCount = cards.filter(card => card.status !== 'running').length
  const summary = waitingForUser
    ? '有一件事等你确认'
    : rootRunning
      ? '正在理解或安排你的需求'
      : runningCount
        ? `${runningCount} 件进行中${resultCount ? ` · ${resultCount} 件已有结果` : ''}`
        : resultCount
          ? `${resultCount} 件已有结果`
          : loading ? '正在读取任务进度' : '可以直接说你的新想法'

  return <section className={'optimizer-task-dock' + (expanded ? ' expanded' : '')} aria-label="优化总管任务进度">
    <button className="optimizer-task-summary" type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
      <span className={'optimizer-task-orb' + ((rootRunning || runningCount) ? ' running' : '') + (waitingForUser ? ' waiting' : '')}>✦</span>
      <span><strong>优化总管</strong><small>{error || summary}</small></span>
      <b>{expanded ? '收起' : (cards.length ? `查看 ${cards.length}` : '查看')}</b>
    </button>
    {expanded && <div className="optimizer-task-list">
      {(rootRunning || waitingForUser) && <div className={'optimizer-root-task ' + (waitingForUser ? 'waiting' : 'running')}><i /><span><strong>当前对话</strong><small>{waitingForUser ? '方案已整理，等你确认后继续' : '正在理解需求、安排下一步'}</small></span><b>{waitingForUser ? '待确认' : '进行中'}</b></div>}
      {!cards.length && !rootRunning && !waitingForUser && <div className="optimizer-task-empty">还没有执行任务。直接在下方聊天，我来整理和推进。</div>}
      {cards.map(task => <a href={taskRoute(task)} className={'optimizer-dock-card ' + task.status} key={task.sessionId}>
        <i /><span><strong>{task.description}</strong><small>{task.status === 'running' ? '正在推进，稍后会有结果' : '已形成结果，点开查看'}</small></span><b>{statusLabel(task.status)}</b>
      </a>)}
    </div>}
  </section>
}
