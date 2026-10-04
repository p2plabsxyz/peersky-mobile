import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { getHyperStoragePath } from '../hyper/runtime.mjs'
import { PEERTUNES_LOOPBACK_PORT } from '../peertunes/constants.mjs'

// The local port each note was last open on, hosted or joined. The desktop
// keeps a note on one port, and a device that joins it listens on that same
// port, so the address reads the same everywhere and survives a restart.
const FILE_NAME = 'p2pmd-ports.json'
const MAX_FILE_BYTES = 16 * 1024
// As many as the recent list keeps.
const MAX_NOTES = 30

// Ports other servers in the app keep for themselves. A note on one would
// take that server's origin, and the server would lose its port: PeerTunes'
// library lives in its origin, so it would open empty.
const RESERVED_PORTS = new Set([PEERTUNES_LOOPBACK_PORT])

export function isUsableNotePort (port) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535 && !RESERVED_PORTS.has(port)
}

export function findNotePort (noteKey, storagePath = getHyperStoragePath()) {
  const key = normalizeNoteKey(noteKey)
  if (!key) return null
  const port = readPorts(storagePath)[key]?.port
  return isUsableNotePort(port) ? port : null
}

/** Keeps the port a note is open on, as the newest of the ones kept. */
export function rememberNotePort (noteKey, port, storagePath = getHyperStoragePath()) {
  const key = normalizeNoteKey(noteKey)
  if (!key || !isUsableNotePort(port) || typeof storagePath !== 'string' || !storagePath.trim()) return false

  const ports = readPorts(storagePath)
  ports[key] = { port, usedAt: Date.now() }
  const kept = Object.fromEntries(
    Object.entries(ports)
      .sort(([, left], [, right]) => right.usedAt - left.usedAt)
      .slice(0, MAX_NOTES)
  )

  const filePath = getFilePath(storagePath)
  const temporaryPath = `${filePath}.tmp`
  try {
    mkdirSync(storagePath, { recursive: true })
    writeFileSync(temporaryPath, JSON.stringify({ version: 1, notes: kept }))
    renameSync(temporaryPath, filePath)
    return true
  } catch (error) {
    try { unlinkSync(temporaryPath) } catch {}
    console.error('[p2pmd] Unable to keep the port a note is on:', error)
    return false
  }
}

function readPorts (storagePath) {
  if (typeof storagePath !== 'string' || !storagePath.trim()) return {}
  try {
    const filePath = getFilePath(storagePath)
    const size = Number(statSync(filePath).size)
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) return {}
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    if (parsed?.version !== 1 || !parsed.notes || typeof parsed.notes !== 'object' || Array.isArray(parsed.notes)) return {}

    const ports = {}
    for (const [noteKey, entry] of Object.entries(parsed.notes)) {
      const key = normalizeNoteKey(noteKey)
      const usedAt = Number(entry?.usedAt)
      if (key && isUsableNotePort(entry?.port) && Number.isSafeInteger(usedAt) && usedAt >= 0) {
        ports[key] = { port: entry.port, usedAt }
      }
    }
    return ports
  } catch {
    return {}
  }
}

function normalizeNoteKey (value) {
  const key = typeof value === 'string' ? value.trim() : ''
  return /^hs:\/\/[a-z0-9]{32,256}$/i.test(key) ? key : null
}

function getFilePath (storagePath) {
  return `${storagePath.replace(/[\\/]+$/, '')}/${FILE_NAME}`
}
