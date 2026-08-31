import {
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

const MAX_DOCUMENT_LENGTH = 10 * 1024 * 1024
const MAX_SNAPSHOT_FILE_BYTES = (MAX_DOCUMENT_LENGTH * 4) + (1024 * 1024)
const MAX_SNAPSHOTS = 5
const SNAPSHOT_DELAY_MS = 200

let activeRoomKey = null
let pendingDocument = null
let snapshotTimer = null

export function loadP2pmdRoomSnapshot (roomKey, storagePath = getHyperStoragePath()) {
  const target = getSnapshotTarget(roomKey, storagePath)
  if (!target) return null

  try {
    const readablePath = getReadableSnapshotPath(target.filePath)
    const size = Number(statSync(readablePath).size)
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_SNAPSHOT_FILE_BYTES) return null

    const parsed = JSON.parse(readFileSync(readablePath, 'utf8'))
    if (parsed?.version !== 1 || parsed?.key !== target.roomKey) return null
    if (typeof parsed.content !== 'string' || parsed.content.length > MAX_DOCUMENT_LENGTH) return null
    if (!isLineAttributions(parsed.lineAttributions)) return null

    return {
      content: parsed.content,
      lineAttributions: parsed.lineAttributions,
      updatedAt: normalizeTimestamp(parsed.updatedAt)
    }
  } catch {
    return null
  }
}

export function saveP2pmdRoomSnapshot (roomKey, document, storagePath = getHyperStoragePath()) {
  const target = getSnapshotTarget(roomKey, storagePath)
  const snapshot = normalizeSnapshot(document)
  if (!target || !snapshot) return false

  const serialized = JSON.stringify({
    version: 1,
    key: target.roomKey,
    ...snapshot
  })
  if (b4a.byteLength(serialized) > MAX_SNAPSHOT_FILE_BYTES) return false

  const temporaryPath = `${target.filePath}.tmp`
  try {
    mkdirSync(target.directory, { recursive: true })
    writeFileSync(temporaryPath, serialized)
    replaceFile(temporaryPath, target.filePath)
    pruneSnapshots(target.directory, target.fileName)
    return true
  } catch (error) {
    try { unlinkSync(temporaryPath) } catch {}
    console.error('[p2pmd] Unable to save room snapshot:', error)
    return false
  }
}

export function activateP2pmdRoomSnapshot (roomKey, document) {
  clearSnapshotTimer()
  activeRoomKey = normalizeRoomKey(roomKey)
  pendingDocument = null
  if (activeRoomKey && document) saveP2pmdRoomSnapshot(activeRoomKey, document)
}

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
    saveP2pmdRoomSnapshot(activeRoomKey, document || pendingDocument)
  }
  activeRoomKey = null
  pendingDocument = null
}

export function flushP2pmdRoomSnapshot () {
  if (!activeRoomKey || !pendingDocument) return false

  const document = pendingDocument
  pendingDocument = null
  return saveP2pmdRoomSnapshot(activeRoomKey, document)
}

function normalizeSnapshot (document) {
  if (!document || typeof document.content !== 'string') return null
  if (document.content.length > MAX_DOCUMENT_LENGTH) return null
  if (!isLineAttributions(document.lineAttributions)) return null

  return {
    content: document.content,
    lineAttributions: document.lineAttributions,
    updatedAt: normalizeTimestamp(document.updatedAt)
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
  const fileName = `${normalizedKey.slice('hs://'.length)}.json`
  return {
    directory,
    fileName,
    filePath: `${directory}/${fileName}`,
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

function getReadableSnapshotPath (filePath) {
  try {
    statSync(filePath)
    return filePath
  } catch {
    return `${filePath}.previous`
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
