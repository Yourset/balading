const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0, 0]

function bytesMatch(view, offset, bytes) {
  if (offset < 0 || offset + bytes.length > view.byteLength) return false
  return bytes.every((value, index) => view.getUint8(offset + index) === value)
}

function parseExifDate(value) {
  const text = String(value || '').replace(/\0+$/, '').trim()
  const match = text.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/)
  if (!match) return text || null
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`
}

function parseTiff(view, start) {
  if (start < 0 || start + 8 > view.byteLength) return null
  const order = String.fromCharCode(view.getUint8(start), view.getUint8(start + 1))
  const little = order === 'II'
  if (!little && order !== 'MM') return null
  const u16 = offset => view.getUint16(offset, little)
  const u32 = offset => view.getUint32(offset, little)
  if (u16(start + 2) !== 42) return null

  const readAscii = (entry, count) => {
    const valueOffset = count <= 4 ? entry + 8 : start + u32(entry + 8)
    if (count < 1 || valueOffset < 0 || valueOffset + count > view.byteLength) return null
    let value = ''
    for (let index = 0; index < count; index += 1) value += String.fromCharCode(view.getUint8(valueOffset + index))
    return value.replace(/\0+$/, '').trim() || null
  }

  const readIfd = offset => {
    if (offset < start || offset + 2 > view.byteLength) return []
    const count = u16(offset)
    const entries = []
    for (let index = 0; index < count; index += 1) {
      const entry = offset + 2 + index * 12
      if (entry + 12 > view.byteLength) break
      entries.push({ entry, tag: u16(entry), type: u16(entry + 2), count: u32(entry + 4) })
    }
    return entries
  }

  const ifd0Offset = start + u32(start + 4)
  const ifd0 = readIfd(ifd0Offset)
  const exifPointer = ifd0.find(item => item.tag === 0x8769)
  const exifIfd = exifPointer ? readIfd(start + u32(exifPointer.entry + 8)) : []
  const candidates = [
    { tag: 0x9003, label: 'EXIF DateTimeOriginal', entries: exifIfd },
    { tag: 0x9004, label: 'EXIF DateTimeDigitized', entries: exifIfd },
    { tag: 0x0132, label: 'EXIF DateTime', entries: ifd0 }
  ]
  for (const candidate of candidates) {
    const item = candidate.entries.find(entry => entry.tag === candidate.tag && entry.type === 2)
    if (!item) continue
    const value = parseExifDate(readAscii(item.entry, item.count))
    if (value) return { capturedAt: value, capturedAtSource: candidate.label }
  }
  return null
}

function jpegExif(view) {
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null
  let offset = 2
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break
    const marker = view.getUint8(offset + 1)
    if (marker === 0xda || marker === 0xd9) break
    const size = view.getUint16(offset + 2, false)
    if (size < 2 || offset + 2 + size > view.byteLength) break
    if (marker === 0xe1 && bytesMatch(view, offset + 4, EXIF_PREFIX)) return parseTiff(view, offset + 10)
    offset += 2 + size
  }
  return null
}

function pngExif(view) {
  if (!bytesMatch(view, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null
  let offset = 8
  while (offset + 12 <= view.byteLength) {
    const size = view.getUint32(offset, false)
    const type = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7))
    if (size < 0 || offset + 12 + size > view.byteLength) break
    if (type === 'eXIf') return parseTiff(view, offset + 8)
    if (type === 'IEND') break
    offset += 12 + size
  }
  return null
}

function webpExif(view) {
  if (!bytesMatch(view, 0, [0x52, 0x49, 0x46, 0x46]) || !bytesMatch(view, 8, [0x57, 0x45, 0x42, 0x50])) return null
  let offset = 12
  while (offset + 8 <= view.byteLength) {
    const type = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))
    const size = view.getUint32(offset + 4, true)
    const dataStart = offset + 8
    if (dataStart + size > view.byteLength) break
    if (type === 'EXIF') return bytesMatch(view, dataStart, EXIF_PREFIX) ? parseTiff(view, dataStart + 6) : parseTiff(view, dataStart)
    offset = dataStart + size + (size % 2)
  }
  return null
}

export function readImageMetadata(buffer, mediaType = '') {
  try {
    const view = new DataView(buffer)
    if (mediaType === 'image/jpeg' || view.getUint16(0, false) === 0xffd8) return jpegExif(view) || {}
    if (mediaType === 'image/png') return pngExif(view) || {}
    if (mediaType === 'image/webp') return webpExif(view) || {}
  } catch (e) {}
  return {}
}

export function formatFileBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function formatFileDate(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '未知'
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
