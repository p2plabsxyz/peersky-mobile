import assert from 'node:assert/strict'
import b4a from 'b4a'
import * as Y from 'yjs'

export function buildLineReplaceUpdate (base64State, target, replacement) {
  const doc = new Y.Doc()
  const ytext = doc.getText('content')

  Y.applyUpdate(doc, b4a.from(base64State, 'base64'), 'seed')

  const before = ytext.toString()
  const start = before.indexOf(target)
  assert.notEqual(start, -1)

  doc.transact(() => {
    ytext.delete(start, target.length)
    ytext.insert(start, replacement)
  }, 'edit')

  const update = b4a.toString(Y.encodeStateAsUpdate(doc), 'base64')
  doc.destroy()
  return update
}
