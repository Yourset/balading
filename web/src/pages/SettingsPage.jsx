import React, { useEffect, useState } from 'react'
import {
  getSoundPreference,
  getVoiceSendMode,
  setSoundPreference,
  setVoiceSendMode,
  soundOptions
} from '../preferences.js'
import { playSoundEvent } from '../sounds.js'
import { getServerUrl } from '../api.js'
import { APP_VERSION } from '../version.js'

const getAppPermissions = () => window.Capacitor?.Plugins?.AppPermissions
const permissionLabel = { granted: '已允许', denied: '已拒绝', prompt: '待申请', 'prompt-with-rationale': '需要再次确认', checking: '检查中' }
const networkLabel = { wifi: 'Wi-Fi', cellular: '移动网络', ethernet: '有线网络', vpn: 'VPN', offline: '离线', other: '其他', unknown: '未知' }

function formatDiagnosticTime(value) {
  const timestamp = Number(value || 0)
  if (!timestamp) return '未知'
  try { return new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) } catch (e) { return '未知' }
}

export default function SettingsPage({ onUnbind, onChangeServer, sessionSortOrder = 'newest-first', onSessionSortOrderChange }) {
  const [voiceMode, setVoiceMode] = useState(getVoiceSendMode)
  const [taskSound, setTaskSound] = useState(() => getSoundPreference('task'))
  const [voiceSound, setVoiceSound] = useState(() => getSoundPreference('voice'))
  const [permissions, setPermissions] = useState({ microphone: 'checking', notifications: 'checking' })
  const [permissionBusy, setPermissionBusy] = useState(false)
  const [permissionError, setPermissionError] = useState('')
  const [diagnostics, setDiagnostics] = useState(null)
  const [diagnosticError, setDiagnosticError] = useState('')

  const refreshDiagnostics = async () => {
    const plugin = window.Capacitor?.Plugins?.AppDiagnostics
    if (!plugin) {
      setDiagnostics({ model: '浏览器', androidVersion: '', networkType: navigator.onLine ? 'other' : 'offline' })
      setDiagnosticError('完整 APK 信息需要新版巴拉丁 App')
      return
    }
    try {
      setDiagnostics(await plugin.getInfo())
      setDiagnosticError('')
    } catch (error) {
      setDiagnosticError('App 诊断信息读取失败')
    }
  }

  const refreshPermissions = async () => {
    const appPermissions = getAppPermissions()
    if (!appPermissions) return
    try {
      const result = await appPermissions.getStatus()
      setPermissions({ microphone: result.microphone || 'denied', notifications: result.notifications || 'denied' })
      setPermissionError('')
    } catch (error) { setPermissionError('权限状态读取失败，请打开系统设置检查') }
  }
  useEffect(() => {
    refreshPermissions()
    refreshDiagnostics()
    const onVisible = () => {
      if (document.visibilityState === 'visible') { refreshPermissions(); refreshDiagnostics() }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  const requestPermissions = async () => {
    const appPermissions = getAppPermissions()
    if (!appPermissions) { setPermissionError('浏览器版请在浏览器网站权限中设置'); return }
    setPermissionBusy(true); setPermissionError('')
    try {
      const result = await appPermissions.requestAll()
      setPermissions({ microphone: result.microphone || 'denied', notifications: result.notifications || 'denied' })
      if (result.microphone !== 'granted' || result.notifications !== 'granted') setPermissionError('仍有权限未允许，可点击“打开系统权限设置”手动开启')
    } catch (error) { setPermissionError('系统未再次弹窗，请打开系统权限设置手动开启') }
    finally { setPermissionBusy(false) }
  }
  const openPermissionSettings = async () => {
    try { await getAppPermissions()?.openSettings() }
    catch (error) { setPermissionError('无法自动打开，请进入系统设置 → 应用 → 巴拉丁 → 权限') }
  }

  const chooseSort = (value) => onSessionSortOrderChange?.(value)
  const chooseVoiceMode = (value) => { setVoiceMode(value); setVoiceSendMode(value) }
  const chooseSound = (kind, value) => {
    setSoundPreference(kind, value)
    if (kind === 'task') setTaskSound(value); else setVoiceSound(value)
    if (value !== 'off') setTimeout(() => playSoundEvent(kind, '', { source: '设置', preview: true }), 0)
  }

  return <section className="settings-page">
    <div className="settings-section">
      <h2>连接与设备</h2>
      <p>更换服务器或解除当前设备绑定。日常聊天不需要操作这里。</p>
      <div className="permission-actions">
        <button type="button" onClick={() => { if (confirm('确定更换服务器地址？')) onChangeServer?.() }}>更换服务器</button>
        <button type="button" onClick={async () => { if (confirm('确定解绑此设备？')) await onUnbind?.() }}>解绑设备</button>
      </div>
    </div>

    <div className="settings-section">
      <h2>App 信息与诊断</h2>
      <p>只读取当前巴拉丁 App、设备型号、系统和连接状态，不读取其他应用、文件、定位或通讯录。</p>
      <div className="permission-list diagnostic-list">
        <div><span><strong>前端版本</strong><small>顶部显示的短版本号</small></span><b className="diagnostic-value">{APP_VERSION}</b></div>
        <div><span><strong>APK 版本</strong><small>{diagnostics?.packageName || '正在读取…'}</small></span><b className="diagnostic-value">{diagnostics?.versionName ? `${diagnostics.versionName} · ${diagnostics.versionCode}` : '—'}</b></div>
        <div><span><strong>APK 更新时间</strong><small>本机安装包最后更新时间</small></span><b className="diagnostic-value">{formatDiagnosticTime(diagnostics?.lastUpdateTime)}</b></div>
        <div><span><strong>手机与系统</strong><small>{diagnostics ? `${diagnostics.manufacturer || ''} ${diagnostics.model || ''}`.trim() : '正在读取…'}</small></span><b className="diagnostic-value">{diagnostics?.androidVersion ? `Android ${diagnostics.androidVersion}` : '—'}</b></div>
        <div><span><strong>当前网络</strong><small>不读取 Wi-Fi 名称、IP 或定位</small></span><b className="diagnostic-value">{networkLabel[diagnostics?.networkType] || diagnostics?.networkType || '—'}</b></div>
        <div><span><strong>前端来源</strong><small>{window.location.origin}</small></span><b className="diagnostic-value">{window.location.protocol === 'https:' ? '服务器热更新' : '安装包内置'}</b></div>
        <div><span><strong>API 服务器</strong><small>{getServerUrl() || window.location.origin}</small></span><b className="diagnostic-value">已连接</b></div>
      </div>
      {diagnosticError && <div className="permission-error">{diagnosticError}</div>}
      <div className="permission-actions"><button type="button" onClick={refreshDiagnostics}>刷新诊断信息</button></div>
    </div>

    <div className="settings-section">
      <h2>权限管理</h2>
      <p>可以随时重新申请 App 所需权限；若 Android 不再弹窗，请进入系统权限设置手动开启。</p>
      <div className="permission-list">
        <div><span><strong>麦克风</strong><small>语音输入与实时识别</small></span><b className={'permission-state ' + permissions.microphone}>{permissionLabel[permissions.microphone] || permissions.microphone}</b></div>
        <div><span><strong>通知</strong><small>后台回复和任务完成提醒</small></span><b className={'permission-state ' + permissions.notifications}>{permissionLabel[permissions.notifications] || permissions.notifications}</b></div>
      </div>
      {permissionError && <div className="permission-error">{permissionError}</div>}
      <div className="permission-actions">
        <button type="button" className="primary" disabled={permissionBusy} onClick={requestPermissions}>{permissionBusy ? '正在申请…' : '重新申请全部权限'}</button>
        <button type="button" onClick={openPermissionSettings}>打开系统权限设置</button>
      </div>
    </div>

    <div className="settings-section">
      <h2>语音输入</h2>
      <p>长按录音后，选择先检查识别文字，或识别成功后直接发送给 AI。</p>
      <div className="settings-options" role="radiogroup" aria-label="语音发送方式">
        <button type="button" role="radio" aria-checked={voiceMode === 'edit'}
          className={'settings-option' + (voiceMode === 'edit' ? ' active' : '')}
          onClick={() => chooseVoiceMode('edit')}>
          <span><strong>识别后编辑</strong><small>识别文字进入输入框，确认或修改后再发送</small></span>
          <b>{voiceMode === 'edit' ? '✓' : ''}</b>
        </button>
        <button type="button" role="radio" aria-checked={voiceMode === 'auto'}
          className={'settings-option' + (voiceMode === 'auto' ? ' active' : '')}
          onClick={() => chooseVoiceMode('auto')}>
          <span><strong>识别后自动发送</strong><small>松手识别成功后直接发给 AI，失败时回填输入框</small></span>
          <b>{voiceMode === 'auto' ? '✓' : ''}</b>
        </button>
      </div>
    </div>

    <div className="settings-section">
      <h2>提示音</h2>
      <p>分别选择 AI/后台任务完成和语音发送成功时的声音；选择后会立即试听。</p>
      <label className="sound-setting">
        <span><strong>任务完成</strong><small>AI 回复或后台任务完成时播放</small></span>
        <select value={taskSound} onChange={event => chooseSound('task', event.target.value)} aria-label="任务完成提示音">
          {soundOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="sound-setting">
        <span><strong>语音发送成功</strong><small>火山识别结果被 DSH 接收后播放</small></span>
        <select value={voiceSound} onChange={event => chooseSound('voice', event.target.value)} aria-label="语音发送成功提示音">
          {soundOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
    </div>

    <div className="settings-section">
      <h2>会话列表</h2>
      <p>选择新对话和最近更新的对话显示在哪一端。</p>
      <div className="settings-options" role="radiogroup" aria-label="会话排序">
        <button type="button" role="radio" aria-checked={sessionSortOrder === 'newest-first'}
          className={'settings-option' + (sessionSortOrder === 'newest-first' ? ' active' : '')}
          onClick={() => chooseSort('newest-first')}>
          <span><strong>最新在上</strong><small>新对话和刚更新的对话显示在列表顶部</small></span>
          <b>{sessionSortOrder === 'newest-first' ? '✓' : ''}</b>
        </button>
        <button type="button" role="radio" aria-checked={sessionSortOrder === 'oldest-first'}
          className={'settings-option' + (sessionSortOrder === 'oldest-first' ? ' active' : '')}
          onClick={() => chooseSort('oldest-first')}>
          <span><strong>最新在下</strong><small>新对话和刚更新的对话显示在列表底部</small></span>
          <b>{sessionSortOrder === 'oldest-first' ? '✓' : ''}</b>
        </button>
      </div>
    </div>
  </section>
}
