import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/ConnectionStatus.jsx', import.meta.url), 'utf8')

test('跨源链路探测携带凭据并校验 HTTP 状态', () => {
  const credentialOptions = source.match(/credentials: 'include'/g) || []
  assert.equal(credentialOptions.length, 1)
  assert.match(source, /if \(!res\.ok\) throw new Error/)
  assert.match(source, /api\/link\/gateway/)
  assert.match(source, /api\/link\/dsh/)
})

test('链路探测无论成功失败都会清除超时定时器', () => {
  const finallyClears = source.match(/finally \{ clearTimeout\(timer\) \}/g) || []
  assert.equal(finallyClears.length, 1)
})

test('正式远程页面的状态探针固定使用当前网关 origin', () => {
  assert.match(source, /getHealthProbeBase/)
  assert.match(source, /healthBase \+ '\/api\/link\/gateway/)
  assert.match(source, /healthBase \+ '\/api\/link\/dsh/)
  assert.doesNotMatch(source, /fetch\(getServerUrl\(\) \+ '\/api\/link/)
})
