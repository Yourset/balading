import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createSpeechGateway } from './speech-stream.mjs';
import { NotificationLedger, latestTurnEnd } from './notification-ledger.mjs';
import { buildCapsuleRefinementPrompt, CAPSULE_SESSION_TITLE, latestAssistantText, NoteCapsuleStore, parseCapsuleAiResult, parseCapsuleDocument } from './note-capsule.mjs';
import { ClientErrorStore } from './client-error-store.mjs';
import { SpeechUsageLedger } from './speech-usage-ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- 配置 ----------
const PORT = Number(process.env.MOBILE_PORT || 8788);
const HOST = process.env.MOBILE_HOST || '127.0.0.1';
const DSH = process.env.DSH_TARGET || 'http://127.0.0.1:3080';
const DASHBOARD = process.env.DASHBOARD_TARGET || 'http://127.0.0.1:8793';
const DASHBOARD_ENV = process.env.DASHBOARD_ENV || '/opt/dashboard1/.env';
const TTL = Number(process.env.MOBILE_SESSION_TTL || 30 * 24 * 3600); // 设备会话有效期（秒），默认30天
const NOTES_DIR = process.env.MOBILE_NOTES_DIR || path.join(__dirname, '..', '..', 'ai-notes'); // AI 笔记目录（默认工作区根/ai-notes）
const CAPSULE_CWD = process.env.MOBILE_CAPSULE_CWD || process.cwd(); // 闪念胶囊整理会话的工作目录，用 MOBILE_CAPSULE_CWD 指向你自己的目录
const CAPSULE_POLL_MS = Math.max(1000, Number(process.env.MOBILE_CAPSULE_POLL_MS || 2500));
const CAPSULE_TIMEOUT_MS = Math.max(30000, Number(process.env.MOBILE_CAPSULE_TIMEOUT_MS || 180000));
const capsuleStore = new NoteCapsuleStore(NOTES_DIR);
const CLIENT_ERROR_FILE = process.env.MOBILE_CLIENT_ERROR_FILE || path.join(__dirname, 'client-errors.jsonl');
const clientErrorStore = new ClientErrorStore(CLIENT_ERROR_FILE);
const SPEECH_USAGE_FILE = process.env.MOBILE_SPEECH_USAGE_FILE || path.join(__dirname, 'speech-usage.json');
const speechUsageLedger = new SpeechUsageLedger(SPEECH_USAGE_FILE, { offsetMinutes: Number(process.env.MOBILE_TIME_ZONE_OFFSET_MINUTES || 480) });
const capsuleQueue = [];
const capsuleQueued = new Set();
let capsuleWorkerRunning = false;
let capsuleSessionId = '';
const SPEECH = createSpeechGateway({
  apiKey: process.env.VOLC_SPEECH_API_KEY,
  resourceId: process.env.VOLC_SPEECH_RESOURCE_ID,
  endpoint: process.env.VOLC_SPEECH_WS_URL,
  trustProxy: process.env.MOBILE_TRUST_PROXY === '1',
  onUsage: ({ durationMs, completedAt }) => speechUsageLedger.record(durationMs, completedAt)
});

// session.prompt 幂等窗口：同一设备 + rpcId 在超时重试或重连时只向 DSH 转发一次。
const PROMPT_REPLAY_TTL = Number(process.env.MOBILE_PROMPT_REPLAY_TTL || 2 * 60 * 1000);
const PROMPT_BODY_LIMIT = 8 * 1024 * 1024;
const promptReplays = new Map();

// 后台通知账本：VPS 持续从 DSH 对账，WebView 或 Android 原生层断线后都能按序补齐。
const NOTIFICATION_STATE_FILE = process.env.MOBILE_NOTIFICATION_STATE_FILE || path.join(__dirname, 'notification-state.json');
const NOTIFICATION_POLL_MS = Math.max(5000, Number(process.env.MOBILE_NOTIFICATION_POLL_MS || 15000));
const notificationLedger = new NotificationLedger(NOTIFICATION_STATE_FILE);
const notificationWaiters = new Set();
let notificationPollStopped = false;
let notificationPollTimer = null;

notificationLedger.subscribe(() => {
  for (const wake of [...notificationWaiters]) wake();
});

// 签名密钥：优先环境变量，否则首次生成并落盘 .secret
let SECRET = process.env.MOBILE_SIGNING_SECRET || '';
if (!SECRET) {
  const secretFile = path.join(__dirname, '.secret');
  if (existsSync(secretFile)) SECRET = readFileSync(secretFile, 'utf8').trim();
  else { SECRET = crypto.randomBytes(32).toString('base64url'); writeFileSync(secretFile, SECRET, 'utf8'); }
}

// 万能授权码：优先环境变量 MOBILE_BIND_CODE；未配置则本次进程启动时生成随机码（重启后失效，见启动日志）
const MASTER = process.env.MOBILE_BIND_CODE || 'amdy-' + crypto.randomBytes(6).toString('hex');

// ---------- 一次性令牌池（用后即焚） ----------
let bindTokens = new Set();
function loadTokens() {
  bindTokens = new Set();
  const f = path.join(__dirname, 'tokens.json');
  if (existsSync(f)) {
    try { bindTokens = new Set(JSON.parse(readFileSync(f, 'utf8')).tokens || []); } catch (e) {}
  }
  if (process.env.MOBILE_BIND_TOKENS) for (const t of process.env.MOBILE_BIND_TOKENS.split(',')) bindTokens.add(t.trim());
}

