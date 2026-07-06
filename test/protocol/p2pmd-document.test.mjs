import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
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

describe('p2pmd document protocol state', () => {
  beforeEach(() => {
    resetDocumentState()
  })

  it('stores document content and valid line attributions', () => {
    const result = updateDocumentState('hello\nmobile', {
      1: { color: '#58a6ff', name: 'Phone', clientId: 'phone-1' },
      3: { color: '#ff00ff', name: 'Out of range', clientId: 'ignored' }
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.document.lineAttributions, {
      1: { color: '#58a6ff', name: 'Phone', clientId: 'phone-1' }
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

    assert.equal(result.ok, true)
    assert.equal(result.document.content, 'synced from peer')
    assert.deepEqual(result.document.lineAttributions, {
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
