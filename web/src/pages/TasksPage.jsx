import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function TasksPage() {
  const [runningSessions, setRunningSessions] = useState([])
  useEffect(() => {
    api.listSessions().then(v => setRunningSessions((v?.items || []).filter(s => s.running))).catch(() => {})
  }, [])
  return (
    <div>
      <div className="card"><div className="title" style={{ marginBottom: 4 }}>运行中的会话</div>
        <div className="sub">{runningSessions.length ? runningSessions.length + ' 个进行中' : '暂无进行中会话'}</div>
      </div>
      {runningSessions.map(s => (
        <a key={s.sessionId} href={'#/chat/' + s.sessionId} style={{ color: 'inherit' }}>
          <div className="card active">
            <div className="row"><div className="grow"><div className="title">{s.projections?.values?.title || '会话'}</div><div className="sub">{s.cwd || ''}</div></div>
              <span className="dot running"></span></div>
          </div>
        </a>
      ))}
      <div className="placeholder">任务页（Goal / Subagent / Jobs）规划中，MVP 先展示会话运行状态</div>
    </div>
  )
}