import { readImageMetadata } from './imageMetadata.js'

// DSH 图片块当前限制；压缩目标稍低于硬上限，为 Base64/RPC 封装留余量。
export const IMAGE_MAX_BYTES = 3500000
export const IMAGE_TARGET_BYTES = 3200000
export const IMAGE_MAX_DIMENSION = 2000
export const IMAGE_MAX_PIXELS = 40000000

const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const FALLBACK_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

export function imageMediaType(file) {
  const extension = String(file?.name || '').split('.').pop().toLowerCase()
  return file?.type || FALLBACK_TYPES[extension] || ''
}

export function fitImageDimensions(width, height, maxDimension = IMAGE_MAX_DIMENSION) {
  const safeWidth = Math.max(1, Number(width) || 1)
  const safeHeight = Math.max(1, Number(height) || 1)
  const scale = Math.min(1, maxDimension / Math.max(safeWidth, safeHeight))
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale))
  }
}

export function shouldCompressImage({ size, width, height }) {
  return Number(size) > IMAGE_MAX_BYTES
    || Number(width) > IMAGE_MAX_DIMENSION
    || Number(height) > IMAGE_MAX_DIMENSION
    || Number(width) * Number(height) > IMAGE_MAX_PIXELS
}

function fileToData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}

function loadImage(file) {
  const url = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ image, url, width: image.naturalWidth || 0, height: image.naturalHeight || 0 })
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解码失败')) }
    image.src = url
  })
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片压缩失败')), 'image/jpeg', quality)
  })
}

function compressedName(name) {
  const base = String(name || 'image').replace(/\.[^.]+$/, '') || 'image'
  return `${base}-compressed.jpg`
}

async function encodeReadableJpeg(image, initialWidth, initialHeight) {
  let width = initialWidth
  let height = initialHeight
  let quality = 0.92
  let blob = null

  // 优先保留 2000px 清晰度并逐步降质量；仍超限时才继续缩尺寸。
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('当前设备不支持图片压缩')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    blob = await canvasBlob(canvas, quality)
    if (blob.size <= IMAGE_TARGET_BYTES) return { blob, width, height, quality }

    if (quality > 0.56) {
      quality = Math.max(0.56, quality - 0.09)
    } else {
      if (Math.max(width, height) <= 640) break
      width = Math.max(1, Math.round(width * 0.85))
      height = Math.max(1, Math.round(height * 0.85))
      quality = 0.84
    }
  }

  if (!blob || blob.size > IMAGE_MAX_BYTES) throw new Error('图片自动压缩后仍超过发送限制')
  return { blob, width, height, quality }
}

export async function prepareImageAttachment(file) {
  const mediaType = imageMediaType(file)
  if (!SUPPORTED_TYPES.has(mediaType)) throw new Error('仅支持 JPG、PNG、WebP、GIF 图片')

  const loaded = await loadImage(file)
  try {
    const { image, width, height } = loaded
    const buffer = await file.arrayBuffer()
    const metadata = readImageMetadata(buffer, mediaType)
    const original = {
      originalName: file.name || 'image', originalSize: file.size,
      originalWidth: width, originalHeight: height, originalMediaType: mediaType
    }

    if (!shouldCompressImage({ size: file.size, width, height })) {
      return {
        data: await fileToData(file), mediaType, name: file.name || 'image',
        size: file.size, width, height, lastModified: file.lastModified,
        compressed: false, ...original, ...metadata
      }
    }

    if (mediaType === 'image/gif') throw new Error('超限 GIF 为避免丢失动画暂不自动压缩，请改发截图')
    const fitted = fitImageDimensions(width, height)
    const encoded = await encodeReadableJpeg(image, fitted.width, fitted.height)
    return {
      data: await fileToData(encoded.blob), mediaType: 'image/jpeg', name: compressedName(file.name),
      size: encoded.blob.size, width: encoded.width, height: encoded.height,
      lastModified: file.lastModified, compressed: true, quality: encoded.quality,
      ...original, ...metadata
    }
  } finally {
    URL.revokeObjectURL(loaded.url)
  }
}
