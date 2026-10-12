import b4a from 'b4a'
import * as Y from 'yjs'

const MAX_DOCUMENT_LENGTH = 10 * 1024 * 1024
const MAX_UPDATE_LENGTH = 4 * 1024 * 1024
const MAX_LINE_ATTRIBUTIONS = 100000

const updateListeners = new Set()

let ydoc = null
let ytext = null
let ylineAttributions = null

// A second copy of the note, kept in step with every change, that an edit is
// tried on first. Trying it on a copy made from the whole note's state cost
// more the bigger that state grew, on every edit. The copy is made again only
// when an edit is refused.
let mirror = null
let mirrorText = null
let mirrorLineAttributions = null

let updatedAt = Date.now()

startFreshDocument()

// Each note gets a document of its own. Emptying the last one kept its deleted
// text, so a note opened again from its saved history could not be put back
// over it.
function startFreshDocument () {
  if (ydoc) ydoc.destroy()
  ydoc = new Y.Doc()
  ytext = ydoc.getText('content')
  ylineAttributions = ydoc.getMap('lineAttributions')
  ydoc.on('update', onDocumentUpdate)
  rebuildMirror()
}

function onDocumentUpdate (update, origin) {
  updatedAt = Date.now()
  try {
    Y.applyUpdate(mirror, update, 'mirror')
  } catch {
    rebuildMirror()
  }

  // Built only if a listener reads it: twice an edit, the whole note was put
  // together for a snapshot that waits for a pause anyway.
  let document = null
  const event = {
    get document () {
      if (!document) document = getDocumentState()
      return document
    },
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
}

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
        mergeLineAttributions(lineAttributions, candidateValidation.lineCount)
      }, 'line-attribution-update')
    }
  } catch {
    rebuildMirror()
    return {
      ok: false,
      error: 'Invalid Yjs update.'
    }
  }

  // Not the whole note: every editor has it already, and sending it back with
  // each edit cost the host its upload, more the longer the note. Editors read
  // nothing here but ok, and the phone's falls back to its own copy.
  return { ok: true }
}

export function getEncodedDocumentState () {
  return b4a.toString(Y.encodeStateAsUpdate(ydoc), 'base64')
}

export function resetDocumentState () {
  startFreshDocument()
  updatedAt = Date.now()
}

// What a saved copy keeps: the text and its authors, and the Yjs state, so the
// note can be opened again with the history its editors share.
export function getDocumentSnapshot () {
  return { ...getDocumentState(), yjsState: getEncodedDocumentState() }
}

// A note opened again from its saved copy. With its Yjs state it keeps the
// history it had, so an editor that kept the note open merges with it. From
// the text alone, as older copies and a desktop's are, the note started a new
// history, and an editor that still had the old one wrote it out twice.
export function restoreDocumentState ({ content, lineAttributions = null, yjsState = '' } = {}) {
  const validation = validateDocumentContent(content)
  if (!validation.ok) return validation

  const state = savedStateFor(yjsState, content)
  startFreshDocument()
  if (!state) return updateDocumentState(content, lineAttributions)

  Y.applyUpdate(ydoc, state, 'snapshot-restore')
  return { ok: true }
}

// A saved Yjs state, only if it gives back the text it was saved with.
function savedStateFor (yjsState, content) {
  if (typeof yjsState !== 'string' || !yjsState) return null
  const check = new Y.Doc()
  try {
    const state = b4a.from(yjsState, 'base64')
    Y.applyUpdate(check, state)
    return check.getText('content').toString() === content ? state : null
  } catch {
    return null
  } finally {
    check.destroy()
  }
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

// The edit tried on the mirror. Kept, it is what the note becomes once the edit
// is applied for real, which then changes nothing on the mirror. Refused, the
// mirror is made again from the note.
function validateCandidateDocumentUpdate (update, lineAttributions) {
  try {
    Y.applyUpdate(mirror, update, 'candidate-update')
  } catch {
    rebuildMirror()
    return {
      ok: false,
      error: 'Invalid Yjs update.'
    }
  }

  if (mirrorText.length > MAX_DOCUMENT_LENGTH) {
    rebuildMirror()
    return {
      ok: false,
      error: 'Document is too large. Maximum size is 10 MB.'
    }
  }

  // Lines are counted only for authors that came with the edit; any the edit
  // itself added to the map are counted either way.
  const lineCount = lineAttributions === null || lineAttributions === undefined
    ? 0
    : getLineCount(mirrorText.toString())
  if (lineAttributionCountAfter(lineAttributions, lineCount) > MAX_LINE_ATTRIBUTIONS) {
    rebuildMirror()
    return {
      ok: false,
      error: 'Too many line attributions.'
    }
  }

  return { ok: true, lineCount }
}

function rebuildMirror () {
  if (mirror) mirror.destroy()
  mirror = new Y.Doc()
  mirrorText = mirror.getText('content')
  mirrorLineAttributions = mirror.getMap('lineAttributions')
  Y.applyUpdate(mirror, Y.encodeStateAsUpdate(ydoc), 'mirror')
}

// How many lines would have an author once these are merged in, as merging
// them into the mirror would count them, without touching the mirror.
function lineAttributionCountAfter (lineAttributions, lineCount) {
  let count = mirrorLineAttributions.size
  const normalized = normalizeLineAttributions(lineAttributions)
  if (!normalized) return count

  for (const line of Object.keys(normalized)) {
    const lineNumber = Number(line)
    if (lineNumber > lineCount || mirrorLineAttributions.has(line)) continue
    count += 1
  }

  return count
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
    // Every set leaves the old value behind in the note's state, and the phone
    // editor sends every line's author with each edit, so one that has not
    // changed is left alone.
    if (sameLineAttribution(target.get(String(lineNumber)), attribution)) continue

    target.set(String(lineNumber), attribution)
  }
}

function sameLineAttribution (current, next) {
  return !!current && current.color === next.color && current.name === next.name &&
    current.clientId === next.clientId && current.updatedAt === next.updatedAt
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

  const normalized = {
    color,
    name,
    clientId
  }
  const updatedAt = Number(value.updatedAt)
  if (Number.isFinite(updatedAt) && updatedAt >= 0) normalized.updatedAt = updatedAt
  return normalized
}

function getLineCount (content) {
  if (!content) return 1
  // Counted in place: splitting a big note into lines for this, once an
  // edit, took most of what an edit cost.
  let count = 1
  for (let at = content.indexOf('\n'); at !== -1; at = content.indexOf('\n', at + 1)) count += 1
  return count
}
