import React, { useEffect, useRef, useState } from 'react'
import { SOUND_REASON_DISPLAY_MS, subscribeSoundEvents } from '../sounds.js'

// 连续响铃采用“最新事件覆盖并重计时”，避免排队后展示已经过时的原因。
export default function SoundReasonBar() {
  const [message, setMessage] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    const unsubscribe = subscribeSoundEvents(event => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setMessage(event)
      timerRef.current = setTimeout(() => {
        setMessage(null)
        timerRef.current = null
      }, SOUND_REASON_DISPLAY_MS)
    })
    return () => {
      unsubscribe()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (!message) return null
  return <div className="sound-reason-bar" role="status" aria-live="polite" aria-atomic="true">{message.text}</div>
}
