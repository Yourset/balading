import React, { useEffect, useRef, useState } from 'react'
import ModelPicker from './ModelPicker.jsx'
import { clearDraft, readDraft, saveDraft } from '../drafts.js'
import { getComposerInputMode, getVoiceSendMode, setComposerInputMode } from '../preferences.js'
import { useVoiceRecorder } from '../voice.js'
import { formatFileBytes, formatFileDate } from '../imageMetadata.js'
import { prepareImageAttachment } from '../imageCompression.js'

function attachmentMetadataText(images) {
  const lines = ['附件图片信息（由手机端直接读取；超限图片会自动压缩）：']
  images.forEach((image, index) => {
    if (image.compressed) {
      lines.push(`${index + 1}. ${image.originalName}｜已自动压缩`)
      lines.push(`   原图：${image.originalMediaType}｜${formatFileBytes(image.originalSize)}｜${image.originalWidth}×${image.originalHeight}`)
      lines.push(`   发送：${image.mediaType}｜${formatFileBytes(image.size)}｜${image.width}×${image.height}`)
    } else {
      lines.push(`${index + 1}. ${image.name}｜原图发送｜${image.mediaType}｜${formatFileBytes(image.size)}｜${image.width}×${image.height}`)
    }
    lines.push(`   EXIF 拍摄时间：${image.capturedAt || '未发现'}${image.capturedAt ? '（未含时区）' : ''}`)
    lines.push(`   文件修改时间：${formatFileDate(image.lastModified)}（不等同于拍摄时间）`)
  })
  lines.push('隐私说明：未读取或发送 GPS 定位信息；压缩副本不携带 EXIF。')
  return lines.join('\n')
}

function buildMessageContent(images, text) {
  const content = []
  for (const image of images) content.push({ type: 'image', mediaType: image.mediaType, data: image.data, name: image.name })
  if (images.length) content.push({ type: 'text', text: attachmentMetadataText(images), clientHidden: true })
  if (String(text || '').trim()) content.push({ type: 'text', text: String(text).trim() })
  return content
}

function appendRecognizedText(current, recognized) {
  const base = String(current || '').trimEnd()
  return base ? base + '\n' + recognized : recognized
}

function formatVoiceElapsed(totalSeconds) {
  const safe = Math.max(0, Number(totalSeconds) || 0)
  const minutes = Math.floor(safe / 60)
  const seconds = Math.floor(safe % 60)
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0')
}

