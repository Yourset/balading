import { writeFileSync } from 'node:fs'

const endpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9224'
const outputMobile = process.argv[2]
const outputDesktop = process.argv[3]
const outputMobileBottom = process.argv[4]
const bindCode = process.env.MOBILE_BIND_CODE
if (!outputMobile || !outputDesktop || !bindCode) throw new Error('missing screenshot paths or mobile bind code')

const pages = await fetch(endpoint + '/json/list').then(response => response.json())
const page = pages.find(item => item.type === 'page')
if (!page) throw new Error('no Chrome page target')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
let id = 0
const pending = new Map()
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (!message.id || !pending.has(message.id)) return
  const { resolve, reject } = pending.get(message.id)
  pending.delete(message.id)
  message.error ? reject(new Error(message.error.message)) : resolve(message.result)
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id
  pending.set(requestId, { resolve, reject })
  ws.send(JSON.stringify({ id: requestId, method, params }))
})
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const screenshot = async (file) => {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(file, Buffer.from(result.data, 'base64'))
}

await send('Page.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await send('Page.navigate', { url: 'https://m.example.com/' })
await wait(1800)
const bindExpression = `fetch('/api/auth/device-bind',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:${JSON.stringify(bindCode)}})}).then(r=>r.json())`
const bind = await send('Runtime.evaluate', { expression: bindExpression, awaitPromise: true, returnByValue: true })
if (!bind.result || !bind.result.value || !bind.result.value.ok) throw new Error('mobile device bind failed')
await send('Page.navigate', { url: 'https://m.example.com/?visual=' + Date.now() + '#/monitor' })
await wait(2500)
await screenshot(outputMobile)
if (outputMobileBottom) {
  await send('Runtime.evaluate', { expression: "const el=document.querySelector('.scroll');if(el)el.scrollTop=el.scrollHeight" })
  await wait(600)
  await screenshot(outputMobileBottom)
}

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
const dashboardAuth = process.env.DASHBOARD_BASIC_AUTH // 形如 user:pass，由运行者自行提供，不入库
if (dashboardAuth) await send('Network.setExtraHTTPHeaders', { headers: { Authorization: 'Basic ' + Buffer.from(dashboardAuth).toString('base64') } })
await send('Page.navigate', { url: 'https://dashboard.example.com/' })
await wait(2500)
await screenshot(outputDesktop)
console.log(JSON.stringify({ mobile: outputMobile, desktop: outputDesktop }))
ws.close()
