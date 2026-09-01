import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function WorkspacePage() {
  const [ws, setWs] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => {
    api.listWorkspaces().then(v => setWs(v?.items || [])).catch(e => setErr(e.message))
  }, [])
  if (err) return <div className="placeholder">加载工作区失败：{err}</div>
  return (
    <div>
      {ws.map(w => (
        <div key={w.workspaceId || w.id || JSON.stringify(w)} className="card">
          <div className="title">{w.name || w.workspaceId || '工作区'}</div>
          {w.cwd && <div className="sub">{w.cwd}</div>}
        </div>
      ))}
      {!ws.length && <div className="placeholder">暂无工作区信息</div>}
    </div>
  )
}