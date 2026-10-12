import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import b4a from 'b4a'
import * as Y from 'yjs'
import { buildLineReplaceUpdate } from '../fixtures/yjs-helpers.mjs'
import {
  applyDocumentUpdate,
  getDocumentState,
  getEncodedDocumentState,
  getMaxDocumentLength,
  resetDocumentState,
  subscribeToDocumentUpdates,
  updateDocumentState
} from '../../backend/p2pmd/document.mjs'

const MAX_INCREMENTAL_UPDATE_BYTES = 4 * 1024 * 1024

// An editor's edit: text put in at a place, made on its own copy of the note.
function insertUpdate (base64State, index, text) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, b4a.from(base64State, 'base64'))
  const before = Y.encodeStateVector(doc)
  doc.getText('content').insert(index, text)
  const update = b4a.toString(Y.encodeStateAsUpdate(doc, before), 'base64')
  doc.destroy()
  return update
}

describe('p2pmd document protocol state', () => {
  beforeEach(() => {
    resetDocumentState()
  })

  it('stores document content and valid line attributions', () => {
    const result = updateDocumentState('hello\nmobile', {
      1: { color: '#58a6ff', name: 'Phone', clientId: 'phone-1', updatedAt: 1234 },
      3: { color: '#ff00ff', name: 'Out of range', clientId: 'ignored' }
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.document.lineAttributions, {
      1: { color: '#58a6ff', name: 'Phone', clientId: 'phone-1', updatedAt: 1234 }
    })
    assert.equal(getDocumentState().content, 'hello\nmobile')
  })

  it('rejects non-string and oversized document content', () => {
    assert.deepEqual(updateDocumentState(null), {
      ok: false,
      error: 'Invalid document content. Expected a string.'
    })

    const oversized = 'x'.repeat(getMaxDocumentLength() + 1)
    assert.deepEqual(updateDocumentState(oversized), {
      ok: false,
      error: 'Document is too large. Maximum size is 10 MB.'
    })
  })

  it('applies a valid remote Yjs update', () => {
    const remoteDoc = new Y.Doc()
    remoteDoc.getText('content').insert(0, 'synced from peer')
    const encodedUpdate = b4a.toString(Y.encodeStateAsUpdate(remoteDoc), 'base64')

    const result = applyDocumentUpdate(encodedUpdate, {
      1: { color: '#9d4edd', name: 'Desktop', clientId: 'desktop-1' }
    })

    assert.deepEqual(result, { ok: true })
    assert.equal(getDocumentState().content, 'synced from peer')
    assert.deepEqual(getDocumentState().lineAttributions, {
      1: { color: '#9d4edd', name: 'Desktop', clientId: 'desktop-1' }
    })
    remoteDoc.destroy()
  })

  it('merges concurrent line edits from two peers via CRDT updates', () => {
    updateDocumentState('Line 1: base\nLine 2: base\nLine 3: base\nLine 4: base')

    const baseState = getEncodedDocumentState()
    const updateA = buildLineReplaceUpdate(baseState, 'Line 1: base', 'Phone: edited line 1')
    const updateB = buildLineReplaceUpdate(baseState, 'Line 3: base', 'Desktop: edited line 3')

    const resultA = applyDocumentUpdate(updateA, {
      1: { color: '#58a6ff', name: 'Phone', clientId: 'phone-1' }
    })
    const resultB = applyDocumentUpdate(updateB, {
      3: { color: '#9d4edd', name: 'Desktop', clientId: 'desktop-1' }
    })

    assert.equal(resultA.ok, true)
    assert.equal(resultB.ok, true)

    const document = getDocumentState()
    assert.match(document.content, /Phone: edited line 1/)
    assert.match(document.content, /Desktop: edited line 3/)
    assert.match(document.content, /Line 2: base/)
    assert.match(document.content, /Line 4: base/)
    assert.deepEqual(document.lineAttributions, {
      1: { color: '#58a6ff', name: 'Phone', clientId: 'phone-1' },
      3: { color: '#9d4edd', name: 'Desktop', clientId: 'desktop-1' }
    })
  })

  it('does not grow the note when the same line authors come with every edit', () => {
    // The phone editor sends every line author it knows with each edit. Set
    // again unchanged, each one left its old value behind in the note's state,
    // which every edit then re-encoded and every joiner downloaded.
    const authors = {}
    for (let line = 1; line <= 20; line++) {
      authors[line] = { color: '#58a6ff', name: `Person ${line}`, clientId: `client-${line}`, updatedAt: 1000 + line }
    }
    updateDocumentState(Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n'), authors)
    const stateBytes = () => b4a.from(getEncodedDocumentState(), 'base64').byteLength
    const nothing = b4a.toString(Y.encodeStateAsUpdate(new Y.Doc()), 'base64')
    const before = stateBytes()

    for (let i = 0; i < 50; i++) assert.equal(applyDocumentUpdate(nothing, authors).ok, true)
    assert.equal(stateBytes(), before)

    // A line whose author did change still changes.
    const moved = { ...authors, 3: { color: '#9d4edd', name: 'Desktop', clientId: 'desktop-1', updatedAt: 5000 } }
    assert.equal(applyDocumentUpdate(nothing, moved).ok, true)
    assert.deepEqual(getDocumentState().lineAttributions[3], moved[3])
    assert.deepEqual(getDocumentState().lineAttributions[4], authors[4])
  })

  it('refuses an edit that would make the note too big, leaves the note as it was, and takes the next one', () => {
    const limit = getMaxDocumentLength()
    updateDocumentState('x'.repeat(limit - 10))
    const base = getEncodedDocumentState()

    assert.deepEqual(applyDocumentUpdate(insertUpdate(base, 0, 'y'.repeat(20))), {
      ok: false,
      error: 'Document is too large. Maximum size is 10 MB.'
    })
    assert.equal(getDocumentState().content.length, limit - 10)

    assert.deepEqual(applyDocumentUpdate(insertUpdate(base, 0, 'y'.repeat(5))), { ok: true })
    assert.equal(getDocumentState().content.length, limit - 5)
  })

  it('checks an edit against the note as it is now, after it was emptied or replaced', () => {
    updateDocumentState('x'.repeat(getMaxDocumentLength() - 10))
    resetDocumentState()
    assert.deepEqual(applyDocumentUpdate(insertUpdate(getEncodedDocumentState(), 0, 'y'.repeat(1000))), { ok: true })
    assert.equal(getDocumentState().content, 'y'.repeat(1000))

    updateDocumentState('short\nnote')
    assert.deepEqual(applyDocumentUpdate(insertUpdate(getEncodedDocumentState(), 5, '!')), { ok: true })
    assert.equal(getDocumentState().content, 'short!\nnote')
  })

  it('refuses a broken update without touching the note, and takes the next one', () => {
    updateDocumentState('Line 1: base')
    assert.deepEqual(applyDocumentUpdate(b4a.toString(b4a.from([1, 2, 3]), 'base64')), {
      ok: false,
      error: 'Invalid Yjs update.'
    })
    assert.equal(getDocumentState().content, 'Line 1: base')

    assert.deepEqual(applyDocumentUpdate(insertUpdate(getEncodedDocumentState(), 12, ' and more')), { ok: true })
    assert.equal(getDocumentState().content, 'Line 1: base and more')
  })

  it('takes about as long to check an edit to a big note as to a small one', () => {
    // Every edit was tried on a copy made from the whole note's state, so each
    // one cost more the bigger the note had grown.
    const medianEditMs = (content) => {
      updateDocumentState(content)
      const editor = new Y.Doc()
      Y.applyUpdate(editor, b4a.from(getEncodedDocumentState(), 'base64'))
      let update = null
      editor.on('update', (next) => { update = next })
      const times = []
      for (let i = 0; i < 60; i++) {
        editor.getText('content').insert(1, 'y')
        const started = performance.now()
        assert.equal(applyDocumentUpdate(b4a.toString(update, 'base64')).ok, true)
        times.push(performance.now() - started)
      }
      editor.destroy()
      return times.sort((a, b) => a - b)[30]
    }
    medianEditMs('warming up')
    const small = medianEditMs('one line')
    const big = medianEditMs(Array.from({ length: 20000 }, (_, i) => `Line ${i + 1}: ${'x'.repeat(40)}`).join('\n'))
    assert.ok(big < small * 3 + 0.05, `an edit took ${big.toFixed(3)} ms on a 1 MB note and ${small.toFixed(3)} ms on a small one`)
  })

  it('rejects malformed and oversized incremental Yjs updates', () => {
    assert.deepEqual(applyDocumentUpdate(''), {
      ok: false,
      error: 'Missing Yjs update.'
    })

    const oversized = b4a.toString(b4a.alloc(MAX_INCREMENTAL_UPDATE_BYTES + 1, 1), 'base64')
    assert.deepEqual(applyDocumentUpdate(oversized), {
      ok: false,
      error: 'Invalid Yjs update size.'
    })
  })

  it('exports full Yjs state for initial document sync', () => {
    updateDocumentState('initial\nstate')

    const receiver = new Y.Doc()
    Y.applyUpdate(receiver, b4a.from(getEncodedDocumentState(), 'base64'))

    assert.equal(receiver.getText('content').toString(), 'initial\nstate')
    receiver.destroy()
  })

  it('notifies subscribers and supports unsubscribe', () => {
    let count = 0
    const unsubscribe = subscribeToDocumentUpdates(() => {
      count += 1
    })

    updateDocumentState('one')
    unsubscribe()
    updateDocumentState('two')

    assert.equal(count, 1)
  })
})
