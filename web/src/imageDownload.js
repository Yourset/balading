// 图片下载辅助：文件名推断、Blob 转换、系统分享检测与兜底下载。
// 纯函数为主（便于 node --test 直接测试）；浏览器相关能力独立封装，可被 mock。

export const DEFAULT_IMAGE_NAME = 'image'

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif'
}

/** MIME → 文件扩展名；未知类型回退 png */
export function extFromMime(mime) {
  return MIME_EXT[(mime || '').toLowerCase()] || 'png'
}

/**
 * 从 URL 推断可下载文件名（去 query/hash、取最后一段）。
 * 解析失败或无扩展名时回退为带时间戳的默认名，保证 download 属性可用。
 */
export function fileNameFromUrl(url, mime) {
  try {
    const u = new URL(url, 'http://local.invalid')
    const last = u.pathname.split('/').pop() || ''
    const name = decodeURIComponent(last)
    if (name && name.includes('.')) return name
  } catch (e) { /* 非法 URL 走回退 */ }
  return DEFAULT_IMAGE_NAME + '_' + Date.now() + '.' + extFromMime(mime)
}

/**
 * base64 data URL → { blob, mime }。
 * 支持 `data:image/png;base64,....` 形式；解析失败时按 image/png 兜底。
 */
export function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',')
  const head = comma >= 0 ? dataUrl.slice(0, comma) : ''
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return { blob: new Blob([arr], { type: mime }), mime }
}

/** 当前环境是否支持「分享文件」（Android WebView / Chrome 支持 Web Share Level 2） */
export function canShareFiles() {
  return typeof navigator !== 'undefined' && !!navigator.canShare && !!navigator.share
}

/** fetch 图片为 Blob（跨源需服务端 CORS；/img/ 同源不受限） */
export async function fetchBlob(url) {
  const r = await fetch(url, { mode: 'cors' })
  if (!r.ok) throw new Error('下载失败（' + r.status + '）')
  return r.blob()
}

/**
 * 锚点兜底下载：object URL + <a download>。
 * 返回生成的 URL（调用方负责 revoke）。
 */
export function anchorDownload(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  return url
}
