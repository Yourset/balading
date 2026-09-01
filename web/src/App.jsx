import React, { useEffect, useRef, useState } from 'react'
import { authMe, authUnbind, getServerUrl, setServerUrl, clearServerUrl, notificationRead, notificationSnapshot } from './api.js'
import ServerBindPage from './pages/ServerBindPage.jsx'
import BindPage from './pages/BindPage.jsx'
import SetupPassword from './pages/SetupPassword.jsx'
import LockPage from './pages/LockPage.jsx'
import ChatsPage from './pages/ChatsPage.jsx'
import ChatPage from './pages/ChatPage.jsx'
import AssistantPage from './pages/AssistantPage.jsx'
import PaintPage from './pages/PaintPage.jsx'
import ToolsPage from './pages/ToolsPage.jsx'
import ResumePage from './pages/ResumePage.jsx'
import NotesPage from './pages/NotesPage.jsx'
import MonitorPage from './pages/MonitorPage.jsx'
import OptimizationPage from './pages/OptimizationPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import ConnectionStatus from './components/ConnectionStatus.jsx'
import TaskBar from './components/TaskBar.jsx'
import SoundReasonBar from './components/SoundReasonBar.jsx'
import { configureNativeNotifications, consumeNativeNotificationOpen, dismissNativeSession, setNativeAppVisibility } from './nativeNotifications.js'
import { ASSISTANTS } from './assistantCatalog.js'
import { APP_VERSION } from './version.js'
import { activeTabForRoute, isTopLevelRoute, routeBackTarget } from './navigation.js'
import { latestListEdge, readSessionSortOrder, writeSessionSortOrder } from './sessionListWindow.js'

function useRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/')
  useEffect(() => {
    const f = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return hash
}

const DEV_ID_KEY = 'dsh-device-id'

export default function App() {
  const [dev, setDev] = useState(undefined) // undefined=loading, false=未绑定, object=已绑定
  const [setupPw, setSetupPw] = useState(false) // 绑定成功 → 提示设置密码
  const [locked, setLocked] = useState(false) // 会话过期但有设备密码 → 锁定页
  // 服务器地址：undefined=检查中, null=APK 壳未配置→绑定页, string=已配置（''=PWA 同源）
  const [server, setServer] = useState(undefined)
  const route = useRoute()
  useEffect(() => {
    const saved = getServerUrl()
    if (saved) { setServer(saved); return }
    const isAppShell = !!(window.Capacitor && window.Capacitor.Plugins)
    const isRemotePage = window.location.protocol === 'https:' || window.location.protocol === 'http:'
    // 新 APK 直接加载正式 HTTPS 前端时默认同源，不再重复要求填写服务器地址。
    setServer(isAppShell && !isRemotePage ? null : '')
  }, [])
  useEffect(() => {
    authMe().then((d) => {
      if (d) {
        if (d.deviceId) { try { localStorage.setItem(DEV_ID_KEY, d.deviceId) } catch (e) {} }
        setDev(d)
      } else {
        // 会话过期：若本机曾绑定过设备且服务器侧有密码 → 进锁定页；否则重新绑定
        let prev = null
        try { prev = localStorage.getItem(DEV_ID_KEY) } catch (e) {}
        if (prev) {
          setDev({ deviceId: prev })
          setLocked(true)
        } else {
          setDev(false)
        }
      }
    }).catch(() => setDev(false))
  }, [])
  if (server === undefined) return <div className="center"><span className="spin"></span>加载中</div>
  if (server === null) return (
    <ServerBindPage onDone={(url) => { setServer(url); setServerUrl(url) }} />
  )
  if (dev === undefined) return <div className="center"><span className="spin"></span>加载中</div>
  if (locked) return <LockPage deviceId={dev.deviceId} onUnlocked={() => setLocked(false)} />
  if (setupPw) return <SetupPassword onDone={() => setSetupPw(false)} />
  if (!dev) return (
    <BindPage onBound={(id) => {
      try { localStorage.setItem(DEV_ID_KEY, id) } catch (e) {}
      setDev({ deviceId: id })
      setSetupPw(true) // 绑定成功 → 引导设置密码
    }} />
  )
  return <Shell route={route} deviceId={dev.deviceId} onUnbind={async () => { await authUnbind(); try { localStorage.removeItem(DEV_ID_KEY) } catch (e) {} setDev(false) }} />
}

const TABS = [
  ['#/', '会话', '💬'],
  ['#/assistant', '助手', '🤖'],
  ['#/optimize', '优化', '📱'],
  ['#/notes', '笔记', '📓'],
  ['#/monitor', '监控', '📊']
]

function sessionIdFromRoute(route) {
  try {
    if (route.startsWith('#/chat/')) return decodeURIComponent(route.slice('#/chat/'.length))
    if (route.startsWith('#/task/')) return decodeURIComponent(route.split('/')[3] || '')
  } catch (e) {}
  return ''
}

function Shell({ route, deviceId, onUnbind }) {
  const [chatHeader, setChatHeader] = useState({ sessionId: '', title: '聊天' })
  const [toast, setToast] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [sessionListMode, setSessionListMode] = useState(() => {
    try { return localStorage.getItem('dsh-session-list-mode') === 'tasks' ? 'tasks' : 'main' } catch (e) { return 'main' }
  })
  // 排序设置由 Shell 统一持有，设置页与列表页共用同一个即时真值，避免返回列表时重新读到旧值。
  const [sessionSortOrder, setSessionSortOrder] = useState(readSessionSortOrder)
  const changeSessionSortOrder = (value) => setSessionSortOrder(writeSessionSortOrder(value))
  const lastBack = useRef(0)
  const listScrollRef = useRef(null)
  const [notificationState, setNotificationState] = useState({ sequence: 0, unreadCount: 0, runningCount: 0, sessions: [] })
  const [appVisible, setAppVisible] = useState(() => document.visibilityState === 'visible')
  const routeSessionId = sessionIdFromRoute(route)
  const routeTerminalKey = notificationState.sessions.find(session => session.sessionId === routeSessionId)?.terminalKey || ''

  // VPS 账本是颜色和未读数真值；前端定时刷新只负责显示，后台系统通知由原生服务独立接收。
  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const value = await notificationSnapshot()
        if (alive && value) setNotificationState(value)
      } catch (e) {}
    }
    refresh()
    const timer = setInterval(refresh, 5000)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  // 原生层持有自己的长轮询，不依赖 WebView 定时器；同时同步前后台可见状态以避免重复通知。
  useEffect(() => {
    let appListener = null
    const updateVisibility = active => { setAppVisible(!!active); setNativeAppVisibility(active) }
    const onVisibility = () => updateVisibility(document.visibilityState === 'visible')
    configureNativeNotifications(deviceId).then(async configured => {
      if (!configured) return
      updateVisibility(document.visibilityState === 'visible')
      const sessionId = await consumeNativeNotificationOpen()
      if (sessionId) window.location.hash = '#/chat/' + encodeURIComponent(sessionId)
    }).catch(() => {})
    document.addEventListener('visibilitychange', onVisibility)
    try {
      const app = window.Capacitor?.Plugins?.App
      if (app?.addListener) Promise.resolve(app.addListener('appStateChange', state => updateVisibility(!!state?.isActive)))
        .then(handle => { appListener = handle }).catch(() => {})
    } catch (e) {}
    return () => { document.removeEventListener('visibilitychange', onVisibility); try { appListener?.remove?.() } catch (e) {} }
  }, [deviceId])

  // 只确认当前实际看到的 terminalKey；服务端确认成功后才清除系统通知。
  useEffect(() => {
    if (!appVisible || !routeSessionId || !routeTerminalKey) return
    const acknowledgement = { sessionId: routeSessionId, terminalKey: routeTerminalKey }
    notificationRead(acknowledgement).then(value => {
      if (value) setNotificationState(value)
      dismissNativeSession(routeSessionId)
    }).catch(() => {})
  }, [appVisible, routeSessionId, routeTerminalKey])

  // 返回键（APP 内）：子页面逐级返回；顶层两次退出确认
  useEffect(() => {
    if (!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App)) return
    let unsub = null
    try {
      unsub = window.Capacitor.Plugins.App.addListener('backButton', () => {
        const hash = window.location.hash || '#/'
        // 任何子页面都明确回到会话列表，不依赖历史栈深度，避免侧滑返回直接退出 APP。
        if (hash !== '#/' && hash !== '') {
          try {
            window.location.hash = routeBackTarget(hash)
          } catch (e) {}
          return
        }
        // 首页：两次返回退出确认
        const now = Date.now()
        if (now - lastBack.current < 2500) { try { window.Capacitor.Plugins.App.exitApp() } catch (e) {} }
        else {
          lastBack.current = now
          setToast('再按一次退出巴拉丁')
          setTimeout(() => setToast(''), 1800)
        }
      })
    } catch (e) {}
    return () => { if (unsub) { try { unsub() } catch (e) {} } }
  }, [])
  useEffect(() => { setMoreOpen(false) }, [route])
  // 每次回到会话列表都定位到“最新内容”一端，不恢复可能落在旧会话区的历史滚动位置。
  useEffect(() => {
    if (route !== '#/' || !listScrollRef.current) return
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const scroller = listScrollRef.current
        if (!scroller) return
        scroller.scrollTop = latestListEdge(sessionSortOrder) === 'bottom' ? scroller.scrollHeight : 0
      })
    })
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame) }
  }, [route, sessionListMode, sessionSortOrder])
  let content
  let title = ''
  if (route.startsWith('#/chat/')) {
    const id = route.slice('#/chat/'.length)
    let cachedTitle = ''
    try { cachedTitle = localStorage.getItem('dsh-title-' + id) || '' } catch (e) {}
    content = <ChatPage key={id} sessionId={id} onTitle={(next) => setChatHeader({ sessionId: id, title: next })} />
    title = chatHeader.sessionId === id ? chatHeader.title : (cachedTitle || '聊天')
  } else if (route.startsWith('#/task/')) {
    const [, , parentSessionId = '', childSessionId = '', mode = 'one-shot'] = route.split('/')
    const id = decodeURIComponent(childSessionId)
    let cachedTitle = ''
    try { cachedTitle = localStorage.getItem('dsh-title-' + id) || '' } catch (e) {}
    content = <ChatPage key={id} sessionId={id} subagentAddress={{ parentSessionId: decodeURIComponent(parentSessionId), childSessionId: id, mode }} onTitle={(next) => setChatHeader({ sessionId: id, title: next })} />
    title = chatHeader.sessionId === id ? chatHeader.title : (cachedTitle || 'AI 任务')
  } else if (route.startsWith('#/assistant')) {
    const assistantPath = route.startsWith('#/assistant/') ? route.slice('#/assistant/'.length) : ''
    const assistantId = assistantPath.split('?')[0]
    content = <AssistantPage assistantId={assistantId} deviceId={deviceId} onTitle={() => {}} />
    title = ASSISTANTS.find(assistant => assistant.id === assistantId)?.title || '助手'
  }
  else if (route.startsWith('#/paint')) { content = null; title = 'AI绘画' }
  else if (route.startsWith('#/tools')) { content = <ToolsPage />; title = '工具' }
  else if (route.startsWith('#/resume')) { content = <ResumePage />; title = '简历' }
  else if (route.startsWith('#/notes')) { content = <NotesPage />; title = '笔记' }
  else if (route.startsWith('#/optimize')) { content = <OptimizationPage />; title = '优化中心' }
  else if (route.startsWith('#/monitor')) { content = <MonitorPage />; title = '资源监控' }
  else if (route.startsWith('#/settings')) {
    content = <SettingsPage
      onUnbind={onUnbind}
      onChangeServer={() => { clearServerUrl(); window.location.reload() }}
      sessionSortOrder={sessionSortOrder}
      onSessionSortOrderChange={changeSessionSortOrder}
    />
    title = '设置'
  }
  else {
    content = <ChatsPage mode={sessionListMode} sortOrder={sessionSortOrder} notificationState={notificationState} onModeChange={(next) => {
      setSessionListMode(next)
      try { localStorage.setItem('dsh-session-list-mode', next) } catch (e) {}
    }} />
    title = sessionListMode === 'tasks' ? 'AI 任务' : '会话'
  }

  const active = activeTabForRoute(route)
  const paintActive = route.startsWith('#/paint')
  const assistantChatActive = route.startsWith('#/assistant/')
  const compactContent = route.startsWith('#/chat/') || route.startsWith('#/task/') || assistantChatActive || paintActive
  const goBack = () => { window.location.hash = routeBackTarget(route) }
  useEffect(() => {
    if (!paintActive) return
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    return () => cancelAnimationFrame(frame)
  }, [paintActive])
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <SoundReasonBar />
      <div className={'topbar' + (route.startsWith('#/chat/') || route.startsWith('#/task/') ? ' chat-topbar' : '')}>
        <span className="icon-btn" onClick={goBack} style={{ visibility: isTopLevelRoute(route) ? 'hidden' : 'visible' }}>←</span>
        <span className="title">{title}</span>
        <small className="app-version" title="当前版本">{APP_VERSION}</small>
        <ConnectionStatus />
        {route === '#/' && <div className="topbar-more">
          <button type="button" className="icon-btn more-trigger" aria-label="更多" aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}>⋯</button>
          {moreOpen && <>
            <button type="button" className="more-backdrop" aria-label="关闭菜单" onClick={() => setMoreOpen(false)} />
            <div className="more-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); window.location.hash = '#/settings' }}>
                <span>⚙️</span><span><strong>设置</strong><small>语音、音效与会话排序</small></span>
              </button>
            </div>
          </>}
        </div>}
      </div>
      <TaskBar />
      {toast && <div className="exit-toast">{toast}</div>}
      <div ref={listScrollRef} className="scroll" style={compactContent ? { padding: 0, overflow: 'hidden' } : undefined}>
        {content}
        <div className={'paint-live-host' + (paintActive ? ' active' : ' hidden')} aria-hidden={!paintActive}>
          <PaintPage onTitle={() => {}} />
        </div>
      </div>
      <nav className="tabbar">
        {TABS.map(([h, label, icon]) => (
          <a key={h} href={h} className={active === h ? 'on' : ''}>
            <span className="ti tab-icon-wrap">{icon}{h === '#/' && notificationState.unreadCount > 0 && <b className="tab-unread-badge">{notificationState.unreadCount > 99 ? '99+' : notificationState.unreadCount}</b>}</span><span>{label}</span>
          </a>
        ))}
      </nav>
    </div>
  )
}