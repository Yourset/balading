import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  IMAGE_MAX_BYTES,
  fitImageDimensions,
  imageMediaType,
  shouldCompressImage
} from '../src/imageCompression.js'

test('大尺寸截图按最长边 2000 等比缩放', () => {
  assert.deepEqual(fitImageDimensions(1440, 3200), { width: 900, height: 2000 })
  assert.deepEqual(fitImageDimensions(4000, 2000), { width: 2000, height: 1000 })
  assert.deepEqual(fitImageDimensions(1280, 720), { width: 1280, height: 720 })
})

test('文件大小或尺寸任一超限都会进入压缩', () => {
  assert.equal(shouldCompressImage({ size: IMAGE_MAX_BYTES, width: 2000, height: 1600 }), false)
  assert.equal(shouldCompressImage({ size: IMAGE_MAX_BYTES + 1, width: 1200, height: 800 }), true)
  assert.equal(shouldCompressImage({ size: 1000, width: 2001, height: 800 }), true)
  assert.equal(shouldCompressImage({ size: 1000, width: 1200, height: 2001 }), true)
})

test('缺失 MIME 时按扩展名识别常见截图格式', () => {
  assert.equal(imageMediaType({ name: 'Screenshot.PNG', type: '' }), 'image/png')
  assert.equal(imageMediaType({ name: 'photo.jpeg', type: '' }), 'image/jpeg')
  assert.equal(imageMediaType({ name: 'capture.webp', type: '' }), 'image/webp')
})

test('Composer 使用自动压缩附件并向用户展示压缩前后信息', () => {
  const source = readFileSync(new URL('../src/components/Composer.jsx', import.meta.url), 'utf8')
  assert.match(source, /prepareImageAttachment\(file\)/)
  assert.match(source, /已压缩：/)
  assert.match(source, /超限图自动压缩/)
  assert.doesNotMatch(source, /本次未自动压缩/)
})
