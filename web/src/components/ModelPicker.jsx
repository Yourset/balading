import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { readModelCache, writeModelCache } from '../sessionCache.js'

// 会话级模型与思考强度选择：与桌面端共用 session.models / session.selectModel 契约。
// 切换只作用于当前会话，并从下一条消息开始生效。
const cacheKey = (sessionId) => 'dsh-model-' + sessionId

function readCached(sessionId) {
  try { return JSON.parse(localStorage.getItem(cacheKey(sessionId)) || 'null') } catch (e) { return null }
}

function saveCached(sessionId, selected) {
  try { localStorage.setItem(cacheKey(sessionId), JSON.stringify(selected)) } catch (e) {}
}

function findChoice(directory, selected) {
  if (!selected) return null
  for (const provider of directory?.groups || []) {
    const model = (provider.models || []).find(item => item.id === selected.model)
    if (provider.id === selected.provider && model) return { provider, model }
  }
  return null
}

function pickerLabel(directory, selected) {
  if (!selected?.model) return '选择模型'
  const choice = findChoice(directory, selected)
  const modelName = choice?.model?.name || String(selected.model).split('/').pop() || selected.model
  const reasoning = choice?.model?.reasoning
  if (!reasoning) return modelName
  const effortId = selected.reasoningEffort ?? reasoning.defaultEffort
  const effortName = effortId === undefined
    ? '默认强度'
    : reasoning.efforts?.find(item => item.id === effortId)?.name || effortId
  return modelName + ' · ' + effortName
}

export default function ModelPicker({ sessionId }) {
  const [open, setOpen] = useState(false)
  const [directory, setDirectory] = useState(() => readModelCache(sessionId)?.value || null)
  const [selected, setSelected] = useState(() => readCached(sessionId))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')

  const remember = (value) => {
    if (!value) return
    setSelected(value)
    saveCached(sessionId, value)
  }

  const load = async () => {
    setLoading(true); setError('')
    try {
      const value = await api.models({ sessionId })
      setDirectory(value)
      writeModelCache(sessionId, value)
      remember(value?.current)
      return value
    } catch (e) {
      setError('模型列表加载失败：' + (e.message || e))
      return null
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    api.models({ sessionId }).then(value => {
      if (!alive) return
      setDirectory(value)
      writeModelCache(sessionId, value)
      remember(value?.current)
    }).catch(() => {})
    return () => { alive = false }
  }, [sessionId])

  const openPicker = () => {
    setOpen(true)
    if (!directory && !loading) load()
  }

  const select = async (selection, key, closeAfter) => {
    if (saving) return
    setSaving(key); setError('')
    try {
      const value = await api.selectModel({ sessionId, ...selection })
      const next = value?.selected || selection
      remember(next)
      setDirectory(prev => prev ? { ...prev, current: next } : prev)
      if (closeAfter) setOpen(false)
    } catch (e) {
      setError('切换失败：' + (e.message || e))
    } finally {
      setSaving('')
    }
  }

  const chooseModel = (provider, model) => {
    const selection = {
      provider: provider.id,
      model: model.id,
      ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort })
    }
    const sameModel = selected?.provider === provider.id && selected?.model === model.id
    if (sameModel) return
    select(selection, 'model:' + provider.id + '/' + model.id, !model.reasoning)
  }

  const chooseEffort = (provider, model, effort) => {
    const selection = {
      provider: provider.id,
      model: model.id,
      ...(effort === undefined ? {} : { reasoningEffort: effort })
    }
    select(selection, 'effort:' + (effort ?? 'default'), true)
  }

  const groups = directory?.groups || []
  const current = directory?.current || selected
  return <>
    <div className="composer-meta">
      <button type="button" className="model-chip" onClick={openPicker} aria-label="选择模型和思考强度">
        <span>🤖</span><span className="model-name">{pickerLabel(directory, selected)}</span><span className="model-arrow">⌄</span>
      </button>
    </div>
    {open && <div className="model-overlay" onClick={() => setOpen(false)}>
      <section className="model-sheet" onClick={e => e.stopPropagation()} aria-label="模型和思考强度选择">
        <div className="model-sheet-head">
          <strong>模型与思考强度</strong>
          <button type="button" className="model-close" onClick={() => setOpen(false)} aria-label="关闭">✕</button>
        </div>
        {loading && <div className="loading"><span className="spin"></span>加载模型…</div>}
        {error && <div className="model-error">{error}</div>}
        {!loading && groups.map(provider => <div key={provider.id} className="model-group">
          <div className="model-provider">{provider.name || provider.id}</div>
          {(provider.models || []).map(model => {
            const key = provider.id + '/' + model.id
            const active = current?.provider === provider.id && current?.model === model.id
            const reasoning = model.reasoning
            const effectiveEffort = active ? (current?.reasoningEffort ?? reasoning?.defaultEffort) : reasoning?.defaultEffort
            const effortChoices = !reasoning ? [] : [
              ...(reasoning.defaultEffort === undefined ? [{ id: undefined, name: '默认强度' }] : []),
              ...(reasoning.efforts || [])
            ]
            return <div className={'model-option-wrap' + (active ? ' active' : '')} key={key}>
              <button type="button" className="model-option" disabled={!!saving} onClick={() => chooseModel(provider, model)}>
                <span className="model-option-name">{active ? '✓ ' : ''}{model.name || model.id}{saving === 'model:' + key ? ' · 切换中…' : ''}</span>
                {(model.description || model.name !== model.id) && <span className="model-option-sub">{model.description || model.id}</span>}
              </button>
              {active && reasoning && <div className="effort-panel">
                <div className="effort-title">思考强度</div>
                <div className="effort-options">
                  {effortChoices.map(level => {
                    const levelKey = level.id ?? 'provider-default'
                    const isActive = effectiveEffort === level.id
                    return <button type="button" key={levelKey}
                      className={'effort-option' + (isActive ? ' active' : '')}
                      disabled={!!saving} onClick={() => chooseEffort(provider, model, level.id)}>
                      {isActive ? '✓ ' : ''}{level.name || level.id}{saving === 'effort:' + (level.id ?? 'default') ? '…' : ''}
                    </button>
                  })}
                </div>
              </div>}
            </div>
          })}
        </div>)}
        {!loading && !groups.length && !error && <div className="placeholder">当前会话没有可用模型</div>}
        <div className="model-note">模型和思考强度从下一条消息开始生效</div>
      </section>
    </div>}
  </>
}