// 用后即焚的持久化：把已用令牌从 tokens.json 移除，防止重启后复用
function persistTokenRemoval(token) {
  const f = path.join(__dirname, 'tokens.json');
  let list = [];
  try { list = JSON.parse(readFileSync(f, 'utf8')).tokens || []; } catch (e) {}
  const next = list.filter(t => t !== token);
  try { writeFileSync(f, JSON.stringify({ tokens: next }, null, 2) + '\n', 'utf8'); } catch (e) {}
}
loadTokens();

// ---------- 设备密码（自定义密码，cookie 失效时可用密码解锁） ----------
const DEVICES_FILE = () => path.join(__dirname, 'devices.json');
function loadDevices() {
  try { return JSON.parse(readFileSync(DEVICES_FILE(), 'utf8')) || {}; } catch (e) { return {}; }
}
function saveDevices(d) {
  try { writeFileSync(DEVICES_FILE(), JSON.stringify(d, null, 2), 'utf8'); } catch (e) {}
}
function hashPassword(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString('base64url');
}
function setDevicePassword(deviceId, pw) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const d = loadDevices();
  d[deviceId] = { salt, hash: hashPassword(pw, salt), updatedAt: Date.now() };
  saveDevices(d);
}
function deviceHasPassword(deviceId) {
  const d = loadDevices();
  return !!(d[deviceId] && d[deviceId].hash && d[deviceId].salt);
}
function verifyDevicePassword(deviceId, pw) {
  const d = loadDevices();
  const rec = d[deviceId];
  if (!rec || !rec.hash || !rec.salt) return false;
  const expect = hashPassword(pw, rec.salt);
  const a = Buffer.from(expect); const z = Buffer.from(rec.hash);
  return a.length === z.length && crypto.timingSafeEqual(a, z);
}

// ---------- HMAC-JWT ----------
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
function makeJwt(payload) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  return head + '.' + body + '.' + sign(head + '.' + body);
}
function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const expect = sign(h + '.' + b);
  const a = Buffer.from(expect); const z = Buffer.from(s);
  if (a.length !== z.length || !crypto.timingSafeEqual(a, z)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch (e) { return null; }
}

const COOKIE = 'dsh_device';
function parseCookie(req) {
  const c = req.headers.cookie || '';
  const m = c.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }

// ---------- CORS（APK WebView 跨源 / 桌面端跨源调用；同源请求无 Origin 不响应） ----------
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('vary', 'origin');
}


function forwardClientErrors(events) {
  if (!events.length) return
  try {
    const target = new URL('/api/mobile-assistant/client-errors', DSH)
    const body = Buffer.from(JSON.stringify({ events }))
    const request = http.request({ method:'POST', hostname:target.hostname, port:target.port, path:target.pathname, timeout:3000, headers:{ 'content-type':'application/json', 'content-length':body.length } }, response => response.resume())
    request.on('timeout', () => request.destroy())
    request.on('error', () => {})
    request.end(body)
  } catch (e) {}
}

