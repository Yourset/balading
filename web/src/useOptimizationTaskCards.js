import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import {
  MAX_RECENT_TASK_CHECKS,
  buildOptimizationCandidates,
  findOptimizationRoot,
  isCacheableTaskTerminal,
  latestTaskTerminal,
  optimizationDescendants,
  selectOptimizationCards
} from './optimizationTasks.js'

const parentIdOf = session => session?.parentSessionId || session?.parentId || ''

/**
 * 读取优化总管的统一任务快照。
 * 优化中心和聊天顶部共用同一套终态判定，避免两个页面显示不同结果。
 */
export function useOptimizationTaskCards({ rootSessionId = '', preferredRootId = '', rootTitles = [], category = '手机优化' } = {}) {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const terminalCache = useRef(new Map())
  const titleKey = rootTitles.join('\u0000')

  const loadTasks = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const response = await api.listSessions()
      const sessions = response?.items || []
      const rootId = rootSessionId || findOptimizationRoot(sessions, preferredRootId, rootTitles)?.sessionId || ''
      if (!rootId) {
        setCards([])
        setError('')
        return
      }
      const descendants = optimizationDescendants(sessions, rootId)
      const parentIds = [...new Set(descendants.map(parentIdOf).filter(Boolean))]
      const catalogPairs = await Promise.all(parentIds.map(parentSessionId => api.listSubagents({ parentSessionId })
        .then(catalog => ({ parentSessionId, catalog })).catch(() => null)))
      const catalogsByParent = Object.fromEntries(catalogPairs.filter(Boolean).map(item => [item.parentSessionId, item.catalog]))
      const candidates = buildOptimizationCandidates(sessions, rootId, catalogsByParent)
      for (const candidate of candidates) if (candidate.running) terminalCache.current.delete(candidate.sessionId)
      const recentChecks = candidates
        .filter(candidate => !candidate.running)
        .sort((left, right) => right.activityAt - left.activityAt)
        .slice(0, MAX_RECENT_TASK_CHECKS)
      await Promise.all(recentChecks.map(async candidate => {
        if (terminalCache.current.has(candidate.sessionId)) return
        try {
          const history = await api.subagentHistory({
            parentSessionId: candidate.parentSessionId,
            childSessionId: candidate.sessionId,
            mode: candidate.mode,
            maxMessages: 40
          })
          const terminal = latestTaskTerminal(history)
          if (isCacheableTaskTerminal(terminal)) terminalCache.current.set(candidate.sessionId, terminal)
        } catch (e) {
          // 临时 history 失败不写入缓存，下一轮轮询继续重试。
        }
      }))
      setCards(selectOptimizationCards(candidates, Object.fromEntries(terminalCache.current), { category }))
      setError(parentIds.length && !catalogPairs.some(Boolean) ? '任务进度暂时读不到' : '')
    } catch (e) {
      setError('任务进度暂时读不到')
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [rootSessionId, preferredRootId, titleKey, category])

  useEffect(() => {
    setLoading(true)
    loadTasks()
    const timer = setInterval(loadTasks, 6000)
    return () => clearInterval(timer)
  }, [loadTasks])

  return { cards, loading, error, refresh: loadTasks }
}