export default function Composer({ onSend, busy, sessionId }) {
  const [text, setText] = useState(() => readDraft(sessionId))
  const [images, setImages] = useState([]) // 图片草稿（选图后先预览，不立即发送）
  const [picking, setPicking] = useState(false)
  const [sending, setSending] = useState(false)
  const [inputMode, setInputMode] = useState(getComposerInputMode)
  const [moreOpen, setMoreOpen] = useState(false)
  const [cancelArmed, setCancelArmed] = useState(false)
  const [continueArmed, setContinueArmed] = useState(false)
  const [handsFreeVoice, setHandsFreeVoice] = useState(false)
  const [holding, setHolding] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const taRef = useRef(null)
  const fileRef = useRef(null)
  const cancelZoneRef = useRef(null)
  const continueZoneRef = useRef(null)
  const pointerRef = useRef(null)
  const holdingRef = useRef(false)
  const cancelArmedRef = useRef(false)
  const continueArmedRef = useRef(false)
  const handsFreeVoiceRef = useRef(false)
  const voiceDraftRef = useRef(false)
  const sendingRef = useRef(false)

  const handleVoiceFinal = async (recognized) => {
    if (getVoiceSendMode() === 'auto') {
      // 自动语音发送与手动发送共用同一把锁；成功后只清掉本次快照中的图片。
      if (sendingRef.current) {
        voiceDraftRef.current = true
        setText(prev => appendRecognizedText(prev, recognized))
        setInputMode('text'); setComposerInputMode('text')
        setVoiceError('当前消息仍在发送，识别文字已放回输入框')
        return
      }
      const sentImages = images
      sendingRef.current = true
      setSending(true)
      try {
        const ok = await Promise.resolve(onSend(buildMessageContent(sentImages, recognized), { kind: 'voice' }))
        if (ok !== false) {
          setImages(current => current.filter(image => !sentImages.includes(image)))
        } else {
          voiceDraftRef.current = true
          setText(prev => appendRecognizedText(prev, recognized))
          setInputMode('text'); setComposerInputMode('text')
          setVoiceError('自动发送失败，识别文字已放回输入框')
        }
      } finally {
        sendingRef.current = false
        setSending(false)
      }
    } else {
      voiceDraftRef.current = true
      setText(prev => appendRecognizedText(prev, recognized))
      setInputMode('text'); setComposerInputMode('text')
      requestAnimationFrame(() => taRef.current?.focus())
    }
  }

  const voice = useVoiceRecorder({
    onFinal: handleVoiceFinal,
    onError: (message) => {
      // 可恢复失败时，局部识别结果留在语音恢复区；不覆盖或重复拼接现有文字草稿。
      setVoiceError(message)
    }
  })
  const voiceActive = ['connecting', 'recording'].includes(voice.state)
  useEffect(() => {
    // connecting 阶段允许先右滑进入 hands-free；直到真正离开录音链路才清理。
    if (['connecting', 'recording'].includes(voice.state)) return
    handsFreeVoiceRef.current = false
    setHandsFreeVoice(false)
  }, [voice.state])
  // 语音横条本身负责“按住说话/松开处理”，右侧发送按钮只属于键盘输入模式。
  const hideSendButton = inputMode === 'voice'

  useEffect(() => { setText(readDraft(sessionId)); voiceDraftRef.current = false }, [sessionId])
  useEffect(() => { saveDraft(sessionId, text) }, [sessionId, text])

  // 输入框随内容增高；上限按实际字体行高计算为 3.5 行，超过后只滚动输入框内部。
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    const style = window.getComputedStyle(el)
    const lineHeight = Number.parseFloat(style.lineHeight) || 22.4
    const chrome = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
      + (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0)
    const maxHeight = lineHeight * 3.5 + chrome
    const nextHeight = Math.min(el.scrollHeight, maxHeight)
    el.style.height = Math.max(44, nextHeight) + 'px'
    el.style.overflowY = el.scrollHeight > maxHeight + 1 ? 'auto' : 'hidden'
  }, [text, inputMode])

  const send = async () => {
    const t = text.trim()
    // ref 在 React 状态刷新前同步上锁，封住连续点击同一帧内的重复提交。
    if ((!t && !images.length) || busy || picking || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    try {
      const content = buildMessageContent(images, t)
      const kind = voiceDraftRef.current ? 'voice' : 'text'
      const ok = await Promise.resolve(onSend(content, { kind }))
      if (ok === false) return
      clearDraft(sessionId)
      voiceDraftRef.current = false
      setText(''); setImages([])
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    setMoreOpen(false)
    if (!files.length) return
    setPicking(true)
    try {
      for (const file of files) {
        try {
          const image = await prepareImageAttachment(file)
          setImages(prev => [...prev, image])
        } catch (err) { alert('图片处理失败：' + (err.message || err)) }
      }
    } finally { setPicking(false) }
    e.target.value = ''
  }

  const removeImage = (idx) => setImages(prev => prev.filter((_, i) => i !== idx))
  const toggleInputMode = () => {
    if (voiceActive || voice.state === 'recognizing') return
    const next = inputMode === 'voice' ? 'text' : 'voice'
    setInputMode(next); setComposerInputMode(next); setMoreOpen(false); setVoiceError('')
    if (next === 'text') requestAnimationFrame(() => taRef.current?.focus())
  }
  const beginVoiceGesture = (gestureId) => {
    if (handsFreeVoiceRef.current && ['connecting', 'recording'].includes(voice.state)) {
      handsFreeVoiceRef.current = false
      setHandsFreeVoice(false)
      voice.finish()
      return false
    }
    if (busy || sendingRef.current || voice.state === 'recognizing' || voice.hasRetainedAudio || holdingRef.current) return false
    pointerRef.current = gestureId
    holdingRef.current = true
    setHolding(true)
    cancelArmedRef.current = false
    continueArmedRef.current = false
    setCancelArmed(false); setContinueArmed(false); setVoiceError(''); setMoreOpen(false)
    voice.start()
    return true
  }
  const moveVoiceGesture = (gestureId, clientX, clientY) => {
    if (pointerRef.current !== gestureId || !holdingRef.current) return
    const cancelRect = cancelZoneRef.current?.getBoundingClientRect()
    const continueRect = continueZoneRef.current?.getBoundingClientRect()
    const insideCancel = !!cancelRect && clientX >= cancelRect.left && clientX <= cancelRect.right && clientY >= cancelRect.top && clientY <= cancelRect.bottom
    const insideContinue = !voice.extended && !!continueRect && clientX >= continueRect.left && clientX <= continueRect.right && clientY >= continueRect.top && clientY <= continueRect.bottom
    cancelArmedRef.current = insideCancel
    continueArmedRef.current = insideContinue
    setCancelArmed(insideCancel)
    setContinueArmed(insideContinue)
  }
  const finishVoiceGesture = (gestureId) => {
    if (pointerRef.current !== gestureId) return
    const shouldCancel = cancelArmedRef.current
    const shouldContinue = continueArmedRef.current
    pointerRef.current = null
    holdingRef.current = false
    setHolding(false)
    if (shouldCancel) {
      voice.cancel()
    } else if (shouldContinue && voice.extend()) {
      handsFreeVoiceRef.current = true
      setHandsFreeVoice(true)
    } else {
      voice.finish()
    }
    cancelArmedRef.current = false
    continueArmedRef.current = false
    setCancelArmed(false)
    setContinueArmed(false)
  }
  // Android WebView 单独走 touch 事件，避免合成 pointercancel 把长按手势提前截断。
  const onVoiceTouchStart = (event) => {
    const touch = event.changedTouches?.[0]
    if (!touch) return
    event.preventDefault()
    beginVoiceGesture('touch:' + touch.identifier)
  }
  const onVoiceTouchMove = (event) => {
    const id = pointerRef.current
    if (!String(id || '').startsWith('touch:')) return
    const touchId = Number(String(id).slice(6))
    const touch = Array.from(event.changedTouches || []).find(item => item.identifier === touchId) || Array.from(event.touches || []).find(item => item.identifier === touchId)
    if (touch) { event.preventDefault(); moveVoiceGesture(id, touch.clientX, touch.clientY) }
  }
  const onVoiceTouchEnd = (event) => {
    const id = pointerRef.current
    if (!String(id || '').startsWith('touch:')) return
    const touchId = Number(String(id).slice(6))
    if (Array.from(event.changedTouches || []).some(item => item.identifier === touchId)) { event.preventDefault(); finishVoiceGesture(id) }
  }
  const onVoicePointerDown = (event) => {
    if (event.pointerType === 'touch') return
    event.preventDefault()
    if (beginVoiceGesture('pointer:' + event.pointerId)) try { event.currentTarget.setPointerCapture(event.pointerId) } catch (e) {}
  }
  const onVoicePointerMove = (event) => { if (event.pointerType !== 'touch') moveVoiceGesture('pointer:' + event.pointerId, event.clientX, event.clientY) }
  const onVoicePointerEnd = (event) => {
    if (event.pointerType === 'touch') return
    try { event.currentTarget?.releasePointerCapture?.(event.pointerId) } catch (e) {}
    finishVoiceGesture('pointer:' + event.pointerId)
  }
  const voiceElapsed = formatVoiceElapsed(voice.elapsedSec)
  const voiceLabel = voice.state === 'recognizing' ? '正在识别…'
    : voice.hasRetainedAudio ? '录音已保留'
      : voice.state === 'connecting' ? '00:00 · 正在连接'
        : voice.state === 'recording'
          ? (cancelArmed ? `${voiceElapsed} · 松开取消`
            : continueArmed ? `${voiceElapsed} · 松开后继续说话`
              : handsFreeVoice ? (voice.warning ? `${voiceElapsed} · 还剩 ${voice.remainingSec} 秒 · 点击结束` : `${voiceElapsed} · 继续说话中 · 点击结束`)
                : voice.warning ? `${voiceElapsed} · 还剩 ${voice.remainingSec} 秒${voice.canExtend ? ' · 上滑可继续' : ''}` : `${voiceElapsed} · 松开发送`)
          : '按住说话'

  return (
    <div className="composer">
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: 'none' }} onChange={onFiles} multiple />
      {(holding || voiceActive) && !handsFreeVoice && <div className="voice-gesture-zones">
        <div ref={cancelZoneRef} className={'voice-gesture-zone cancel' + (cancelArmed ? ' armed' : '')}>
          <span>✕</span><strong>{cancelArmed ? '松开取消' : '上滑取消'}</strong>
        </div>
        {!voice.extended && <div ref={continueZoneRef} className={'voice-gesture-zone continue' + (continueArmed ? ' armed' : '')}>
          <span>↥</span><strong>{continueArmed ? '松开继续说话' : '上滑继续说话'}</strong>
        </div>}
      </div>}
      {images.length > 0 && (
        <div className="img-preview">
          {images.map((image, index) => (
            <div key={`${image.name}-${image.size}-${image.lastModified}-${index}`} className="img-preview-item">
              <img src={'data:' + image.mediaType + ';base64,' + image.data} alt={image.name || '待发送图片'} />
              <div className="img-preview-meta">
                <strong>{image.originalName || image.name}</strong>
                {image.compressed
                  ? <span>已压缩：{formatFileBytes(image.originalSize)} / {image.originalWidth}×{image.originalHeight} → {formatFileBytes(image.size)} / {image.width}×{image.height}</span>
                  : <span>原图：{formatFileBytes(image.size)} · {image.width}×{image.height}</span>}
                <span>{image.capturedAt ? `拍摄 ${image.capturedAt}` : '未发现 EXIF 拍摄时间'}</span>
              </div>
              <button className="img-preview-del" onClick={() => removeImage(index)} aria-label="移除图片">✕</button>
            </div>
          ))}
          <span className="img-preview-hint">合规图发原图，超限图自动压缩；GPS 不读取</span>
        </div>
      )}
      {sessionId && <ModelPicker sessionId={sessionId} />}
      {voice.networkInterrupted && <div className="voice-network-local">网络已断开，仍在本地录音；松手后可重新识别</div>}
      {voice.hasRetainedAudio ? (
        <div className="voice-recovery" role="status">
          <div>
            <strong>录音已保留</strong>
            <span>{voiceError || `本地录音约 ${voice.retainedDurationSec} 秒，可直接重新识别`}</span>
          </div>
          <button type="button" className="retry" disabled={voice.state === 'recognizing'}
            onClick={() => { setVoiceError(''); voice.retry() }}>
            {voice.state === 'recognizing' ? '识别中…' : '重新识别'}
          </button>
          <button type="button" className="discard"
            onClick={() => { setVoiceError(''); voice.cancel() }}>删除录音</button>
        </div>
      ) : voiceError && <div className="voice-error">{voiceError}</div>}
      {voice.partial && <div className="voice-partial">{voice.partial}</div>}
      <div className="composer-row">
        <button className={'composer-icon more-toggle' + (moreOpen ? ' active' : '')} onClick={() => setMoreOpen(value => !value)}
          aria-label="更多功能" aria-expanded={moreOpen}>＋</button>
        <button className="composer-icon voice-toggle" onClick={toggleInputMode}
          aria-label={inputMode === 'voice' ? '切换到键盘输入' : '切换到语音输入'}>
          {inputMode === 'voice' ? '⌨' : '🎙'}
        </button>
        {inputMode === 'voice' ? (
          <button className={'hold-to-talk' + ((holding || voiceActive) ? ' active' : '') + (cancelArmed ? ' cancel' : '') + (continueArmed || handsFreeVoice ? ' continue' : '')}
            disabled={busy || voice.state === 'recognizing' || voice.hasRetainedAudio} onContextMenu={event => event.preventDefault()}
            onTouchStart={onVoiceTouchStart} onTouchMove={onVoiceTouchMove} onTouchEnd={onVoiceTouchEnd} onTouchCancel={onVoiceTouchEnd}
            onPointerDown={onVoicePointerDown} onPointerMove={onVoicePointerMove} onPointerUp={onVoicePointerEnd} onPointerCancel={onVoicePointerEnd}>
            {voiceLabel}
          </button>
        ) : (
          <textarea ref={taRef} value={text} placeholder={images.length ? '输入图片说明…' : '继续输入…'} rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }} />
        )}
        {!hideSendButton && <button className="send" onClick={send} disabled={busy || picking || sending || (!text.trim() && !images.length)} aria-label="发送">{sending ? '…' : '↑'}</button>}
      </div>
      {moreOpen && <div className="composer-more-panel">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={picking}>
          <span className="composer-more-icon">🖼️</span><small>{picking ? '处理中…' : '选择图片'}</small>
        </button>
      </div>}
    </div>
  )
}
