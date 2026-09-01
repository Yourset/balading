import React from 'react'

export default function MePage({ deviceId, onUnbind }) {
  return (
    <div>
      <div className="card">
        <div className="title" style={{ marginBottom: 8 }}>账号与安全</div>
        <div className="sub">当前设备：{deviceId ? deviceId.slice(0, 8) + '…' : '-'} ✓ 已绑定</div>
        <button className="btn danger" style={{ marginTop: 12 }} onClick={async () => { if (confirm('确定解绑此设备？')) onUnbind() }}>解绑此设备</button>
      </div>
      <div className="card">
        <div className="title" style={{ marginBottom: 4 }}>说明</div>
        <div className="sub">本设备通过一次性令牌绑定；敏感操作将逐步接入 PIN / 生物识别二次确认。</div>
      </div>
      <div className="placeholder">模型切换、凭证管理规划中</div>
    </div>
  )
}