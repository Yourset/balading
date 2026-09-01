import React, { useEffect, useRef, useState } from 'react'

// 受保护简历页：从网关 /resume 拉取（网关侧 verifyJwt 校验 dsh_device Cookie），
// 未绑定设备会 401；前端仅负责把返回的 HTML 渲染到 iframe，不缓存、不落地。
export default function ResumePage() {
  const [status, setStatus] = useState('loading') // loading | ok | error
  const [errorMsg, setErrorMsg] = useState('')
  const iframeRef = useRef(null)

  useEffect(() => {
    let alive = true
    fetch('/resume', { method: 'GET', credentials: 'include' })
      .then(async res => {
        if (res.status === 401) {
          if (alive) { setStatus('error'); setErrorMsg('未绑定设备，无法查看简历') }
          return
        }
        if (!res.ok) {
          if (alive) { setStatus('error'); setErrorMsg('简历加载失败 (' + res.status + ')') }
          return
        }
        const text = await res.text()
        if (alive && iframeRef.current) {
          const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow.document
          doc.open(); doc.write(text); doc.close()
          setStatus('ok')
        }
      })
      .catch(() => { if (alive) { setStatus('error'); setErrorMsg('网络异常，无法加载简历') } })
    return () => { alive = false }
  }, [])

  if (status === 'error') {
    return <div className="placeholder" style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
      <div>{errorMsg}</div>
    </div>
  }

  return <iframe
    ref={iframeRef}
    title="简历"
    style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
  />
}