// ---------- HTTP 服务器 ----------
const server = http.createServer((req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // —— 设备绑定：万能授权码 或 一次性令牌 → 签发设备会话 Cookie ——
  if (p === '/api/auth/device-bind' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      let t = ''; try { t = JSON.parse(body || '{}').token || ''; } catch (e) {}
      // 万能授权码（服务器配置，可随时改；不消耗、不限次）：见顶部 MASTER 常量
      const isMaster = t === MASTER;
      // CLI 可在网关运行期间追加令牌；绑定前重载持久池，避免新令牌必须重启才生效。
      loadTokens();
      if (!t || (!isMaster && !bindTokens.has(t))) return json(res, 401, { ok: false, error: { code: 'bad-token', message: '授权码无效' } });
      if (!isMaster) { bindTokens.delete(t); persistTokenRemoval(t); } // 一次性令牌用后即焚；万能码不消耗
      const deviceId = crypto.randomUUID();
      const jwt = makeJwt({ sub: deviceId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TTL });
      // 跨源（APK WebView）必须 SameSite=None; Secure 才能携带 cookie；同源（PWA）用 Lax
      res.setHeader('set-cookie', COOKIE + '=' + encodeURIComponent(jwt) + '; HttpOnly; Path=/;' + (req.headers.origin ? ' SameSite=None; Secure' : ' SameSite=Lax') + '; Max-Age=' + TTL);
      return json(res, 200, { ok: true, value: { deviceId } });
    });
    return;
  }

  // —— 链路探测（分段延迟，无鉴权：纯状态不敏感）——
  // 跨域支持：桌面端 DSH（127.0.0.1:3080）跨源调用生成二维码等端点
  // 段1：手机→服务器（网关本地立即响应，不反代 DSH）
  if (p === '/api/link/gateway' && req.method === 'GET') {
    return json(res, 200, { ok: true, value: { t: Date.now() } });
  }
  // 段2：服务器→主电脑（网关内部访问 DSH_TARGET=frp 隧道口，计时）
  if (p === '/api/link/dsh' && req.method === 'GET') {
    const t0 = Date.now();
    const target = new URL(DSH);
    const up = http.request({ method: 'GET', hostname: target.hostname, port: target.port, path: '/', timeout: 3500 }, (upRes) => {
      const ms = Date.now() - t0;
      upRes.resume();
      return json(res, 200, { ok: true, value: { ms, code: upRes.statusCode } });
    });
    up.on('timeout', () => { up.destroy(); return json(res, 200, { ok: true, value: { ms: -1, err: 'timeout' } }); });
    up.on('error', () => { return json(res, 200, { ok: true, value: { ms: -1, err: 'unreachable' } }); });
    up.end();
    return;
  }

  // —— 当前设备信息（含是否已设置密码）——
  if (p === '/api/auth/me' && req.method === 'GET') {
    const payload = verifyJwt(parseCookie(req));
    if (!payload) return json(res, 401, { ok: false, error: { code: 'unauthenticated', message: '未绑定设备' } });
    return json(res, 200, { ok: true, value: { deviceId: payload.sub, hasPassword: deviceHasPassword(payload.sub) } });
  }

  // —— 生成扫码绑定令牌（前端渲染二维码；用后即焚）——
  if (p === '/api/auth/bind-qr' && req.method === 'POST') {
    const t = 'mob-' + crypto.randomBytes(9).toString('base64url');
    bindTokens.add(t);
    return json(res, 200, { ok: true, value: { token: t } });
  }

  // —— 直接生成绑定二维码图片（桌面端 <img> 显示，手机扫码绑定；无前端二维码库依赖）——
  if (p === '/api/auth/bind-qr-image' && req.method === 'GET') {
    res.setHeader('access-control-allow-origin', '*');
    const t = 'mob-' + crypto.randomBytes(9).toString('base64url');
    bindTokens.add(t);
    return import('qrcode').then((mod) => {
      const QR = mod.default || mod;
      return QR.toBuffer('dshbind:' + t, { type: 'png', width: 320, margin: 2, color: { dark: '#15181f', light: '#ffffff' } });
    }).then((buf) => {
      res.setHeader('content-type', 'image/png');
      res.setHeader('cache-control', 'no-store');
      res.end(buf);
    }).catch(() => json(res, 500, { ok: false, error: { message: '二维码生成失败' } }));
  }

  // —— 设置/修改自定义密码（需已绑定设备）——
  if (p === '/api/auth/password' && req.method === 'POST') {
    const payload = verifyJwt(parseCookie(req));
    if (!payload) return json(res, 401, { ok: false, error: { code: 'unauthenticated', message: '请先绑定设备' } });
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      let pw = ''; try { pw = JSON.parse(body || '{}').password || ''; } catch (e) {}
      if (pw.length < 4 || pw.length > 64) return json(res, 400, { ok: false, error: { code: 'bad-password', message: '密码长度需 4~64 位' } });
      setDevicePassword(payload.sub, pw);
      return json(res, 200, { ok: true, value: { hasPassword: true } });
    });
    return;
  }

  // —— 密码解锁（设备会话过期后，输密码重新签发 cookie）——
  if (p === '/api/auth/unlock' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      let deviceId = '', pw = ''; try { const j = JSON.parse(body || '{}'); deviceId = j.deviceId || ''; pw = j.password || ''; } catch (e) {}
      if (!deviceId || !verifyDevicePassword(deviceId, pw)) {
        return json(res, 401, { ok: false, error: { code: 'bad-unlock', message: '设备或密码不正确' } });
      }
      const jwt = makeJwt({ sub: deviceId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TTL });
      res.setHeader('set-cookie', COOKIE + '=' + encodeURIComponent(jwt) + '; HttpOnly; Path=/;' + (req.headers.origin ? ' SameSite=None; Secure' : ' SameSite=Lax') + '; Max-Age=' + TTL);
      return json(res, 200, { ok: true, value: { deviceId } });
    });
    return;
  }

  // —— 解绑 ——
  if (p === '/api/auth/unbind' && req.method === 'POST') {
    res.setHeader('set-cookie', COOKIE + '=; HttpOnly; Path=/; Max-Age=0');
    return json(res, 200, { ok: true, value: {} });
  }

  // —— AI 笔记 / 语音闪念胶囊：VPS 先保存原话，再由 DSH 后台整理 ——
  if (p === '/api/notes/capsules' && req.method === 'POST') {
    const payload = verifyJwt(parseCookie(req));
    if (!payload) return json(res, 401, { ok: false, error: { code: 'unauthenticated', message: '请先绑定设备' } });
    return createNoteCapsule(req, res);
  }
  const capsuleRetry = p.match(/^\/api\/notes\/capsules\/([\w-]+)\/retry$/);
  if (capsuleRetry && req.method === 'POST') {
    const payload = verifyJwt(parseCookie(req));
    if (!payload) return json(res, 401, { ok: false, error: { code: 'unauthenticated', message: '请先绑定设备' } });
    return retryNoteCapsule(res, capsuleRetry[1]);
  }
  if (p === '/api/notes' && req.method === 'GET') {
    const payload = verifyJwt(parseCookie(req));
    if (!payload) return json(res, 401, { ok: false, error: { code: 'unauthenticated', message: '请先绑定设备' } });
    return serveNotesList(res);
  }
  if (p.startsWith('/api/notes/') && req.method === 'GET') {
    const payload = verifyJwt(parseCookie(req));
    if (!payload) return json(res, 401, { ok: false, error: { code: 'unauthenticated', message: '请先绑定设备' } });
    const name = decodeURIComponent(p.slice('/api/notes/'.length));
    return serveNoteRead(res, name);
  }

  // —— 图片代理：本机发图服务（ssa-chat-image-server 127.0.0.1:8791，经 frp 8792 隧道）——
  if (p.startsWith('/img/')) {
    const file = decodeURIComponent(p.slice('/img/'.length));
    return imgProxy(req, res, file);
  }

  // —— 监控数据：设备会话鉴权后代理本机 dashboard1，不向前端暴露 Basic Auth ——
  if (p.startsWith('/api/monitoring/')) {
    const payload = verifyJwt(parseCookie(req));
    if (!payload) return json(res, 401, { ok: false, error: { code: 'unauthenticated', message: '请先绑定设备' } });
    return monitoringProxy(req, res, url);
  }

  // —— 会话状态与后台通知账本（VPS 本地接口，不经过 DSH 反代）——
  if (p === '/api/notification/snapshot' && req.method === 'GET') {
    const payload = verifyJwt(parseCookie(req));
    if (!payload) return json(res, 401, { ok: false, error: { code: 'unauthenticated', message: '请先绑定设备' } });
    return json(res, 200, { ok: true, value: notificationLedger.snapshot(payload.sub) });
  }
  if (p === '/api/notification/events' && req.method === 'GET') {
    const payload = verifyJwt(parseCookie(req));
    if (!payload) return json(res, 401, { ok: false, error: { code: 'unauthenticated', message: '请先绑定设备' } });
    return serveNotificationEvents(req, res, payload.sub, url);
  }
  if (p === '/api/notification/read' && req.method === 'POST') {
    const payload = verifyJwt(parseCookie(req));
    if (!payload) return json(res, 401, { ok: false, error: { code: 'unauthenticated', message: '请先绑定设备' } });
    return markNotificationRead(req, res, payload.sub);
  }


  // —— 会话列表优先返回 VPS 最近一次通知对账缓存，避免手机重复穿透 FRP ——
  if (p === '/api/session.list' && req.method === 'POST' && cachedSessionList && Date.now() - cachedSessionListAt < 10 * 60 * 1000) {
    let body = ''; req.on('data', chunk => { if (body.length < 64 * 1024) body += chunk }); req.on('end', () => {
      let rpcId = ''; try { rpcId = JSON.parse(body || '{}').rpcId || '' } catch (e) {}
      return json(res, 200, { type: 'server-response', rpcId, result: { ok: true, value: cachedSessionList } });
    }); return;
  }

  // —— 手机端脱敏错误遥测：仅保存白名单字段，不接收聊天正文/请求正文/凭据 ——
  if (p === '/api/client-errors' && req.method === 'POST') {
    const payload = verifyJwt(parseCookie(req));
    if (!payload) return json(res, 401, { ok: false, error: { code: 'unauthenticated', message: '请先绑定设备' } });
    let body = ''; req.on('data', chunk => { if (body.length < 128 * 1024) body += chunk });
    req.on('end', () => {
      let events = []; try { events = JSON.parse(body || '{}').events || [] } catch (e) {}
      const accepted = clientErrorStore.ingest(payload.sub, events);
      forwardClientErrors(accepted)
      return json(res, 200, { ok: true, value: { accepted: accepted.length } });
    });
    return;
  }
  if (p === '/api/client-errors/incidents' && req.method === 'GET') {
    const payload = verifyJwt(parseCookie(req));
    if (!payload) return json(res, 401, { ok: false, error: { code: 'unauthenticated', message: '请先绑定设备' } });
    return json(res, 200, { ok: true, value: { items: clientErrorStore.list(Number(url.searchParams.get('limit') || 100)) } });
  }

  // —— 其余 /api/*：必须已绑定设备 ——
  if (p.startsWith('/api/')) {
    const payload = verifyJwt(parseCookie(req));
    if (!payload) return json(res, 401, { ok: false, error: { code: 'unauthenticated', message: '请先绑定设备' } });
    if (p === '/api/session.prompt' && req.method === 'POST') return promptProxy(req, res, url, payload.sub);
    return proxy(req, res, url);
  }

  // —— 受保护简历页：只有已绑定设备（合法 dsh_device Cookie）才能访问；公网裸访问 401 ——
  if (p === '/resume' || p === '/resume/' || p === '/resume/index.html') {
    const payload = verifyJwt(parseCookie(req));
    if (!payload) return json(res, 401, { ok: false, error: { code: 'unauthenticated', message: '未绑定设备' } });
    return serveResume(res);
  }

  // —— 静态资源（构建后的前端） ——
  return staticServe(req, res, p, url);
});

