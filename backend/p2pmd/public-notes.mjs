import { readFileSync, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import b4a from 'b4a'
import { getHyperStoragePath } from '../hyper/runtime.mjs'
import { CHAT_SEAL, openJson, writeSealedJson } from '../hyper/sealed-file.mjs'

// A public note's key is its host's public key, and hosting from that key
// makes a different note. Only the seed the note came from hosts it again, so
// this phone keeps the seeds of the public notes it made, and nothing else
// ever reads them: Link Device sends a note's key, name and text, never this.
// Locked with the chat key (hyper/sealed-file.mjs).
export const PUBLIC_NOTES_FILE = 'p2pmd-public-notes.json'
const FILE_NAME = PUBLIC_NOTES_FILE
const MAX_FILE_BYTES = 128 * 1024
// The recent list keeps thirty notes, and opening one counts as using it, so
// every public note on the list is among the last thirty used.
const MAX_PUBLIC_NOTES = 30

export function isPublicNoteKey (key) {
  return typeof key === 'string' && /^hs:\/\/0000[a-z0-9]{32,252}$/i.test(key.trim())
}

export function createPublicNoteSeed () {
  return b4a.toString(randomBytes(32), 'hex')
}

export function findPublicNoteSeed (noteKey, storagePath = getHyperStoragePath()) {
  if (!isPublicNoteKey(noteKey)) return null
  return readNotes(storagePath)[noteKey.trim()]?.seed || null
}

/** Keeps a public note's seed, or marks it used again, so it can be hosted later. */
export function rememberPublicNoteSeed (noteKey, seed, storagePath = getHyperStoragePath()) {
  if (!isPublicNoteKey(noteKey) || !isSeed(seed) || !isStoragePath(storagePath)) return false

  const notes = readNotes(storagePath)
  notes[noteKey.trim()] = { seed, usedAt: Date.now() }
  const kept = Object.fromEntries(
    Object.entries(notes)
      .sort(([, left], [, right]) => right.usedAt - left.usedAt)
      .slice(0, MAX_PUBLIC_NOTES)
  )

  try {
    writeSealedJson(getFilePath(storagePath), { version: 1, notes: kept }, { seal: CHAT_SEAL })
    return true
  } catch (error) {
    console.error('[p2pmd] Unable to keep a public note on this phone:', error)
    return false
  }
}

function readNotes (storagePath) {
  if (!isStoragePath(storagePath)) return {}

  try {
    const filePath = getFilePath(storagePath)
    const size = Number(statSync(filePath).size)
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) return {}

    const parsed = openJson(readFileSync(filePath, 'utf8'), filePath).value
    if (parsed?.version !== 1 || !parsed.notes || typeof parsed.notes !== 'object' || Array.isArray(parsed.notes)) {
      return {}
    }

    const notes = {}
    for (const [key, entry] of Object.entries(parsed.notes)) {
      const usedAt = Number(entry?.usedAt)
      if (isPublicNoteKey(key) && isSeed(entry?.seed) && Number.isSafeInteger(usedAt) && usedAt >= 0) {
        notes[key] = { seed: entry.seed, usedAt }
      }
    }
    return notes
  } catch {
    return {}
  }
}

function isSeed (value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function isStoragePath (value) {
  return typeof value === 'string' && value.trim() !== ''
}

function getFilePath (storagePath) {
  return `${storagePath.replace(/[\\/]+$/, '')}/${FILE_NAME}`
}
