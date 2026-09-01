import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pid = execFileSync('pgrep', ['-n', '-f', '/opt/dsh-mobile/server/index.mjs'], { encoding: 'utf8' }).trim()
const env = Object.fromEntries(readFileSync('/proc/' + pid + '/environ', 'utf8').split('\0').filter(Boolean).map(line => {
  const at = line.indexOf('=')
  return [line.slice(0, at), line.slice(at + 1)]
}))
if (!env.MOBILE_SIGNING_SECRET) throw new Error('mobile signing secret unavailable')
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const head = b64({ alg: 'HS256', typ: 'JWT' })
const body = b64({ sub: 'monitor-validation', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 })
const signature = crypto.createHmac('sha256', env.MOBILE_SIGNING_SECRET).update(head + '.' + body).digest('base64url')
const response = await fetch('http://127.0.0.1:8788/api/monitoring/latest', {
  headers: { cookie: 'dsh_device=' + head + '.' + body + '.' + signature }
})
const payload = await response.json()
const statuses = Object.fromEntries((payload.data || []).map(row => [row.source, row.status]))
console.log(JSON.stringify({ http: response.status, statuses }))
const expected = ['tencent-traffic', 'deepseek-balance', 'glm-quota', 'codex-quota', 'volc-speech']
if (response.status !== 200 || expected.some(source => statuses[source] !== 'ok')) process.exit(1)
