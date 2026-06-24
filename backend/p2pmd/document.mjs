import b4a from 'b4a'
import * as Y from 'yjs'

const MAX_DOCUMENT_LENGTH = 10 * 1024 * 1024
const MAX_UPDATE_LENGTH = MAX_DOCUMENT_LENGTH * 2
const MAX_LINE_ATTRIBUTIONS = 100000

const ydoc = new Y.Doc()
const ytext = ydoc.getText('content')
const ylineAttributions = ydoc.getMap('lineAttributions')
const updateListeners = new Set()

let updatedAt = Date.now()

ydoc.on('update', (update, origin) => {
  updatedAt = Date.now()

  const event = {
    document: getDocumentState(),
    origin,
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
  const lineAttributions = getLineAttributionsState()

  return {
    content: ytext.toString(),
    updatedAt,
    lineAttributions
  }
}

export function updateDocumentState (content, lineAttributions = null) {
  const validation = validateDocumentContent(content)
  if (!validation.ok) return validation

  const attributionValidation = validateLineAttributions(lineAttributions)
  if (!attributionValidation.ok) return attributionValidation

  const current = ytext.toString()
  const hasLineAttributions = lineAttributions !== null && lineAttributions !== undefined

  if (current !== content || hasLineAttributions) {
    ydoc.transact(() => {
      if (current !== content) {
        if (current.length > 0) ytext.delete(0, current.length)
        if (content.length > 0) ytext.insert(0, content)
      }
      if (hasLineAttributions) {
        replaceLineAttributions(lineAttributions, getLineCount(content))
      } else {
        trimLineAttributions(getLineCount(content))
      }
    }, 'full-text-update')
  }

  return {
    ok: true,
    document: getDocumentState()
  }
}

export function applyDocumentUpdate (encodedUpdate, lineAttributions = null) {
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

  const attributionValidation = validateLineAttributions(lineAttributions)
  if (!attributionValidation.ok) return attributionValidation

  const candidateValidation = validateCandidateDocumentUpdate(update, lineAttributions)
  if (!candidateValidation.ok) return candidateValidation

  try {
    Y.applyUpdate(ydoc, update, 'remote-update')
    if (lineAttributions !== null && lineAttributions !== undefined) {
      ydoc.transact(() => {
        mergeLineAttributions(lineAttributions, getLineCount(ytext.toString()))
      }, 'line-attribution-update')
    }
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

export function resetDocumentState () {
  ydoc.transact(() => {
    const current = ytext.toString()
    if (current.length > 0) ytext.delete(0, current.length)

    for (const key of Array.from(ylineAttributions.keys())) {
      ylineAttributions.delete(key)
    }
  }, 'document-reset')

  updatedAt = Date.now()
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
      error: 'Document is too large. Maximum size is 10 MB.'
    }
  }

  return { ok: true }
}

function validateCandidateDocumentUpdate (update, lineAttributions) {
  const candidateDoc = new Y.Doc()
  const candidateText = candidateDoc.getText('content')
  const candidateLineAttributions = candidateDoc.getMap('lineAttributions')

  try {
    Y.applyUpdate(candidateDoc, Y.encodeStateAsUpdate(ydoc), 'current-state')
    Y.applyUpdate(candidateDoc, update, 'candidate-update')
  } catch {
    candidateDoc.destroy()
    return {
      ok: false,
      error: 'Invalid Yjs update.'
    }
  }

  if (lineAttributions !== null && lineAttributions !== undefined) {
    mergeLineAttributionsIntoMap(
      candidateLineAttributions,
      lineAttributions,
      getLineCount(candidateText.toString())
    )
  }

  const contentValidation = validateDocumentContent(candidateText.toString())
  if (!contentValidation.ok) {
    candidateDoc.destroy()
    return contentValidation
  }

  if (candidateLineAttributions.size > MAX_LINE_ATTRIBUTIONS) {
    candidateDoc.destroy()
    return {
      ok: false,
      error: 'Too many line attributions.'
    }
  }

  candidateDoc.destroy()
  return { ok: true }
}

function getLineAttributionsState () {
  const lineAttributions = {}

  ylineAttributions.forEach((value, key) => {
    const lineNumber = Number(key)
    const attribution = normalizeLineAttribution(value)
    if (!Number.isInteger(lineNumber) || lineNumber < 1 || !attribution) return

    lineAttributions[String(lineNumber)] = attribution
  })

  return lineAttributions
}

function replaceLineAttributions (lineAttributions, lineCount) {
  for (const key of Array.from(ylineAttributions.keys())) {
    ylineAttributions.delete(key)
  }

  const normalized = normalizeLineAttributions(lineAttributions)
  if (!normalized) return

  for (const [line, attribution] of Object.entries(normalized)) {
    const lineNumber = Number(line)
    if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lineCount) continue

    ylineAttributions.set(String(lineNumber), attribution)
  }
}

function mergeLineAttributions (lineAttributions, lineCount) {
  mergeLineAttributionsIntoMap(ylineAttributions, lineAttributions, lineCount)
  trimLineAttributions(lineCount)
}

function mergeLineAttributionsIntoMap (target, lineAttributions, lineCount) {
  const normalized = normalizeLineAttributions(lineAttributions)
  if (!normalized) return

  for (const [line, attribution] of Object.entries(normalized)) {
    const lineNumber = Number(line)
    if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lineCount) continue

    target.set(String(lineNumber), attribution)
  }
}

function trimLineAttributions (lineCount) {
  for (const key of Array.from(ylineAttributions.keys())) {
    const lineNumber = Number(key)
    if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lineCount) {
      ylineAttributions.delete(key)
    }
  }
}

function validateLineAttributions (lineAttributions) {
  if (lineAttributions === null || lineAttributions === undefined) return { ok: true }
  if (Array.isArray(lineAttributions)) {
    if (lineAttributions.length > MAX_LINE_ATTRIBUTIONS) {
      return {
        ok: false,
        error: 'Too many line attributions.'
      }
    }

    return { ok: true }
  }

  if (typeof lineAttributions === 'object') {
    if (Object.keys(lineAttributions).length > MAX_LINE_ATTRIBUTIONS) {
      return {
        ok: false,
        error: 'Too many line attributions.'
      }
    }

    return { ok: true }
  }

  return {
    ok: false,
    error: 'Invalid line attributions. Expected an object or array.'
  }
}

function normalizeLineAttributions (lineAttributions) {
  if (!lineAttributions || typeof lineAttributions !== 'object') return null

  const normalized = {}

  if (Array.isArray(lineAttributions)) {
    lineAttributions.forEach((value, index) => {
      const attribution = normalizeLineAttribution(value)
      if (attribution) normalized[String(index + 1)] = attribution
    })

    return normalized
  }

  for (const [line, value] of Object.entries(lineAttributions)) {
    const lineNumber = Number(line)
    const attribution = normalizeLineAttribution(value)
    if (!Number.isInteger(lineNumber) || lineNumber < 1 || !attribution) continue

    normalized[String(lineNumber)] = attribution
  }

  return normalized
}

function normalizeLineAttribution (value) {
  if (!value || typeof value !== 'object') return null

  const color = typeof value.color === 'string' ? value.color.trim() : ''
  if (!color || color.length > 64) return null

  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 80) : ''
  const clientId = typeof value.clientId === 'string' ? value.clientId.trim().slice(0, 120) : ''

  return {
    color,
    name,
    clientId
  }
}

function getLineCount (content) {
  if (!content) return 1
  return content.split('\n').length
}
