import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import b4a from 'b4a'
import { getHyperStoragePath } from '../hyper/runtime.mjs'
import { canSealChats, CHAT_SEAL, isChatSealedFile, openJson, sealJson } from '../hyper/sealed-file.mjs'

const MAX_DOCUMENT_LENGTH = 10 * 1024 * 1024
const MAX_SNAPSHOT_FILE_BYTES = (MAX_DOCUMENT_LENGTH * 4) + (1024 * 1024)
// A copy locked with the chat key is its JSON in base64, so a third bigger.
const MAX_STORED_SNAPSHOT_BYTES = Math.ceil(MAX_SNAPSHOT_FILE_BYTES / 3) * 4 + 4096
// One copy for each of the thirty recent notes, plus room for the five a
// desktop sends in a Link Device transfer, so those arriving never push out
// the copies of this phone's own notes.
const MAX_SNAPSHOTS = 35
const SNAPSHOT_DELAY_MS = 200
// A note's copy was named after its key, and a private note's key is what its
// host's keys are made from. It is named by a hash of the key now, and locked
// with the chat key (hyper/sealed-file.mjs), so the folder shows neither the
// notes nor their text.
const SNAPSHOT_NAME_CONTEXT = 'peersky-p2pmd-note:'
const SNAPSHOT_FILE_NAME = /^[a-z0-9]{32,256}[.]json$/i

let activeRoomKey = null
let pendingDocument = null
let snapshotTimer = null

export function loadP2pmdRoomSnapshot (roomKey, storagePath = getHyperStoragePath()) {
  const target = getSnapshotTarget(roomKey, storagePath)
  if (!target) return null

  const snapshot = readSnapshot(target.filePath, target.roomKey)
  if (snapshot !== undefined) return snapshot
  // Kept under the key by a build before this one: moved to its new name,
  // locked, as it is read.
  const legacy = readSnapshot(target.legacyFilePath, target.roomKey)
  if (!legacy) return null
  saveP2pmdRoomSnapshot(target.roomKey, legacy, storagePath)
  return legacy
}

// undefined when there is no copy at path, null when there is one and it does
// not open.
function readSnapshot (filePath, roomKey) {
  const readablePath = [filePath, `${filePath}.previous`].find((path) => existsSync(path))
  if (!readablePath) return undefined
  try {
    const size = Number(statSync(readablePath).size)
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_STORED_SNAPSHOT_BYTES) return null
    return snapshotFrom(openJson(readFileSync(readablePath, 'utf8'), readablePath).value, roomKey)
  } catch {
    return null
  }
}

function snapshotFrom (parsed, roomKey) {
  if (parsed?.version !== 1 || parsed?.key !== roomKey) return null
  if (typeof parsed.content !== 'string' || parsed.content.length > MAX_DOCUMENT_LENGTH) return null
  if (!isLineAttributions(parsed.lineAttributions)) return null

  return {
    content: parsed.content,
    lineAttributions: parsed.lineAttributions,
    updatedAt: normalizeTimestamp(parsed.updatedAt),
    ...(typeof parsed.yjsState === 'string' && parsed.yjsState && { yjsState: parsed.yjsState })
  }
}

export function saveP2pmdRoomSnapshot (roomKey, document, storagePath = getHyperStoragePath()) {
  const target = getSnapshotTarget(roomKey, storagePath)
  const snapshot = normalizeSnapshot(document)
  if (!target || !snapshot) return false

  let value = { version: 1, key: target.roomKey, ...snapshot }
  // A long-edited note's Yjs state can outgrow the limit. The text alone still
  // opens it, with a new history.
  if (b4a.byteLength(JSON.stringify(value)) > MAX_SNAPSHOT_FILE_BYTES && snapshot.yjsState) {
    const { yjsState, ...text } = snapshot
    value = { version: 1, key: target.roomKey, ...text }
  }
  if (b4a.byteLength(JSON.stringify(value)) > MAX_SNAPSHOT_FILE_BYTES) return false

  const temporaryPath = `${target.filePath}.tmp`
  try {
    // Without the chat key nothing is written, plain or otherwise.
    const serialized = sealJson(value, { seal: CHAT_SEAL })
    mkdirSync(target.directory, { recursive: true })
    writeFileSync(temporaryPath, serialized)
    replaceFile(temporaryPath, target.filePath)
    for (const path of [target.legacyFilePath, `${target.legacyFilePath}.previous`]) {
      try { unlinkSync(path) } catch {}
    }
    pruneSnapshots(target.directory, target.fileName)
    return true
  } catch (error) {
    try { unlinkSync(temporaryPath) } catch {}
    console.error('[p2pmd] Unable to save room snapshot:', error)
    return false
  }
}

/** The file a note's copy is kept in, inside p2pmd-rooms, or '' for no note. */
export function p2pmdSnapshotFileName (roomKey) {
  return getSnapshotTarget(roomKey, '.')?.fileName || ''
}

/**
 * Locks and renames the copies a build before this one kept under their
 * notes' keys, in the open. Returns how many it moved.
 */
