import React from 'react'
import { ASSISTANTS, assistantStorageKey } from '../assistantCatalog.js'
import { useOptimizationTaskCards } from '../useOptimizationTaskCards.js'

const OPTIMIZER = ASSISTANTS.find(item => item.id === 'mobile-optimizer') || { id: 'mobile-optimizer', title: '优化总管', legacyTitles: ['手机端优化助手'], taskCategory: '手机优化' }
const taskRoute = task => '#/task/' + encodeURIComponent(task.parentSessionId) + '/' + encodeURIComponent(task.sessionId) + '/' + encodeURIComponent(task.mode || 'one-shot') + '/from-optimize'
const taskStatusLabel = status => status === 'running' ? '运行中' : status === 'failed' ? '失败' : status === 'stopped' ? '已停止' : '已完成'
const taskStatusSummary = task => {
  if (task.status === 'running') return task.mode === 'continuable' ? '正在处理 · 可继续原任务' : '正在处理 · 只读分支'
  if (task.status === 'failed') return task.mode === 'continuable' ? '执行失败 · 可继续处理' : '执行失败 · 查看结果'
  if (task.status === 'stopped') return task.mode === 'continuable' ? '任务已停止 · 可继续处理' : '任务已停止 · 查看结果'
  return task.mode === 'continuable' ? '最近成功 · 可继续优化' : '最近成功 · 只读结果'
}

export default function OptimizationPage() {
  let preferredRootId = ''
  try { preferredRootId = localStorage.getItem(assistantStorageKey(OPTIMIZER.id)) || '' } catch (e) {}
  const { cards, loading, error } = useOptimizationTaskCards({
    preferredRootId,
    rootTitles: [OPTIMIZER.title, ...(OPTIMIZER.legacyTitles || [])],
    category: OPTIMIZER.taskCategory
  })

  return <section className="optimization-page">
    <a className="optimization-feedback-link" href="#/assistant/mobile-optimizer?from=optimize">
      <span>📱</span>
      <strong>反馈 Bug / 优化建议</strong>
      <small>直接描述哪里不好用，确认后再修改</small>
      <b>›</b>
    </a>

    <section className="optimization-tasks" aria-labelledby="optimization-center-title">
      <header className="monitor-section-head">
        <div><small>优化总管</small><h2 id="optimization-center-title">当前优化任务</h2></div>
        <span>每 6 秒刷新</span>
      </header>
      {error ? <div className="optimization-state error">⚠ {error}</div>
        : loading ? <div className="optimization-state"><span className="spin" />正在读取优化任务</div>
          : !cards.length ? <div className="optimization-state empty">暂无近期优化任务</div>
            : <div className="optimization-task-grid">
                {cards.map(task => <a className={'optimization-task-card ' + task.status} href={taskRoute(task)} key={task.sessionId}>
                  <span className="optimization-task-meta"><i />{task.category}<b>{taskStatusLabel(task.status)}</b></span>
                  <strong>{task.description}</strong>
                  <small>{taskStatusSummary(task)}<b>›</b></small>
                </a>)}
              </div>}
    </section>
  </section>
}
