export const SESSION_SORT_KEY = 'dsh-session-sort-order'

export function normalizeSessionSortOrder(value) {
  return value === 'oldest-first' ? 'oldest-first' : 'newest-first'
}

export function readSessionSortOrder(storage = globalThis.localStorage) {
  try { return normalizeSessionSortOrder(storage?.getItem(SESSION_SORT_KEY)) } catch (e) { return 'newest-first' }
}

export function writeSessionSortOrder(value, storage = globalThis.localStorage) {
  const normalized = normalizeSessionSortOrder(value)
  try { storage?.setItem(SESSION_SORT_KEY, normalized) } catch (e) {}
  return normalized
}

/**
 * 会话目录可以按两种方向展示，但首屏永远只取最近更新的一批。
 * newest-first：最新会话在数组开头；oldest-first：最新会话在数组末尾。
 */
export function selectLatestSessionWindow(items, limit, sortOrder) {
  const source = Array.isArray(items) ? items : []
  const size = Math.max(0, Number(limit) || 0)
  if (size === 0 || source.length <= size) return source
  return sortOrder === 'oldest-first' ? source.slice(-size) : source.slice(0, size)
}

/** 最新内容所在的列表边缘。 */
export function latestListEdge(sortOrder) {
  return sortOrder === 'oldest-first' ? 'bottom' : 'top'
}