export function sealP2pmdSnapshotsAtRest (storagePath = getHyperStoragePath()) {
  if (!canSealChats() || typeof storagePath !== 'string' || !storagePath.trim()) return 0
  const directory = `${storagePath.replace(/[\\/]+$/, '')}/p2pmd-rooms`
  let names
  try {
    names = readdirSync(directory)
  } catch {
    return 0
  }
  let moved = 0
  // A copy's .previous after the copy itself: it is only the older one, for
  // a copy cut off while it was replaced.
  const ordered = names.filter((name) => !name.endsWith('.previous')).concat(names.filter((name) => name.endsWith('.previous')))
  for (const name of ordered) {
    const previous = name.endsWith('.previous')
    const fileName = previous ? name.slice(0, -'.previous'.length) : name
    if (!SNAPSHOT_FILE_NAME.test(fileName)) continue
    const filePath = `${directory}/${name}`
    try {
      if (isChatSealedFile(filePath) || Number(statSync(filePath).size) > MAX_STORED_SNAPSHOT_BYTES) continue
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
      const target = getSnapshotTarget(parsed?.key, storagePath)
      if (!target) continue
      // A locked copy under the new name is the newer one: saves only go
      // there. An older .previous is kept only when there is nothing else.
      const isNewName = name === target.fileName
      const newer = previous ? existsSync(target.filePath) : isChatSealedFile(target.filePath)
      if (isNewName || !newer) {
        const snapshot = snapshotFrom(parsed, target.roomKey)
        if (snapshot) {
          // Kept where it is when it could not be written again.
          if (!saveP2pmdRoomSnapshot(target.roomKey, snapshot, storagePath)) continue
          moved += 1
        }
      }
      if (!isNewName) unlinkSync(filePath)
    } catch {}
  }
  return moved
}

export function activateP2pmdRoomSnapshot (roomKey, document) {
  clearSnapshotTimer()
  activeRoomKey = normalizeRoomKey(roomKey)
  pendingDocument = null
  if (activeRoomKey && document) saveP2pmdRoomSnapshot(activeRoomKey, document)
}

// document can be a function that gives it, called only when the snapshot is
// saved.
export function scheduleP2pmdRoomSnapshot (document) {
  if (!activeRoomKey) return

  pendingDocument = document
  clearSnapshotTimer()
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null
    flushP2pmdRoomSnapshot()
  }, SNAPSHOT_DELAY_MS)
}

export function deactivateP2pmdRoomSnapshot (document = null) {
  clearSnapshotTimer()
  if (activeRoomKey && (document || pendingDocument)) {
    saveP2pmdRoomSnapshot(activeRoomKey, document || documentOf(pendingDocument))
  }
  activeRoomKey = null
  pendingDocument = null
}

export function flushP2pmdRoomSnapshot () {
  if (!activeRoomKey || !pendingDocument) return false

  const document = documentOf(pendingDocument)
  pendingDocument = null
  return saveP2pmdRoomSnapshot(activeRoomKey, document)
}

function documentOf (pending) {
  return typeof pending === 'function' ? pending() : pending
}

function normalizeSnapshot (document) {
  if (!document || typeof document.content !== 'string') return null
  if (document.content.length > MAX_DOCUMENT_LENGTH) return null
  if (!isLineAttributions(document.lineAttributions)) return null

  return {
    content: document.content,
    lineAttributions: document.lineAttributions,
    updatedAt: normalizeTimestamp(document.updatedAt),
    ...(typeof document.yjsState === 'string' && document.yjsState && { yjsState: document.yjsState })
  }
}

function isLineAttributions (value) {
  return Boolean(value) && !Array.isArray(value) && typeof value === 'object' &&
    Object.keys(value).length <= 100000
}

function normalizeTimestamp (value) {
  const timestamp = Number(value)
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : Date.now()
}

function getSnapshotTarget (roomKey, storagePath) {
  const normalizedKey = normalizeRoomKey(roomKey)
  if (!normalizedKey || typeof storagePath !== 'string' || !storagePath.trim()) return null

  const directory = `${storagePath.replace(/[\\/]+$/, '')}/p2pmd-rooms`
  const fileName = `${createHash('sha256').update(SNAPSHOT_NAME_CONTEXT + normalizedKey).digest('hex').slice(0, 32)}.json`
  return {
    directory,
    fileName,
    filePath: `${directory}/${fileName}`,
    // Where a build before this one kept it.
    legacyFilePath: `${directory}/${normalizedKey.slice('hs://'.length)}.json`,
    roomKey: normalizedKey
  }
}

function normalizeRoomKey (value) {
  if (typeof value !== 'string') return null
  const roomKey = value.trim()
  return /^hs:\/\/[a-z0-9]{32,256}$/i.test(roomKey) ? roomKey : null
}

function replaceFile (temporaryPath, filePath) {
  try {
    renameSync(temporaryPath, filePath)
    try { unlinkSync(`${filePath}.previous`) } catch {}
    return
  } catch {}

  const previousPath = `${filePath}.previous`
  let movedPrevious = false
  try { unlinkSync(previousPath) } catch {}
  try {
    renameSync(filePath, previousPath)
    movedPrevious = true
  } catch {}

  try {
    renameSync(temporaryPath, filePath)
    if (movedPrevious) {
      try { unlinkSync(previousPath) } catch {}
    }
  } catch (error) {
    if (movedPrevious) {
      try { renameSync(previousPath, filePath) } catch {}
    }
    throw error
  }
}

function pruneSnapshots (directory, activeFileName) {
  const snapshots = readdirSync(directory)
    .filter((name) => /^[a-z0-9]{32,256}[.]json$/i.test(name))
    .map((name) => {
      try {
        return { name, modifiedAt: Number(statSync(`${directory}/${name}`).mtimeMs) || 0 }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.modifiedAt - left.modifiedAt)

  const retained = new Set([
    activeFileName,
    ...snapshots
      .filter(({ name }) => name !== activeFileName)
      .slice(0, MAX_SNAPSHOTS - 1)
      .map(({ name }) => name)
  ])
  for (const { name } of snapshots) {
    if (!retained.has(name)) {
      try { unlinkSync(`${directory}/${name}`) } catch {}
    }
  }
}

function clearSnapshotTimer () {
  if (snapshotTimer) clearTimeout(snapshotTimer)
  snapshotTimer = null
}
