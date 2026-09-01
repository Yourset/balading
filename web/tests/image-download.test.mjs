import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_IMAGE_NAME, anchorDownload, canShareFiles, dataUrlToBlob,
  extFromMime, fetchBlob, fileNameFromUrl
} from '../src/imageDownload.js'

test('extFromMime 映射常见图片格式', () => {
  assert.equal(extFromMime('image/jpeg'), 'jpg')
  assert.equal(extFromMime('image/png'), 'png')
  assert.equal(extFromMime('image/webp'), 'webp')
  assert.equal(extFromMime('image/gif'), 'gif')
  assert.equal(extFromMime('image/svg+xml'), 'svg')
  assert.equal(extFromMime('application/octet-stream'), 'png')
  assert.equal(extFromMime(''), 'png')
})

test('fileNameFromUrl 从 URL 提取文件名并去除 query', () => {
  assert.equal(fileNameFromUrl('http://x/img/ranch2-01.png', 'image/png'), 'ranch2-01.png')
  assert.equal(fileNameFromUrl('/img/ranch2-01.png', 'image/png'), 'ranch2-01.png')
  assert.equal(fileNameFromUrl('http://x/img/a.png?t=123&w=2', 'image/png'), 'a.png')
  assert.equal(fileNameFromUrl('http://x/img/%E5%9B%BE%E7%89%87.png', 'image/png'), '图片.png')
})

test('fileNameFromUrl 无扩展名或非法 URL 时回退默认名', () => {
  const n1 = fileNameFromUrl('http://x/img/ranch2-01', 'image/png')
  assert.match(n1, new RegExp('^' + DEFAULT_IMAGE_NAME + '_\\d+\\.png$'))
  const n2 = fileNameFromUrl('not a url at all', 'image/jpeg')
  assert.match(n2, new RegExp('^' + DEFAULT_IMAGE_NAME + '_\\d+\\.jpg$'))
})

test('dataUrlToBlob 解析 base64 图片并还原类型', () => {
  const d = dataUrlToBlob('data:image/png;base64,aGVsbG8=')
  assert.equal(d.mime, 'image/png')
  assert.equal(d.blob.type, 'image/png')
  assert.equal(d.blob.size, 5)
  const j = dataUrlToBlob('data:image/jpeg;base64,aGVsbG8=')
  assert.equal(j.mime, 'image/jpeg')
  assert.equal(j.blob.type, 'image/jpeg')
})

test('环境能力检测在无 navigator 时不抛错', () => {
  assert.equal(typeof canShareFiles(), 'boolean')
})

test('PhotoViewer 全屏查看器包含下载按钮与下载逻辑', () => {
  const source = readFileSync(new URL('../src/components/ImageView.jsx', import.meta.url), 'utf8')
  assert.match(source, /⬇ 下载/)
  assert.match(source, /downloadImage/)
  assert.match(source, /navigator\.share/)
  assert.match(source, /anchorDownload/)
  assert.match(source, /已调起分享\/保存/)
})
