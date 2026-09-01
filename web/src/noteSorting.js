export const NOTE_SORT_KEY = 'balading-note-sort'

/**
 * 笔记列表排序只改变展示顺序，不修改云端文件时间和分类。
 */
export function sortNotes(items, mode) {
  const result = [...(items || [])]
  if (mode === 'created') {
    return result.sort((a, b) => Number(b.createdAt || b.updatedAt || 0) - Number(a.createdAt || a.updatedAt || 0))
  }
  if (mode === 'category') {
    return result.sort((a, b) => String(a.category || '归档').localeCompare(String(b.category || '归档'), 'zh-CN')
      || Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
  }
  return result.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
}
