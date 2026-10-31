import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as Y from 'yjs'
import { lineChangesFromDelta, newerLineAuthor, shiftLineAuthors } from '../../backend/p2pmd/line-authors.mjs'

// The delta Yjs reports for a change, as an editor receives it.
function change (oldText, edit) {
  const doc = new Y.Doc()
  const text = doc.getText('t')
  text.insert(0, oldText)
  let delta = null
  text.observe((event) => { delta = event.changes.delta })
  doc.transact(() => edit(text))
  return { ...lineChangesFromDelta(oldText, delta), newText: text.toString() }
}

const lines = (map) => Object.fromEntries([...map].map(([from, to]) => [from, to]))

test('typing in a line writes on that line and moves nothing', () => {
  const result = change('one\ntwo\nthree', (t) => t.insert(6, 'X'))
  assert.equal(result.newText, 'one\ntwXo\nthree')
  assert.deepEqual([...result.written], [2])
  assert.deepEqual(lines(result.moved), { 1: 1, 2: 2, 3: 3 })
  assert.equal(result.firstLine, 2)
})

test('a line break typed after text writes on the new line below it', () => {
  const result = change('one\ntwo\nthree', (t) => t.insert(7, '\n'))
  assert.equal(result.newText, 'one\ntwo\n\nthree')
  assert.deepEqual([...result.written], [3])
  assert.deepEqual(lines(result.moved), { 1: 1, 2: 2, 3: 4 })
})

test('a line break typed at the start of a line pushes that line down', () => {
  const result = change('one\ntwo\nthree', (t) => t.insert(4, '\n'))
  assert.deepEqual([...result.written], [2])
  assert.deepEqual(lines(result.moved), { 1: 1, 2: 3, 3: 4 })
})

test('lines pasted above move every line below them', () => {
  const result = change('one\ntwo', (t) => t.insert(0, 'a\nb\n'))
  assert.equal(result.newText, 'a\nb\none\ntwo')
  assert.deepEqual([...result.written].sort(), [1, 2])
  assert.deepEqual(lines(result.moved), { 1: 3, 2: 4 })
})

test('a deleted line is gone and the ones below move up', () => {
  const result = change('one\ntwo\nthree\nfour', (t) => t.delete(4, 4))
  assert.equal(result.newText, 'one\nthree\nfour')
  assert.deepEqual([...result.written], [])
  assert.deepEqual(lines(result.moved), { 1: 1, 3: 2, 4: 3 })
})

test('joining two lines writes on neither and keeps the upper one', () => {
  const result = change('one\ntwo\nthree', (t) => t.delete(7, 1))
  assert.equal(result.newText, 'one\ntwothree')
  assert.deepEqual([...result.written], [])
  assert.deepEqual(lines(result.moved), { 1: 1, 2: 2 })
})

test('taking characters out of a line writes on it, even its first one', () => {
  const result = change('one\nXtwo\nthree', (t) => t.delete(4, 1))
  assert.deepEqual([...result.written], [2])
  assert.deepEqual(lines(result.moved), { 1: 1, 2: 2, 3: 3 })
})

test('replacing the whole note leaves one written line and none of the old ones', () => {
  const old = Array.from({ length: 39 }, (_, i) => `line ${i + 1}`).join('\n')
  const result = change(old, (t) => { t.delete(0, old.length); t.insert(0, 'Fresh start') })
  assert.equal(result.newText, 'Fresh start')
  assert.deepEqual([...result.written], [1])
  assert.deepEqual(lines(result.moved), {})
})

test('the empty line after a final line break moves with the text', () => {
  const result = change('one\n', (t) => t.insert(4, 'two'))
  assert.equal(result.newText, 'one\ntwo')
  assert.deepEqual([...result.written], [2])
  assert.deepEqual(lines(result.moved), { 1: 1, 2: 2 })
})

test('a list of line authors moves with the lines and loses the deleted ones', () => {
  const result = change('one\ntwo\nthree\nfour', (t) => { t.delete(4, 4); t.insert(0, 'top\n') })
  const authors = { 1: { name: 'A' }, 2: { name: 'B' }, 3: { name: 'C' }, 4: { name: 'D' } }
  assert.deepEqual(shiftLineAuthors(authors, result.moved), {
    2: { name: 'A' },
    3: { name: 'C' },
    4: { name: 'D' }
  })
})

test('the newer edit owns a line, and a tie goes the same way on every device', () => {
  const older = { clientId: 'b', updatedAt: 10 }
  const newer = { clientId: 'a', updatedAt: 20 }
  assert.equal(newerLineAuthor(older, newer), newer)
  assert.equal(newerLineAuthor(newer, older), newer)

  const one = { clientId: 'phone-1', updatedAt: 30 }
  const two = { clientId: 'laptop-2', updatedAt: 30 }
  assert.equal(newerLineAuthor(one, two), newerLineAuthor(two, one))
  assert.equal(newerLineAuthor(undefined, one), one)
})
