import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import b4a from 'b4a'
import Hyperbee from 'hyperbee'
import { hash } from 'hypercore-crypto'

// Private drives a linked device made after the link. Linking sends a key and
// the drives there were then; one made since is only an address here, and read
// from the public store it is ciphertext. A drive found to open with one of
// this phone's private keys is kept here, with which key opened it, so later
// reads go straight to the private store. Kept beside the identity, outside
// any store, and only the key's fingerprint, never the key.
export const LINKED_PRIVATE_DRIVES_FILE = 'linked-private-drives.json'
const MAX_LINKED_PRIVATE_DRIVES = 1000
const HEX_DRIVE_ID = /^[0-9a-f]{64}$/
const FINGERPRINT = /^[0-9a-f]{32}$/

const cache = new Map()

export function linkedKeyFingerprint (key) {
  return b4a.toString(hash(key), 'hex').slice(0, 32)
}

function readEntries (directory) {
  if (!directory) return new Map()
  if (cache.has(directory)) return cache.get(directory)
  const entries = new Map()
  try {
    const filePath = join(directory, LINKED_PRIVATE_DRIVES_FILE)
    if (existsSync(filePath)) {
      const parsed = JSON.parse(b4a.toString(readFileSync(filePath), 'utf8'))
      if (parsed?.version === 1 && Array.isArray(parsed.drives)) {
        for (const entry of parsed.drives.slice(0, MAX_LINKED_PRIVATE_DRIVES)) {
          const id = typeof entry?.driveId === 'string' ? entry.driveId.toLowerCase() : ''
          if (HEX_DRIVE_ID.test(id) && FINGERPRINT.test(entry.key || '')) entries.set(id, entry.key)
        }
      }
    }
  } catch {}
  cache.set(directory, entries)
  return entries
}

/**
 * Of the keys given, the one a drive was found to open with, or null when the
 * drive is not one of these, or opened with a key this phone no longer has.
 */
export function linkedPrivateDriveKeyFor (directory, driveId, keys) {
  const fingerprint = readEntries(directory).get(String(driveId || '').toLowerCase())
  if (!fingerprint) return null
  return (keys || []).find((key) => key && linkedKeyFingerprint(key) === fingerprint) || null
}

export function rememberLinkedPrivateDrive (directory, driveId, key) {
  const id = String(driveId || '').toLowerCase()
  if (!directory || !key || !HEX_DRIVE_ID.test(id)) return false
  const fingerprint = linkedKeyFingerprint(key)
  const entries = new Map(readEntries(directory))
  if (entries.get(id) === fingerprint) return true
  entries.delete(id)
  entries.set(id, fingerprint)
  const drives = [...entries].slice(-MAX_LINKED_PRIVATE_DRIVES).map(([driveId, key]) => ({ driveId, key }))
  try {
    mkdirSync(directory, { recursive: true })
    const filePath = join(directory, LINKED_PRIVATE_DRIVES_FILE)
    const temporary = `${filePath}.tmp`
    writeFileSync(temporary, JSON.stringify({ version: 1, drives }, null, 2))
    renameSync(temporary, filePath)
  } catch {
    return false
  }
  cache.set(directory, new Map(drives.map((entry) => [entry.driveId, entry.key])))
  return true
}

export function resetLinkedPrivateDrivesCache () {
  cache.clear()
}

/**
 * Whether a drive's first block decodes under this key, tried on a session of
 * the copy a store already holds. Nothing is written anywhere for a key that
 * does not fit. The drive is not opened as a Hyperdrive to try: that takes
 * its core for itself, and waits forever on one that failed to open there.
 */
export async function decodesWithKey (corestore, driveKey, encryptionKey, timeout) {
  const session = corestore.get({ key: driveKey, encryption: { key: encryptionKey } })
  const bee = new Hyperbee(session)
  try {
    const header = await bee.getHeader({ wait: true, timeout })
    return header?.protocol === 'hyperbee'
  } catch {
    return false
  } finally {
    await bee.close().catch(() => {})
    await session.close().catch(() => {})
  }
}

// Reading an encrypted drive without its key: its first block is ciphertext
// rather than a Hyperbee header, and decoding it fails like this.
export function isUnreadableDriveError (error) {
  if (error?.code === 'DECODING_ERROR') return true
  const message = String(error?.message || error || '')
  return /decoded message is not valid|decoding[ _]error|invalid header|not a hyperbee/i.test(message)
}

export const PRIVATE_DRIVE_ERROR = 'This drive is private. Only devices linked to the one that made it can open it.'