// ---------- AI 笔记：本地只读 ----------
function noteSummary(name) {
  const fp = path.join(NOTES_DIR, name);
  const st = statSync(fp);
  const content = readFileSync(fp, 'utf8');
  const capsule = parseCapsuleDocument(content, { name, updatedAt: st.mtimeMs, createdAt: st.birthtimeMs, size: st.size });
  if (capsule) {
    return {
      name,
      kind: 'capsule',
      id: capsule.id,
      title: capsule.title,
      category: capsule.category,
      tags: capsule.tags,
      status: capsule.status,
      createdAt: capsule.createdAt,
      updatedAt: capsule.updatedAt,
      size: st.size,
      error: capsule.error
    };
  }
  let title = name.replace(/\.md$/i, '');
  const head = content.split('\n').slice(0, 8).find(line => line.startsWith('# '));
  if (head) title = head.replace(/^#\s*/, '').trim();
  return { name, kind: 'note', title, category: '归档', tags: [], status: 'ready', createdAt: st.birthtimeMs, updatedAt: st.mtimeMs, size: st.size };
}

function serveNotesList(res) {
  let items = [];
  try {
    if (existsSync(NOTES_DIR)) {
      items = readdirSync(NOTES_DIR)
        .filter(name => name.toLowerCase().endsWith('.md'))
        .map(name => {
          try { return noteSummary(name); } catch (error) { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    }
  } catch (e) {
    return json(res, 500, { ok: false, error: { code: 'notes-read', message: String(e && e.message || e) } });
  }
  return json(res, 200, { ok: true, value: { items } });
}

function serveNoteRead(res, name) {
  // 防目录穿越：只允许纯文件名（不含路径分隔符），且必须以 .md 结尾
  const base = path.basename(name);
  if (base !== name || !/^[\w\u4e00-\u9fa5\-（）()\s]+\.md$/i.test(name)) {
    return json(res, 400, { ok: false, error: { code: 'bad-name', message: '非法笔记名' } });
  }
  const fp = path.join(NOTES_DIR, name);
  if (!fp.startsWith(NOTES_DIR)) return json(res, 400, { ok: false, error: { code: 'bad-name', message: '非法笔记名' } });
  let content = '';
  try { content = readFileSync(fp, 'utf8'); } catch (e) { return json(res, 404, { ok: false, error: { code: 'nf', message: '笔记不存在' } }); }
  const st = statSync(fp);
  const capsule = parseCapsuleDocument(content, { name, updatedAt: st.mtimeMs, createdAt: st.birthtimeMs, size: st.size });
  if (capsule) return json(res, 200, { ok: true, value: capsule });
  let title = name.replace(/\.md$/i, '');
  const head = content.split('\n').slice(0, 8).find(line => line.startsWith('# '));
  if (head) title = head.replace(/^#\s*/, '').trim();
  return json(res, 200, { ok: true, value: { name, kind: 'note', title, category: '归档', tags: [], status: 'ready', content, createdAt: st.birthtimeMs, updatedAt: st.mtimeMs } });
}

async function createNoteCapsule(req, res) {
  try {
    const body = await readJsonBody(req, 32 * 1024);
    const capsule = capsuleStore.create(body.transcript, body.requestId);
    if (capsule.status === 'processing') enqueueCapsule(capsule.id);
    return json(res, 202, { ok: true, value: capsule });
  } catch (error) {
    const tooLarge = error.message === 'body-too-large' || /12000/.test(error.message);
    return json(res, tooLarge ? 413 : 400, { ok: false, error: { code: 'capsule-create', message: error.message || '闪念保存失败' } });
  }
}

function retryNoteCapsule(res, id) {
  try {
    const capsule = capsuleStore.setProcessing(id);
    enqueueCapsule(capsule.id);
    return json(res, 202, { ok: true, value: capsule });
  } catch (error) {
    return json(res, 404, { ok: false, error: { code: 'capsule-not-found', message: '闪念不存在' } });
  }
}

function enqueueCapsule(id) {
  if (!id || capsuleQueued.has(id)) return;
  capsuleQueued.add(id);
  capsuleQueue.push(id);
  runCapsuleQueue();
}

async function ensureCapsuleSession() {
  if (capsuleSessionId) return capsuleSessionId;
  const sessions = await dshRpc('session.list', {});
  const found = (sessions?.items || []).find(session => session?.projections?.values?.title === CAPSULE_SESSION_TITLE);
  if (found?.sessionId) {
    capsuleSessionId = found.sessionId;
    return capsuleSessionId;
  }
  const created = await dshRpc('session.create', { title: CAPSULE_SESSION_TITLE, agentPreset: 'mobile', cwd: CAPSULE_CWD });
  if (!created?.sessionId) throw new Error('无法创建闪念整理会话');
  capsuleSessionId = created.sessionId;
  try { await dshRpc('session.rename', { sessionId: capsuleSessionId, title: CAPSULE_SESSION_TITLE }); } catch (error) {}
  return capsuleSessionId;
}

function historyMaxSeq(history) {
  return Math.max(0, ...(history?.events || []).map(item => Number((item?.event || item)?.seq || 0)));
}

async function refineCapsule(id) {
  const capsule = capsuleStore.readById(id);
  const sessionId = await ensureCapsuleSession();
  const before = await dshRpc('session.history', { sessionId, maxMessages: 8 });
  const afterSeq = historyMaxSeq(before);
  await dshRpc('session.prompt', {
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: buildCapsuleRefinementPrompt(capsule), clientHidden: true }],
    clientTimeZone: 'Asia/Shanghai'
  });
  const deadline = Date.now() + CAPSULE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, CAPSULE_POLL_MS));
    const history = await dshRpc('session.history', { sessionId, maxMessages: 16 });
    const message = latestAssistantText(history, afterSeq);
    if (!message) continue;
    try {
      const result = parseCapsuleAiResult(message.text, id, capsule.revision);
      return capsuleStore.complete(id, result, capsule.revision);
    } catch (parseError) {
      // 复用会话在重启后可能先补回上一条结果；只接受当前闪念 id，继续等待本条最终 JSON。
      if (/错误的闪念编号|错误的任务版本|未返回 JSON|无法解析/.test(parseError.message || '')) continue;
      throw parseError;
    }
  }
  throw new Error('AI 整理超时，可稍后重试');
}

