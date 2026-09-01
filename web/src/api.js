import { withMobileSource } from './mobilePrompt.js'
import { reportTelemetry } from './telemetry.js'

// DSH /api 客户端 + 网关认证。
// 契约（实测确认）：URL = /api/<命名空间>.<方法>；信封 {type:'client-request', rpcId, method, payload};
// payload 为直接业务参数；响应 {type:'server-response', rpcId, result:{ok,value}|{ok:false,error}}。

// —— 服务器地址（首启绑定，存 localStorage；'' = 同源，PWA 部署 / vite dev 代理） ——
const SRV_KEY = 'dsh-server-url'
export function getServerUrl() {
  try { return (localStorage.getItem(SRV_KEY) || '').replace(/\/+$/, '') } catch (e) { return '' }
}
export function setServerUrl(url) {
  const v = String(url || '').replace(/\/+$/, '')
  try { v ? localStorage.setItem(SRV_KEY, v) : localStorage.removeItem(SRV_KEY) } catch (e) {}
  return v
}
export function clearServerUrl() { try { localStorage.removeItem(SRV_KEY) } catch (e) {} }
function base() { return getServerUrl() } // '' = 同源

const rid = () => (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now() + Math.random().toString(16).slice(2));

// 正式远程前端本身由巴拉丁网关托管，链路探针必须命中当前页面 origin，不能被历史服务器地址带偏。
// localhost/Vite 与离线壳仍沿用手动绑定地址。
export function getHealthProbeBase() {
  try {
    const { protocol, hostname, origin } = window.location
    const remoteHosted = /^https?:$/.test(protocol) && !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hostname)
    if (remoteHosted) return origin.replace(/\/+$/, '')
  } catch (e) {}
  return getServerUrl()
}

let sessionListInFlight = null
let sessionListCachedValue = null
let sessionListCachedAt = 0
const SESSION_LIST_COALESCE_MS = 1500

async function listSessions(payload = {}) {
  if (payload && Object.keys(payload).length > 0) return raw('session.list', payload)
  if (sessionListCachedValue && Date.now() - sessionListCachedAt < SESSION_LIST_COALESCE_MS) return sessionListCachedValue
  if (sessionListInFlight) return sessionListInFlight
  sessionListInFlight = raw('session.list', payload).then(value => {
    sessionListCachedValue = value
    sessionListCachedAt = Date.now()
    return value
  }).finally(() => { sessionListInFlight = null })
  return sessionListInFlight
}

async function raw(method, payload, opts = {}) {
  const startedAt = Date.now()
  const requestRpcId = opts.rpcId || rid()
  const mobilePayload = withMobileSource(method, payload)
  const res = await fetch(base() + '/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: requestRpcId, method, payload: mobilePayload }),
    credentials: 'include',
    signal: opts.signal
  });
  let j;
  try { j = await res.json(); } catch { throw new Error('HTTP ' + res.status + '（可能网关未就绪或跨域）'); }
  if (j && j.result && typeof j.result.ok === 'boolean') {
    if (j.result.ok) {
      const durationMs = Date.now() - startedAt
      if (durationMs >= 1500) reportTelemetry({ type: 'slow-rpc', method, durationMs, status: res.status })
      return j.result.value
    }
    const e = j.result.error || {};
    reportTelemetry({ type: 'rpc-error', method, durationMs: Date.now() - startedAt, status: res.status, message: e.message })
    // 已收到结构化 RPC 响应，说明本次请求结果确定；发送幂等层可安全结束 pending 状态。
    throw Object.assign(new Error(e.message || 'RPC 失败'), { code: e.code, details: e.details, responseReceived: true });
  }
  throw new Error('响应异常');
}

// 回答 mux 下行的 server-request。与普通 RPC 不同：必须回显原 rpcId，响应是 RpcReceipt。
async function respond(message, opts = {}) {
  const res = await fetch(base() + '/api/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message),
    credentials: 'include',
    signal: opts.signal
  });
  let receipt;
  try { receipt = await res.json(); } catch { throw new Error('HTTP ' + res.status + '（回答接口响应异常）'); }
  if (receipt && typeof receipt.accepted === 'boolean') return receipt;
  throw new Error('回答接口响应异常');
}

// 暴露的会话/任务 API
export const api = {
  listSessions,
  history: (p) => raw('session.history', p),
  models: (p) => raw('session.models', p),
  prompt: (p, opts) => raw('session.prompt', p, opts),
  respond: (message, opts) => respond(message, opts),
  rename: (p) => raw('session.rename', p),
  cancel: (p) => raw('session.cancel', p),
  fork: (p) => raw('session.fork', p),
  create: (p) => raw('session.create', p),
  search: (p) => raw('session.search', p),
  selectModel: (p) => raw('session.selectModel', p),
  attachment: (p) => raw('session.attachment', p),
  listWorkspaces: (p = {}) => raw('workspace.list', p),
  archiveSession: (p) => raw('workspace.archiveSession', p),
  listGoals: (p = {}) => raw('goal.list', p),
  listTasks: (p = {}) => raw('jobs.list', p), // 若不存在会报错，页面做容错
  listSubagents: (p) => raw('subagent.list', p),
  subagentHistory: (p) => raw('subagent.history', p),
  subagentPrompt: (p, opts) => raw('subagent.prompt', p, opts),
  subagentInterrupt: (p) => raw('subagent.interrupt', p)
};

