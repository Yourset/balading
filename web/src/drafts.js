const PREFIX = 'dsh-draft-'
export const DRAFT_EVENT = 'dsh-draft-change'

export function readDraft(sessionId) {
  if (!sessionId) return ''
  try { return localStorage.getItem(PREFIX + sessionId) || '' } catch (e) { return '' }
}

export function saveDraft(sessionId, text) {
  if (!sessionId) return
  const value = String(text || '')
  try {
    if (value) localStorage.setItem(PREFIX + sessionId, value)
    else localStorage.removeItem(PREFIX + sessionId)
  } catch (e) {}
  window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: { sessionId, text: value } }))
}

export function clearDraft(sessionId) {
  saveDraft(sessionId, '')
}