async function runCapsuleQueue() {
  if (capsuleWorkerRunning) return;
  capsuleWorkerRunning = true;
  try {
    while (capsuleQueue.length) {
      const id = capsuleQueue.shift();
      let revision;
      try { revision = capsuleStore.readById(id).revision; } catch (error) {}
      try { await refineCapsule(id); }
      catch (error) {
        console.warn('[dsh-mobile] 闪念整理失败', id, error.message);
        try { capsuleStore.fail(id, error, revision); } catch (writeError) {}
        if (/session|DSH|会话/i.test(error.message || '')) capsuleSessionId = '';
      } finally { capsuleQueued.delete(id); }
    }
  } finally {
    capsuleWorkerRunning = false;
    if (capsuleQueue.length) runCapsuleQueue();
  }
}

function resumePendingCapsules() {
  try {
    for (const capsule of capsuleStore.list()) {
      if (capsule.status !== 'processing') continue;
      const resumed = capsuleStore.setProcessing(capsule.id);
      enqueueCapsule(resumed.id);
    }
  } catch (error) {
    console.warn('[dsh-mobile] 无法恢复待整理闪念:', error.message);
  }
}

// ---------- 图片代理（本机发图服务，经 frp 8792） ----------
function imgProxy(req, res, file) {
  const opts = {
    method: req.method,
    hostname: '127.0.0.1',
    port: 8792,
    path: '/' + file,
    headers: { ...req.headers, host: '127.0.0.1:8792' }
  };
  const up = http.request(opts, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  up.on('error', (e) => { if (!res.headersSent) res.writeHead(502); res.end('img gateway error'); });
  req.pipe(up);
}

// ---------- 监控仪表盘代理（设备会话鉴权后访问本机 dashboard1） ----------
function readEnvValue(text, name) {
  const line = text.split(/\r?\n/).find(item => item.startsWith(name + '='));
  if (!line) return '';
  let value = line.slice(name.length + 1).trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    value = value.slice(1, -1);
  }
  return value.replace(/'"'"'/g, "'");
}

function monitoringProxy(req, res, url) {
  const routes = {
    '/api/monitoring/latest': { method: 'GET', path: '/api/metrics/latest' },
    '/api/monitoring/history': { method: 'GET', path: '/api/metrics/history' + (url.search || '') },
    '/api/monitoring/collect': { method: 'POST', path: '/api/collect' }
  };
  const route = routes[url.pathname];
  if (!route) return json(res, 404, { ok: false, error: { code: 'nf', message: '监控接口不存在' } });
  if (req.method !== route.method) return json(res, 405, { ok: false, error: { code: 'method', message: '请求方法不允许' } });

  let envText = '';
  try { envText = readFileSync(DASHBOARD_ENV, 'utf8'); }
  catch (e) { return json(res, 503, { ok: false, error: { code: 'dashboard-config', message: '监控服务配置不可用' } }); }
  const username = readEnvValue(envText, 'DASHBOARD_USERNAME');
  const password = readEnvValue(envText, 'DASHBOARD_PASSWORD');
  if (!username || !password) return json(res, 503, { ok: false, error: { code: 'dashboard-auth', message: '监控服务认证未配置' } });

  const target = new URL(DASHBOARD);
  const headers = {
    authorization: 'Basic ' + Buffer.from(username + ':' + password).toString('base64'),
    accept: 'application/json',
    host: target.host
  };
  if (req.method === 'POST') headers['content-length'] = '0';
  const up = http.request({
    method: route.method,
    hostname: target.hostname,
    port: target.port,
    path: route.path,
    headers
  }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, {
      'content-type': upRes.headers['content-type'] || 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    });
    upRes.pipe(res);
  });
  up.on('error', () => {
    if (!res.headersSent) return json(res, 502, { ok: false, error: { code: 'dashboard-offline', message: '监控服务暂不可用' } });
    res.end();
  });
  up.end();
}

