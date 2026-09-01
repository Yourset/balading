import test from 'node:test'
import assert from 'node:assert/strict'
import { reportTelemetry, sanitizeTelemetry } from '../src/telemetry.js'

test('遥测脱敏 URL、Windows 路径和凭据', () => {
  const event = sanitizeTelemetry({ type: 'window-error', route: '#/chat/session-secret', message: 'token=abc123 cookie=xyz password=hunter2 at C:\\Users\\secret\\file.txt https://example.com/path?q=private' })
  assert.doesNotMatch(event.message, /abc123|xyz|hunter2|Users|private/)
  assert.match(event.message, /\[redacted\]/)
  assert.match(event.message, /\[path\]/)
  assert.match(event.message, /\[url\]/)
  assert.equal(Object.hasOwn(event, 'content'), false)
})

test('遥测只保留白名单诊断字段', () => {
  const event = sanitizeTelemetry({ type: 'slow-rpc', method: 'session.list', durationMs: 2345, content: '聊天正文', token: 'secret' })
  assert.deepEqual(Object.keys(event).sort(), ['durationMs','id','message','method','online','route','status','time','type','version'].sort())
})

test('相同慢请求在冷却窗口内只入队一次', () => {
  assert.equal(reportTelemetry({ type: 'slow-rpc', method: 'session.history', route: '#/test', durationMs: 2000 }), true)
  assert.equal(reportTelemetry({ type: 'slow-rpc', method: 'session.history', route: '#/test', durationMs: 3000 }), false)
  assert.equal(reportTelemetry({ type: 'rpc-error', method: 'session.history', route: '#/test', message: 'failed' }), true)
})

test('前台恢复会检查 SW 与独立版本清单', async () => {
  const { readFile } = await import('node:fs/promises')
  const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8')
  const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
  const manifest = JSON.parse(await readFile(new URL('../public/version.json', import.meta.url), 'utf8'))
  const versionSource = await readFile(new URL('../src/version.js', import.meta.url), 'utf8')
  const appVersion = versionSource.match(/APP_VERSION = '([^']+)'/)?.[1]
  assert.match(main, /\(await registrationPromise\)\?\.update\(\)/)
  assert.match(main, /fetch\('\/version\.json\?t='/)
  assert.match(main, /deployed\.version !== APP_VERSION/)
  assert.match(main, /visibilitychange/)
  assert.match(sw, /path === '\/version\.json'[\s\S]*cache: 'no-store'/)
  assert.match(sw, /path === '\/api\/session\.list'[\s\S]*event\.respondWith\(fetch\(request\)\)/)
  assert.equal(manifest.version, appVersion)
})
