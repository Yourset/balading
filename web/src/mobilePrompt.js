// 所有从巴拉丁手机端发出的提示词都统一附带来源标记。
// 标记会进入 DSH 会话上下文供 AI 识别，但由手机端消息组件隐藏，不打扰用户阅读。
export const MOBILE_SOURCE_MARKER = '<system-reminder>本条用户消息来自 DSH 手机端（巴拉丁 App/PWA）。请把它视为用户正在通过手机与 AI 交流。</system-reminder>'

const PROMPT_METHODS = new Set(['session.prompt', 'subagent.prompt'])

export function withMobileSource(method, payload) {
  if (!PROMPT_METHODS.has(method) || !payload || !Array.isArray(payload.content)) return payload
  const alreadyMarked = payload.content.some(block => block?.type === 'text' && String(block.text || '').includes(MOBILE_SOURCE_MARKER))
  if (alreadyMarked) return payload
  return {
    ...payload,
    content: [
      { type: 'text', text: MOBILE_SOURCE_MARKER, clientHidden: true },
      ...payload.content
    ]
  }
}