// ---------- 会话状态账本与原生后台通知 ----------
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > limit) reject(new Error('body-too-large'));
      else chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function serveNotificationEvents(req, res, deviceId, url) {
  const after = Math.max(0, Number(url.searchParams.get('after') || 0));
  const wait = Math.min(25000, Math.max(0, Number(url.searchParams.get('wait') || 0)));
  const send = () => {
    if (res.writableEnded || res.destroyed) return;
    cleanup();
    json(res, 200, { ok: true, value: notificationLedger.eventsAfter(deviceId, after) });
  };
  let timer = null;
  const wake = () => send();
  const cleanup = () => {
    notificationWaiters.delete(wake);
    if (timer) clearTimeout(timer);
  };
  const current = notificationLedger.eventsAfter(deviceId, after);
  if (current.events.length || current.reset || wait === 0) return json(res, 200, { ok: true, value: current });
  notificationWaiters.add(wake);
  timer = setTimeout(send, wait);
  req.on('close', cleanup);
}

async function markNotificationRead(req, res, deviceId) {
  try {
    const body = await readJsonBody(req);
    const acknowledgements = Array.isArray(body.acknowledgements) ? body.acknowledgements : [body.acknowledgement];
    notificationLedger.markRead(deviceId, acknowledgements);
    return json(res, 200, { ok: true, value: notificationLedger.snapshot(deviceId) });
  } catch (error) {
    return json(res, error.message === 'body-too-large' ? 413 : 400, { ok: false, error: { code: 'bad-request', message: '已读请求格式错误' } });
  }
}

async function dshRpc(method, payload = {}) {
  const response = await fetch(new URL('/api/' + method, DSH), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }),
    signal: AbortSignal.timeout(15000)
  });
  const envelope = await response.json();
  if (!response.ok || !envelope?.result?.ok) throw new Error(envelope?.result?.error?.message || 'DSH RPC ' + response.status);
  return envelope.result.value;
}

