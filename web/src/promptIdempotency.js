const PENDING_PREFIX = 'dsh-mobile-prompt-pending:'
const RECENT_PREFIX = 'dsh-mobile-prompt-recent:'
const PENDING_TTL = 2 * 60 * 1000
const RECENT_TTL = 4000

function requestId() {
  return crypto.randomUUID ? crypto.randomUUID() : 'm-' + Date.now() + '-' + Math.random().toString(16).slice(2)
}

function hashText(hash, text) {
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function contentFingerprint(content) {
  let hash = 2166136261
  for (const block of content || []) {
    hash = hashText(hash, String(block.type || ''))
    if (block.type === 'text') hash = hashText(hash, String(block.text || ''))
    if (block.type === 'image') {
      const data = String(block.data || '')
      hash = hashText(hash, `${block.mediaType || ''}|${block.name || ''}|${data.length}|${data.slice(0, 96)}|${data.slice(-96)}`)
    }
  }
  return hash.toString(16).padStart(8, '0')
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch (e) { return null }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch (e) {}
}

export function beginPromptAttempt(sessionId, content, now = Date.now()) {
  const fingerprint = contentFingerprint(content)
  const pendingKey = PENDING_PREFIX + sessionId
  const recentKey = RECENT_PREFIX + sessionId
  const pending = readJson(pendingKey)
  if (pending && pending.fingerprint === fingerprint && now - pending.createdAt < PENDING_TTL) {
    return { rpcId: pending.rpcId, fingerprint, retry: true, duplicate: false }
  }
  const recent = readJson(recentKey)
  if (recent && recent.fingerprint === fingerprint && now - recent.completedAt < RECENT_TTL) {
    return { rpcId: recent.rpcId, fingerprint, retry: false, duplicate: true }
  }
  const rpcId = requestId()
  writeJson(pendingKey, { rpcId, fingerprint, createdAt: now })
  return { rpcId, fingerprint, retry: false, duplicate: false }
}

export function finishPromptAttempt(sessionId, attempt, delivered, now = Date.now()) {
  const pendingKey = PENDING_PREFIX + sessionId
  const pending = readJson(pendingKey)
  if (pending && pending.rpcId === attempt.rpcId && delivered) {
    try { localStorage.removeItem(pendingKey) } catch (e) {}
  }
  if (delivered) writeJson(RECENT_PREFIX + sessionId, { rpcId: attempt.rpcId, fingerprint: attempt.fingerprint, completedAt: now })
}
