import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import {
  DEFAULT_IMAGE_NAME, anchorDownload, canShareFiles, dataUrlToBlob,
  extFromMime, fetchBlob, fileNameFromUrl
} from '../imageDownload.js'

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = () => rej(new Error('图片加载失败'))
    i.src = src
  })
}

// 原图 base64 → 缩略图 dataURL（宽度≤700px，质量阶梯保证 ≤100KB）
async function thumbOf(data, mediaType) {
  const src = 'data:' + (mediaType || 'image/jpeg') + ';base64,' + data
  const img = await loadImage(src)
  const w0 = img.naturalWidth || 700
  const h0 = img.naturalHeight || 700
  const scale = Math.min(1, 700 / Math.max(w0, h0))
  const w = Math.max(1, Math.round(w0 * scale))
  const h = Math.max(1, Math.round(h0 * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  let q = 0.72
  let out = canvas.toDataURL('image/jpeg', q)
  while (out.length > 140000 && q > 0.3) { q -= 0.1; out = canvas.toDataURL('image/jpeg', q) }
  return out
}

// 微信式全屏看图：点空白关闭、双指缩放、双击缩放、放大后单指拖动并限制边界。
export function PhotoViewer({ src, onClose }) {
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [gyro, setGyro] = useState(false)
  const [orient, setOrient] = useState({ x: 0, y: 0 })
  const [interacting, setInteracting] = useState(false)
  const [dlBusy, setDlBusy] = useState(false)
  const [dlMsg, setDlMsg] = useState('')
  const stageRef = useRef(null)
  const imageRef = useRef(null)
  const gesture = useRef(null)
  const movedRef = useRef(false)
  const lastTapRef = useRef(0)

  const clampPosition = (x, y, nextScale) => {
    const stage = stageRef.current
    const image = imageRef.current
    if (!stage || !image || nextScale <= 1) return { x: 0, y: 0 }
    const maxX = Math.max(0, (image.clientWidth * nextScale - stage.clientWidth) / 2)
    const maxY = Math.max(0, (image.clientHeight * nextScale - stage.clientHeight) / 2)
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y))
    }
  }

  const setView = (nextScale, x, y) => {
    const safeScale = Math.max(1, Math.min(6, nextScale))
    const next = clampPosition(x, y, safeScale)
    setScale(safeScale); setTx(next.x); setTy(next.y)
  }

  const toggleZoom = () => {
    if (scale > 1.05) setView(1, 0, 0)
    else setView(2.4, 0, 0)
  }

  // 下载当前图片：优先系统分享（可存相册/下载/转发），不支持则锚点下载，最后兜底浏览器打开。
  const downloadImage = async () => {
    if (dlBusy) return
    setDlBusy(true); setDlMsg('')
    try {
      let blob
      let mime = 'image/png'
      let fileName = ''
      if (src.startsWith('data:')) {
        const d = dataUrlToBlob(src)
        blob = d.blob; mime = d.mime
        fileName = DEFAULT_IMAGE_NAME + '_' + Date.now() + '.' + extFromMime(mime)
      } else {
        blob = await fetchBlob(src)
        mime = blob.type || mime
        fileName = fileNameFromUrl(src, mime)
      }
      const file = new File([blob], fileName, { type: mime })
      if (canShareFiles() && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName })
        setDlMsg('已调起分享/保存')
        return
      }
      const url = anchorDownload(blob, fileName)
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      setDlMsg('已开始下载')
    } catch (e) {
      if (!src.startsWith('data:')) {
        try { window.open(src, '_blank'); setDlMsg('已用浏览器打开，长按可保存') }
        catch (_) { setDlMsg('下载失败') }
      } else setDlMsg(e.message || '下载失败')
    } finally { setDlBusy(false) }
  }

  const onTouchStart = (e) => {
    const touches = e.touches
    setInteracting(true)
    movedRef.current = false
    if (touches.length === 1) {
      gesture.current = { mode: 'pan', x: touches[0].clientX, y: touches[0].clientY, sx: tx, sy: ty }
      return
    }
    if (touches.length === 2) {
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect) return
      const cx = (touches[0].clientX + touches[1].clientX) / 2
      const cy = (touches[0].clientY + touches[1].clientY) / 2
      const px = cx - (rect.left + rect.width / 2)
      const py = cy - (rect.top + rect.height / 2)
      const distance = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
      gesture.current = {
        mode: 'pinch', d0: distance, s0: scale,
        qx: (px - tx) / scale, qy: (py - ty) / scale
      }
      movedRef.current = true
    }
  }

  const onTouchMove = (e) => {
    const current = gesture.current
    if (!current) return
    const touches = e.touches
    if (current.mode === 'pan' && touches.length === 1) {
      const dx = touches[0].clientX - current.x
      const dy = touches[0].clientY - current.y
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) movedRef.current = true
      if (scale > 1) setView(scale, current.sx + dx, current.sy + dy)
    } else if (current.mode === 'pinch' && touches.length >= 2) {
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect) return
      const distance = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
      const nextScale = Math.max(1, Math.min(6, current.s0 * (distance / current.d0)))
      const cx = (touches[0].clientX + touches[1].clientX) / 2
      const cy = (touches[0].clientY + touches[1].clientY) / 2
      const px = cx - (rect.left + rect.width / 2)
      const py = cy - (rect.top + rect.height / 2)
      setView(nextScale, px - current.qx * nextScale, py - current.qy * nextScale)
    }
    if (e.cancelable) e.preventDefault()
  }

  const onTouchEnd = (e) => {
    const current = gesture.current
    if (e.touches.length === 1) {
      const touch = e.touches[0]
      gesture.current = { mode: 'pan', x: touch.clientX, y: touch.clientY, sx: tx, sy: ty }
      movedRef.current = true
      return
    }
    gesture.current = null
    setInteracting(false)
    setView(scale, tx, ty)
    if (current?.mode === 'pan' && !movedRef.current) {
      const now = Date.now()
      if (now - lastTapRef.current < 300) {
        lastTapRef.current = 0
        toggleZoom()
      } else lastTapRef.current = now
    }
  }

  // 保留原有陀螺仪能力；不影响普通缩放和拖拽。
  useEffect(() => {
    if (!gyro) { setOrient({ x: 0, y: 0 }); return }
    let handler = null
    const start = async () => {
      try {
        const state = (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission)
          ? await DeviceOrientationEvent.requestPermission()
          : 'granted'
        if (state !== 'granted') { setGyro(false); return }
        handler = (e) => {
          if (!e || e.beta == null || e.gamma == null) return
          setOrient({
            x: Math.max(-40, Math.min(40, (e.beta - 45) * 0.9)),
            y: Math.max(-40, Math.min(40, e.gamma * 0.9))
          })
        }
        window.addEventListener('deviceorientation', handler)
      } catch (e) { setGyro(false) }
    }
    start()
    return () => { if (handler) window.removeEventListener('deviceorientation', handler) }
  }, [gyro])

  const style = gyro
    ? { transform: `translate3d(${tx}px, ${ty}px, 0) perspective(900px) rotateX(${orient.x}deg) rotateY(${orient.y}deg) scale(${scale})` }
    : { transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})` }

  return (
    <div className="img-fullscreen">
      <div className="img-full-top">
        <button className={'img-full-btn' + (dlBusy ? ' on' : '')}
          onClick={(e) => { e.stopPropagation(); downloadImage() }}>{dlBusy ? '处理中…' : '⬇ 下载'}</button>
        <button className={'img-full-btn' + (gyro ? ' on' : '')}
          onClick={(e) => { e.stopPropagation(); setGyro(value => !value) }}>🔄 陀螺仪</button>
        <button className="img-full-close" onClick={(e) => { e.stopPropagation(); onClose() }}>✕</button>
      </div>
      <div ref={stageRef} className="img-full-stage"
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onClick={(e) => { if (e.target === e.currentTarget && !movedRef.current) onClose(); movedRef.current = false }}>
        <img ref={imageRef}
          src={src}
          alt="原图" className={'img-full-zoom' + (interacting ? ' interacting' : '')} style={style}
          onClick={(e) => e.stopPropagation()} draggable={false} />
      </div>
      <div className="img-full-hint">{dlMsg || '双指缩放 · 放大后拖动 · 点空白处关闭'}</div>
    </div>
  )
}

// 会话消息里的图片：缩略图展示；原图随缩略图一起缓存，点击无需再次请求。
export default function ImageView({ sessionId, attachment }) {
  const [thumb, setThumb] = useState(null)
  const [full, setFull] = useState(false)
  const [fullData, setFullData] = useState(null)
  const [err, setErr] = useState('')
  const loading = useRef(false)

  useEffect(() => {
    if (loading.current) return
    loading.current = true
    setErr('')
    api.attachment({ sessionId, attachmentId: attachment.attachmentId })
      .then((value) => {
        if (!value || !value.data) { setErr('图片不可用'); return null }
        setFullData(value.data)
        return thumbOf(value.data, attachment.mediaType).then(setThumb)
      })
      .catch((e) => setErr(e.message || '加载失败'))
  }, [sessionId, attachment && attachment.attachmentId])

  const openFull = async () => {
    if (fullData) { setFull(true); return }
    try {
      const value = await api.attachment({ sessionId, attachmentId: attachment.attachmentId })
      if (!value?.data) { setErr('图片不可用'); return }
      setFullData(value.data)
      setFull(true)
    } catch (e) { setErr(e.message || '加载失败') }
  }

  return (
    <>
      <div className="msg-image">
        {thumb
          ? <img src={thumb} alt={attachment.name || '图片'} className="msg-img-thumb" onClick={openFull} />
          : err
            ? <span className="msg-img-err">{err}</span>
            : <span className="msg-img-loading">🖼 加载中…</span>}
      </div>
      {full && fullData && <PhotoViewer src={'data:' + (attachment.mediaType || 'image/jpeg') + ';base64,' + fullData} onClose={() => setFull(false)} />}
    </>
  )
}
