import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import b4a from 'b4a'
import sodium from 'sodium-native'

// Files that hold private things, the key to the private drives and the names
// of private files, are locked with a key the app keeps in the system's secure
// storage: the iOS Keychain, or under an Android Keystore key, on this device
// only (app/privacy/local-seal-key.ts). The app hands it over as the backend
// starts. A copy of such a file taken off the phone shows nothing, and nobody
// is asked for anything.
//
// A file written before this is read as it was, and locked the next time it
// is written, or at start (sealFilesAtRest). A locked file that cannot be
// opened is an error, never a reason to start over: for the key, starting
// over would lose every private drive. A backup unlocks what it packs
// (openSealedForBackup), since it is itself encrypted, and a phone it is
// restored on has a key of its own.

const MARK = 'peersky-sealed'
export const LOCAL_SEAL_KEY_BYTES = sodium.crypto_secretbox_KEYBYTES

let sealKey = null

/** The key from the app, as hex; anything else leaves files as they were. */
export function setLocalSealKey (hex) {
  const value = typeof hex === 'string' ? hex.trim().toLowerCase() : ''
  sealKey = /^[0-9a-f]{64}$/.test(value) ? b4a.from(value, 'hex') : null
  return sealKey !== null
}

export function canSeal () {
  return sealKey !== null
}

/** A key of its own for a purpose, made from the seal key, or null. */
export function deriveLocalKey (context) {
  if (!sealKey) return null
  const out = b4a.alloc(32)
  sodium.crypto_generichash(out, b4a.from(`peersky-local:${context}`), sealKey)
  return out
}

export class SealedFileError extends Error {
  constructor (filePath, cause) {
    super(`${String(filePath).split('/').pop()} is locked with this phone's secure storage and could not be opened`)
    this.name = 'SealedFileError'
    this.code = 'SEALED_FILE_LOCKED'
    this.cause = cause
  }
}

function isSealed (parsed) {
  return Boolean(parsed && parsed[MARK] === 1 && typeof parsed.nonce === 'string' && typeof parsed.box === 'string')
}

/** The text to write for value: locked when there is a key, plain JSON when not. */
export function sealJson (value) {
  if (!sealKey) return JSON.stringify(value, null, 2)
  const message = b4a.from(JSON.stringify(value))
  const nonce = b4a.alloc(sodium.crypto_secretbox_NONCEBYTES)
  sodium.randombytes_buf(nonce)
  const box = b4a.alloc(message.byteLength + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(box, message, nonce, sealKey)
  return JSON.stringify({ [MARK]: 1, nonce: b4a.toString(nonce, 'hex'), box: b4a.toString(box, 'base64') })
}

/** The value in text, and whether it was locked. */
export function openJson (text, filePath = 'file') {
  const parsed = JSON.parse(text)
  if (!isSealed(parsed)) return { value: parsed, sealed: false }
  try {
    if (!sealKey) throw new Error('No seal key')
    const box = b4a.from(parsed.box, 'base64')
    const nonce = b4a.from(parsed.nonce, 'hex')
    if (box.byteLength < sodium.crypto_secretbox_MACBYTES || nonce.byteLength !== sodium.crypto_secretbox_NONCEBYTES) {
      throw new Error('Damaged')
    }
    const message = b4a.alloc(box.byteLength - sodium.crypto_secretbox_MACBYTES)
    if (!sodium.crypto_secretbox_open_easy(message, box, nonce, sealKey)) throw new Error('Not opened')
    return { value: JSON.parse(b4a.toString(message, 'utf8')), sealed: true }
  } catch (error) {
    throw new SealedFileError(filePath, error)
  }
}

/** null when the file is not there. */
export function readSealedJson (filePath) {
  if (!existsSync(filePath)) return null
  return openJson(b4a.toString(readFileSync(filePath), 'utf8'), filePath)
}

/** flag 'wx' writes only where there is no file yet, and throws EEXIST otherwise. */
export function writeSealedJson (filePath, value, { flag = 'w' } = {}) {
  mkdirSync(dirname(filePath), { recursive: true })
  if (flag === 'wx') {
    writeFileSync(filePath, sealJson(value), { flag: 'wx' })
    return
  }
  const temporary = `${filePath}.tmp`
  try {
    writeFileSync(temporary, sealJson(value))
    renameSync(temporary, filePath)
  } finally {
    rmSync(temporary, { force: true })
  }
}

/**
 * For a backup: the plain JSON of a locked file, or null when the bytes are
 * not a locked file. Throws when it is one this phone cannot open.
 */
export function openSealedForBackup (bytes, filePath = 'file') {
  let parsed
  try {
    parsed = JSON.parse(b4a.toString(bytes, 'utf8'))
  } catch {
    return null
  }
  if (!isSealed(parsed)) return null
  return b4a.from(JSON.stringify(openJson(b4a.toString(bytes, 'utf8'), filePath).value, null, 2))
}

/** Locks the given files that are still plain. Returns the ones it locked. */
export function sealFilesAtRest (filePaths) {
  if (!sealKey) return []
  const sealed = []
  for (const filePath of filePaths) {
    try {
      const read = readSealedJson(filePath)
      if (read && !read.sealed) {
        writeSealedJson(filePath, read.value)
        sealed.push(filePath)
      }
    } catch {}
  }
  return sealed
}
