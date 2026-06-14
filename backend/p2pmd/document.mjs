import b4a from 'b4a'
import * as Y from 'yjs'

const MAX_DOCUMENT_LENGTH = 1024 * 1024
const MAX_UPDATE_LENGTH = 1024 * 1024

const ydoc = new Y.Doc()
const ytext = ydoc.getText('content')
const updateListeners = new Set()

let updatedAt = Date.now()

ydoc.on('update', (update) => {
  updatedAt = Date.now()

  const event = {
    document: getDocumentState(),
    update: b4a.toString(update, 'base64')
  }

  for (const listener of updateListeners) {
    try {
      listener(event)
    } catch (error) {
      console.error('[p2pmd] Document update listener failed:', error)
    }
  }
})

export function getDocumentState () {
  return {
    content: ytext.toString(),
    updatedAt
  }
}

export function updateDocumentState (content) {
  const validation = validateDocumentContent(content)
  if (!validation.ok) return validation

  const current = ytext.toString()
  if (current !== content) {
    ydoc.transact(() => {
      if (current.length > 0) ytext.delete(0, current.length)
      if (content.length > 0) ytext.insert(0, content)
    }, 'full-text-update')
  }

  return {
    ok: true,
    document: getDocumentState()
  }
}

export function applyDocumentUpdate (encodedUpdate) {
  if (typeof encodedUpdate !== 'string' || !encodedUpdate) {
    return {
      ok: false,
      error: 'Missing Yjs update.'
    }
  }

  let update
  try {
    update = b4a.from(encodedUpdate, 'base64')
  } catch {
    return {
      ok: false,
      error: 'Invalid Yjs update encoding.'
    }
  }

  if (update.byteLength < 1 || update.byteLength > MAX_UPDATE_LENGTH) {
    return {
      ok: false,
      error: 'Invalid Yjs update size.'
    }
  }

  try {
    Y.applyUpdate(ydoc, update, 'remote-update')
  } catch {
    return {
      ok: false,
      error: 'Invalid Yjs update.'
    }
  }

  return {
    ok: true,
    document: getDocumentState()
  }
}

export function getEncodedDocumentState () {
  return b4a.toString(Y.encodeStateAsUpdate(ydoc), 'base64')
}

export function subscribeToDocumentUpdates (listener) {
  updateListeners.add(listener)
  return () => updateListeners.delete(listener)
}

export function getMaxDocumentLength () {
  return MAX_DOCUMENT_LENGTH
}

function validateDocumentContent (content) {
  if (typeof content !== 'string') {
    return {
      ok: false,
      error: 'Invalid document content. Expected a string.'
    }
  }

  if (content.length > MAX_DOCUMENT_LENGTH) {
    return {
      ok: false,
      error: 'Document is too large. Maximum size is 1 MB.'
    }
  }

  return { ok: true }
}
