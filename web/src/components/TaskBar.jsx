import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { notifyReplyDone } from '../notify.js'

// 顶部异步任务条：显示正在运行的后台任务（其他私人助手会话等），点击展开查看
export default function TaskBar() {
  const [tasks, setTasks] = useState([]) // 运行中的会话
  const [open, setOpen] = useState(false)
  const inFlight = useRef(false)
  const previousRunning = useRef(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      if (inFlight.current) return
      inFlight.current = true
      try {
        const v = await api.listSessions()
        if (!alive) return
        const items = (v && v.items) || []
        const running = items.filter(s => s.running)
        const currentIds = new Set(running.map(item => item.sessionId))
        if (previousRunning.current) {
          const ended = [...previousRunning.current].filter(([sessionId]) => !currentIds.has(sessionId))
          await Promise.all(ended.map(async ([sessionId, title]) => {
            try {
              const history = await api.history({ sessionId, maxMessages: 40 })
              if (!alive) return
              const lifecycle = [...(history?.events || [])].map(item => item?.event).filter(Boolean).reverse().find(event => ['turn/start', 'turn/end', 'turn/error', 'turn/cancel'].includes(event?.type))
              if (lifecycle?.type === 'turn/end') notifyReplyDone(sessionId, (title || '后台任务') + '已完成', sessionId + ':task-edge', {
                source: title || '后台任务',
                reason: '任务完成'
              })
            } catch (e) { /* 无法确认终态时不误报完成 */ }
          }))
        }
        previousRunning.current = new Map(running.map(item => [item.sessionId, item.projections?.values?.title || '后台任务']))
        setTasks(running)
      } catch (e) { /* 容错：接口失败不打扰 */ }
      finally { inFlight.current = false }
    }
    tick()
    const iv = setInterval(tick, 6000)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  if (!tasks.length) return null // 无任务不占位

  return (
    <div className="taskbar">
      <button className="taskbar-summary" onClick={() => setOpen(o => !o)}>
        ⚙️ <span className="taskbar-count">{tasks.length}</span> 个后台任务运行中
        <span className="taskbar-arrow">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="taskbar-panel">
          {tasks.map(t => (
            <div key={t.sessionId} className="taskbar-item">
              <span className="taskbar-dot" />
              <span className="taskbar-title">{(t.projections && t.projections.values && t.projections.values.title) || '任务'}</span>
              <span className="taskbar-status">运行中…</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
