export function emptyPendingQuestions() {
  return { requestToSession: {}, sessionCounts: {} }
}

/**
 * 把 events.mux 的待回答事件折叠成会话级计数。
 * 同一会话可能同时存在多个问题，只有最后一个问题解决后才移除列表标记。
 */
export function reducePendingQuestions(state, envelope) {
  const current = state || emptyPendingQuestions()
  const frame = envelope?.type === 'server-request' ? envelope.payload : (envelope?.payload || envelope)
  if (!frame?.type) return current

  if (frame.type === 'question/requested') {
    const requestId = typeof envelope?.rpcId === 'string' ? envelope.rpcId : ''
    const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : ''
    if (!requestId || !sessionId || current.requestToSession[requestId] === sessionId) return current

    const requestToSession = { ...current.requestToSession }
    const sessionCounts = { ...current.sessionCounts }
    const previousSessionId = requestToSession[requestId]
    if (previousSessionId) {
      const remaining = Math.max(0, Number(sessionCounts[previousSessionId] || 0) - 1)
      if (remaining) sessionCounts[previousSessionId] = remaining
      else delete sessionCounts[previousSessionId]
    }
    requestToSession[requestId] = sessionId
    sessionCounts[sessionId] = Number(sessionCounts[sessionId] || 0) + 1
    return { requestToSession, sessionCounts }
  }

  if (frame.type === 'question/resolved') {
    const requestId = typeof frame.questionRpcId === 'string' ? frame.questionRpcId : ''
    const sessionId = requestId ? current.requestToSession[requestId] : ''
    if (!requestId || !sessionId) return current

    const requestToSession = { ...current.requestToSession }
    const sessionCounts = { ...current.sessionCounts }
    delete requestToSession[requestId]
    const remaining = Math.max(0, Number(sessionCounts[sessionId] || 0) - 1)
    if (remaining) sessionCounts[sessionId] = remaining
    else delete sessionCounts[sessionId]
    return { requestToSession, sessionCounts }
  }

  return current
}

export function hasPendingQuestion(state, sessionId) {
  return Number(state?.sessionCounts?.[sessionId] || 0) > 0
}
