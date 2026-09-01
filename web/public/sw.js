// dsh-mobile Service Worker
// 静态 hash 资源使用 cache-first；页面入口使用 network-first，确保热更新后重新打开即可拿到新版。
const VERSION = 'v31'
const ASSET_CACHE = 'dsh-assets-' + VERSION
const API_CACHE = 'dsh-api-' + VERSION

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== ASSET_CACHE && key !== API_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

function cacheKey(request) {
  if (request.method === 'POST') {
    return request.clone().text().then((body) => request.method + ' ' + request.url + ' ' + body)
  }
  return Promise.resolve(request.method + ' ' + request.url)
}

const SWR_API = /\/api\/session\.(list|history|search)$/

function fetchAndCache(request) {
  return fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone()
      caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy))
    }
    return response
  })
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  let url
  try { url = new URL(request.url) } catch (error) { return }
  if (url.origin !== location.origin) return
  const path = url.pathname

  // 版本清单必须直连网络，供旧页面在恢复前台时判断是否需要整页刷新。
  if (request.method === 'GET' && path === '/version.json') {
    event.respondWith(fetch(request, { cache: 'no-store' }))
    return
  }

  if (request.method === 'GET' && path.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then((hit) => hit || fetchAndCache(request)))
    return
  }

  if (request.method === 'GET' && (request.mode === 'navigate' || path === '/' || path === '/index.html')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) caches.open(ASSET_CACHE).then((cache) => cache.put('/index.html', response.clone()))
          return response
        })
        .catch(() => caches.match('/index.html').then((hit) => hit || Response.error()))
    )
    return
  }

  if (request.method === 'POST' && path === '/api/session.attachment') {
    event.respondWith(
      cacheKey(request).then((key) =>
        caches.open(API_CACHE).then((cache) =>
          cache.match(key).then((hit) => hit || fetch(request).then((response) => {
            if (response.ok) cache.put(key, response.clone())
            return response
          }))
        )
      ).catch(() => fetch(request))
    )
    return
  }

  // session.list 已由 VPS 维护短期缓存；浏览器直接请求，避免按 rpcId 重复写入大型响应。
  if (request.method === 'POST' && path === '/api/session.list') {
    event.respondWith(fetch(request))
    return
  }

  if (request.method === 'POST' && SWR_API.test(path)) {
    event.respondWith(
      cacheKey(request).then((key) =>
        caches.open(API_CACHE).then(async (cache) => {
          const hit = await cache.match(key)
          if (hit) {
            fetch(request).then((response) => { if (response.ok) cache.put(key, response.clone()) }).catch(() => {})
            return hit
          }
          const response = await fetch(request)
          if (response.ok) cache.put(key, response.clone())
          return response
        })
      ).catch(() => fetch(request))
    )
    return
  }

  if (request.method === 'GET') {
    event.respondWith(fetch(request).catch(() => caches.match(request)))
  }
})
