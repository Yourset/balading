import assert from 'node:assert/strict'
import test from 'node:test'
import { NOTE_SORT_KEY, sortNotes } from '../src/noteSorting.js'

const notes = [
  { name: 'a', category: '生活', createdAt: 10, updatedAt: 40 },
  { name: 'b', category: '产品想法', createdAt: 30, updatedAt: 20 },
  { name: 'c', category: '生活', createdAt: 20, updatedAt: 50 }
]

test('笔记支持最近更新与最近创建两种顺序', () => {
  assert.equal(NOTE_SORT_KEY, 'balading-note-sort')
  assert.deepEqual(sortNotes(notes, 'updated').map(note => note.name), ['c', 'a', 'b'])
  assert.deepEqual(sortNotes(notes, 'created').map(note => note.name), ['b', 'c', 'a'])
})

test('按分类排列时同分类内部仍按最近更新', () => {
  assert.deepEqual(sortNotes(notes, 'category').map(note => note.name), ['b', 'c', 'a'])
})

test('排序不修改原数组', () => {
  const before = notes.map(note => note.name)
  sortNotes(notes, 'updated')
  assert.deepEqual(notes.map(note => note.name), before)
})