// —— AI 笔记 / 语音闪念胶囊（网关本地接口，不走 DSH RPC） ——
async function noteRequest(path, options = {}) {
  const res = await fetch(base() + '/api/notes' + path, { ...options, credentials: 'include' });
  if (res.status === 401) throw new Error('未绑定设备');
  const j = await res.json().catch(() => null);
  if (!j || !j.ok) throw new Error((j && j.error && j.error.message) || '笔记操作失败');
  return j.value;
}
export const listNotes = () => noteRequest('');
export const readNote = (name) => noteRequest('/' + encodeURIComponent(name));
export const createNoteCapsule = (transcript, requestId) => noteRequest('/capsules', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript, requestId })
});
export const retryNoteCapsule = (id) => noteRequest('/capsules/' + encodeURIComponent(id) + '/retry', { method: 'POST' });

// 监控数据（由网关完成设备会话鉴权和 dashboard1 内部认证）
async function monitoringRequest(path, options) {
  const res = await fetch(base() + '/api/monitoring/' + path, { ...options, credentials: 'include' });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j) throw new Error((j && j.error && j.error.message) || '监控数据加载失败');
  return j;
}
export const monitoringLatest = () => monitoringRequest('latest');
export async function monitoringCollect() {
  await monitoringRequest('collect', { method: 'POST' });
  return monitoringLatest();
}

// —— VPS 会话状态/通知账本（不走 DSH RPC 信封）——
async function notificationRequest(path, options = {}) {
  const response = await fetch(base() + '/api/notification/' + path, { ...options, credentials: 'include' })
  const value = await response.json().catch(() => null)
  if (!response.ok || !value?.ok) throw new Error(value?.error?.message || '通知状态同步失败')
  return value.value
}
export const notificationSnapshot = () => notificationRequest('snapshot')
export const notificationEvents = (after = 0, wait = 0) => notificationRequest('events?after=' + encodeURIComponent(after) + '&wait=' + encodeURIComponent(wait))
export const notificationRead = (acknowledgements) => notificationRequest('read', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acknowledgements: Array.isArray(acknowledgements) ? acknowledgements : [acknowledgements] })
})

// 网关认证端点（不走 DSH RPC 信封）
export async function authMe() {
  const res = await fetch(base() + '/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  const j = await res.json().catch(() => null);
  return j && j.ok ? j.value : null;
}
export async function authBind(token) {
  const res = await fetch(base() + '/api/auth/device-bind', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }), credentials: 'include'
  });
  const j = await res.json().catch(() => null);
  if (res.status === 401 || !j || !j.ok) throw new Error((j && j.error && j.error.message) || '绑定失败');
  return j.value;
}
export async function authUnbind() {
  await fetch(base() + '/api/auth/unbind', { method: 'POST', credentials: 'include' });
}
// 扫码绑定：服务器生成一次性令牌（前端渲染二维码）
export async function authBindQr() {
  const res = await fetch(base() + '/api/auth/bind-qr', { method: 'POST', credentials: 'include' });
  const j = await res.json().catch(() => null);
  if (!j || !j.ok) throw new Error((j && j.error && j.error.message) || '生成二维码失败');
  return j.value.token;
}
// 设置/修改自定义密码
export async function authSetPassword(password) {
  const res = await fetch(base() + '/api/auth/password', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }), credentials: 'include'
  });
  const j = await res.json().catch(() => null);
  if (!j || !j.ok) throw new Error((j && j.error && j.error.message) || '设置密码失败');
  return j.value;
}
// 密码解锁（会话过期后用密码重新登录）
export async function authUnlock(deviceId, password) {
  const res = await fetch(base() + '/api/auth/unlock', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId, password }), credentials: 'include'
  });
  const j = await res.json().catch(() => null);
  if (res.status === 401 || !j || !j.ok) throw new Error((j && j.error && j.error.message) || '解锁失败');
  return j.value;
}
// 服务器连通性探测（首启绑定页用）：{t:服务器时间戳}
export async function probeServer(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(String(url || '').replace(/\/+$/, '') + '/api/link/gateway?t=' + Date.now(), { cache: 'no-store', signal: ctrl.signal })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return await res.json()
  } finally { clearTimeout(timer) }
}