async function mapConcurrent(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

let notificationUpstreamOnline = null;
let cachedSessionList = null;
let cachedSessionListAt = 0;
async function reconcileNotificationLedger() {
  try {
    const value = await dshRpc('session.list', {});
    cachedSessionList = value; cachedSessionListAt = Date.now();
    const items = value?.items || [];
    await mapConcurrent(items, 6, async session => {
      const title = session?.projections?.values?.title || session?.projections?.values?.sessionListMetadata?.title || '新会话';
      // 闪念整理会话只负责后台返回结构化 JSON，不进入普通聊天通知与未读计数。
      if (title === CAPSULE_SESSION_TITLE) return;
      const previous = notificationLedger.state.sessions[session.sessionId];
      if (session.running) {
        notificationLedger.setRunning(session);
        return;
      }
      const needsHistory = !previous || previous.status === 'running' || Number(session.updatedAt || 0) > Number(previous.updatedAt || 0) || previous.title !== title;
      if (!needsHistory) return;
      try {
        const history = await dshRpc('session.history', { sessionId: session.sessionId, maxMessages: 24 });
        const terminal = latestTurnEnd(history);
        if (terminal) notificationLedger.setTerminal(session, terminal, { baseline: !previous });
        else notificationLedger.setIdle(session);
      } catch (error) {
        if (!previous) notificationLedger.setIdle(session);
      }
    });
    if (notificationUpstreamOnline === false) console.log('[dsh-mobile] 通知账本已重新连接 DSH');
    notificationUpstreamOnline = true;
  } catch (error) {
    if (notificationUpstreamOnline !== false) console.warn('[dsh-mobile] 通知账本暂时无法连接 DSH:', error.message);
    notificationUpstreamOnline = false;
  }
}

function startNotificationPoller() {
  const tick = async () => {
    await reconcileNotificationLedger();
    if (!notificationPollStopped) notificationPollTimer = setTimeout(tick, NOTIFICATION_POLL_MS);
  };
  tick();
}

// ---------- session.prompt 幂等反代 ----------
function promptProxyHeaders(req, target, bodyLength) {
  const headers = { ...req.headers };
  for (const name of ['origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'host', 'cookie', 'connection', 'transfer-encoding']) delete headers[name];
  headers.host = target.host;
  headers['content-length'] = String(bodyLength);
  return headers;
}

function replayPromptResponse(res, record, replayed = false) {
  if (res.writableEnded || res.destroyed) return;
  const headers = { ...record.headers, 'cache-control': 'no-store' };
  delete headers.connection; delete headers['transfer-encoding'];
  if (replayed) headers['x-dsh-mobile-replayed'] = '1';
  res.writeHead(record.statusCode, headers);
  res.end(record.body);
}

function prunePromptReplays(now = Date.now()) {
  for (const [key, record] of promptReplays) {
    if (record.state === 'done' && record.expiresAt <= now) promptReplays.delete(key);
  }
}

function forwardPromptBody(req, res, url, body, replayKey = '') {
  const target = new URL(DSH);
  const waiters = [res];
  const record = replayKey ? { state: 'pending', waiters } : null;
  if (record) promptReplays.set(replayKey, record);
  const up = http.request({
    method: 'POST', hostname: target.hostname, port: target.port,
    path: url.pathname + (url.search || ''), headers: promptProxyHeaders(req, target, body.length)
  }, (upRes) => {
    const chunks = [];
    upRes.on('data', chunk => chunks.push(chunk));
    upRes.on('end', () => {
      const response = {
        state: 'done', statusCode: upRes.statusCode || 502,
        headers: { ...upRes.headers }, body: Buffer.concat(chunks),
        expiresAt: Date.now() + PROMPT_REPLAY_TTL
      };
      if (record) {
        promptReplays.set(replayKey, response);
        for (const waiter of record.waiters) replayPromptResponse(waiter, response, waiter !== res);
      } else replayPromptResponse(res, response);
    });
  });
  up.setTimeout(30000, () => up.destroy(new Error('prompt upstream timeout')));
  up.on('error', (error) => {
    if (record) promptReplays.delete(replayKey);
    const targets = record ? record.waiters : waiters;
    for (const waiter of targets) {
      if (!waiter.writableEnded && !waiter.destroyed) json(waiter, 502, { ok: false, error: { code: 'gateway', message: 'gateway error: ' + error.message } });
    }
  });
  up.end(body);
}

function promptProxy(req, res, url, deviceId) {
  const chunks = [];
  let bytes = 0;
  let tooLarge = false;
  req.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > PROMPT_BODY_LIMIT) tooLarge = true;
    else chunks.push(chunk);
  });
  req.on('end', () => {
    if (tooLarge) return json(res, 413, { ok: false, error: { code: 'body-too-large', message: '消息附件超过网关限制' } });
    const body = Buffer.concat(chunks);
    let envelope = null;
    try { envelope = JSON.parse(body.toString('utf8')); } catch (e) {}
    if (!envelope || envelope.method !== 'session.prompt' || typeof envelope.rpcId !== 'string' || !envelope.rpcId) {
      return forwardPromptBody(req, res, url, body);
    }
    prunePromptReplays();
    const key = String(deviceId) + ':' + envelope.rpcId;
    const existing = promptReplays.get(key);
    if (existing?.state === 'done' && existing.expiresAt > Date.now()) return replayPromptResponse(res, existing, true);
    if (existing?.state === 'pending') { existing.waiters.push(res); return; }
    return forwardPromptBody(req, res, url, body, key);
  });
  req.on('error', () => { if (!res.writableEnded) json(res, 400, { ok: false, error: { code: 'request-read', message: '消息读取失败' } }); });
}

// ---------- 其余请求反代到 DSH ----------
function proxy(req, res, url) {
  const target = new URL(DSH);
  // 只保留转发必需的头；清掉浏览器同源/跨站标记与前端 auth cookie
  const headers = { ...req.headers };
  delete headers['origin']; delete headers['referer'];
  delete headers['sec-fetch-site']; delete headers['sec-fetch-mode']; delete headers['sec-fetch-dest'];
  delete headers['host']; delete headers['cookie']; delete headers['connection'];
  headers['host'] = target.host; // loopback host，DSH 信任 fence 接受
  const upstreamPath = url.pathname + (url.search || '');
  const opts = {
    method: req.method,
    hostname: target.hostname,
    port: target.port,
    path: upstreamPath,
    headers
  };
  const up = http.request(opts, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res); // SSE 流式透传
  });
  up.on('error', (e) => { if (!res.headersSent) res.writeHead(502); res.end('gateway error: ' + e.message); });
  req.pipe(up);
}

