/**
 * 从会话集合中排除 DSH 工作区注册表里的归档会话。
 * 归档是全局状态，主列表和自动任务副列表必须共用同一份过滤结果。
 */
export function filterArchivedSessions(sessions, archivedSessionIds) {
  const archived = new Set(Array.isArray(archivedSessionIds) ? archivedSessionIds : [])
  return (Array.isArray(sessions) ? sessions : []).filter(session => !archived.has(session?.sessionId))
}

/**
 * 把服务端确认后的标题写回会话投影，保证列表无需等待下一轮轮询即可更新。
 */
export function withSessionTitle(session, title) {
  return {
    ...session,
    projections: {
      ...session?.projections,
      values: {
        ...session?.projections?.values,
        title: String(title || '').trim()
      }
    }
  }
}