// ---------- 受保护简历页（只有已绑定设备能访问，公网裸访问 401） ----------
const RESUME_DIR = process.env.MOBILE_RESUME_DIR || path.join(__dirname, '..', 'resume');
function serveResume(res) {
  // 防目录穿越：只服务 resume 目录下的 index.html
  const fp = path.join(RESUME_DIR, 'index.html');
  if (!fp.startsWith(RESUME_DIR)) return json(res, 404, { ok: false, error: { code: 'nf' } });
  let data;
  try { data = readFileSync(fp); }
  catch (e) { return json(res, 404, { ok: false, error: { code: 'resume-nf', message: '简历尚未部署' } }); }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store'  // 简历更新频繁，不做缓存
  });
  res.end(data);
}

// ---------- 静态托管（SPA 构建产物） ----------
const DIST = path.join(__dirname, '..', 'web', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function staticServe(req, res, pathname, url) {
  // 哈希路由的 SPA：非文件资源一律回 index.html
  let f = pathname === '/' ? 'index.html' : pathname;
  let fp = path.join(DIST, f);
  if (!fp.startsWith(DIST)) return json(res, 404, { ok: false, error: { code: 'nf' } });
  let data;
  let ext;
  try { data = readFileSync(fp); ext = path.extname(fp); } catch (e) {
    // SPA fallback：返回 index.html，且类型必须按 html（否则浏览器会当二进制提示下载）
    try { data = readFileSync(path.join(DIST, 'index.html')); ext = '.html'; } catch (e2) { return json(res, 404, { ok: false, error: { code: 'no-dist', message: '前端尚未构建' } }); }
  }
  const headers = { 'content-type': MIME[ext] || 'application/octet-stream' };
  // .apk 等安装包：强制浏览器下载（Content-Disposition: attachment），避免白屏
  if (ext === '.apk') {
    headers['content-disposition'] = 'attachment; filename="' + path.basename(fp) + '"';
  }
  // 带 hash 的静态资源 → 永久缓存；index.html、sw.js 等入口 → 每次校验（保证手机拿到最新版，SW 不能被 immutable 卡住）
  const isAsset = pathname.startsWith('/assets/') || (['.css', '.woff2', '.png', '.jpg', '.svg', '.ico'].includes(ext) && pathname !== '/sw.js');
  headers['cache-control'] = isAsset ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, headers);
  res.end(data);
}


// ---------- WebSocket Upgrade 代理（events.mux / events.host 走 WS） ----------
server.on('upgrade', (req, socket, head) => {
  // 手机网络切换时客户端 Socket 可能先于握手断开；必须消费 error，不能让网关进程因 ECONNRESET 退出。
  socket.on('error', () => socket.destroy());
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { socket.destroy(); return; }
  if (!url.pathname.startsWith('/api/')) { socket.destroy(); return; }
  const isSpeech = url.pathname === '/api/speech/stream';
  // 语音流只接受 HttpOnly 设备 Cookie，禁止把 JWT 放进 URL/代理日志。其他 WS 保留历史 token 兼容。
  const jwt = parseCookie(req) || (isSpeech ? '' : (url.searchParams.get('token') || ''));
  if (!verifyJwt(jwt)) { try { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); } catch (e) {} socket.destroy(); return; }
  if (isSpeech) { SPEECH.handleUpgrade(req, socket, head); return; }
  const target = new URL(DSH);
  const headers = { ...req.headers };
  for (const k of ['host', 'cookie', 'origin', 'referer', 'connection', 'upgrade', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']) delete headers[k];
  headers['host'] = target.host;
  headers['connection'] = 'Upgrade';
  headers['upgrade'] = req.headers.upgrade || 'websocket';
  const up = http.request({ method: req.method, hostname: target.hostname, port: target.port, path: url.pathname + (url.search || ''), headers });
  up.on('upgrade', (upRes, upSock, upHead) => {
    const raw = upRes.rawHeaders || [];
    let h = 'HTTP/1.1 101 Switching Protocols\r\n';
    for (let i = 0; i < raw.length; i += 2) { const k = raw[i], v = raw[i + 1]; if (k && v) h += k + ': ' + v + '\r\n'; }
    h += '\r\n';
    try { socket.write(h); } catch (e) { upSock.destroy(); return; }
    if (upHead && upHead.length) try { upSock.write(upHead); } catch (e) {}
    upSock.pipe(socket); socket.pipe(upSock);
    socket.on('close', () => upSock.destroy());
    upSock.on('close', () => socket.destroy());
    upSock.on('error', () => socket.destroy());
  });
  up.on('response', () => socket.destroy());
  up.on('error', () => socket.destroy());
  up.end();
});

// ---------- CLI：生成一次性令牌（在 listen 前干净退出，避免与 systemd 实例端口冲突） ----------
if (process.argv[2] === '--gen-token') {
  const t = 'mob-' + crypto.randomBytes(9).toString('base64url');
  let cur = [];
  const tf = path.join(__dirname, 'tokens.json');
  if (existsSync(tf)) { try { cur = JSON.parse(readFileSync(tf, 'utf8')).tokens || []; } catch (e) {} }
  cur.push(t);
  writeFileSync(tf, JSON.stringify({ tokens: cur }, null, 2) + '\n', 'utf8');
  console.log('生成的一次性令牌: ' + t);
  console.log('（写入了 tokens.json；用后即焚，仅可用一次）');
  process.exit(0);
}

startNotificationPoller();

server.listen(PORT, HOST, () => {
  resumePendingCapsules();
  console.log('[dsh-mobile] gateway http://' + HOST + ':' + PORT + '  → DSH ' + DSH);
  console.log('[dsh-mobile] 可用一次性绑定令牌: ' + [...bindTokens].join(', '));
  if (!process.env.MOBILE_BIND_CODE) console.log('[dsh-mobile] 万能授权码(未配置 MOBILE_BIND_CODE，本次进程随机生成): ' + MASTER);
});

