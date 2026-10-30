import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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
// Chats and notes are locked with a second key, one the system gives the app
// only while the phone is unlocked: the iOS Keychain's when-unlocked class, or
// an Android Keystore key that needs the phone unlocked
// (app/privacy/chat-seal-key.ts). A phone that is locked shows nothing of them
// to anyone who copies its files, the forensic tools that read a phone after
// its first unlock included. A file locked with it says so; one that names no
// key is the local key's.
export const CHAT_SEAL = 'chat'

let sealKey = null
// A key was made on this phone and the app could not read it this time
// (app/privacy/local-seal-key-state.mjs). Nothing it would lock is written
// then: plain, it would be out in the open, and over a locked file, lost.
let sealKeyMissing = false

let chatKey = null
// ready: the key is here. locked: the phone is locked, and it comes at the
// unlock. missing: one was made here and can no longer be read. unavailable:
// this phone's secure storage cannot keep one, so chats are kept as they
// always were. unset: nobody said, as in a test.
let chatKeyState = 'unset'
const chatKeyWaiters = new Set()
const CHAT_KEY_STATES = new Set(['locked', 'missing', 'unavailable'])

/**
 * The key from the app, as hex; anything else leaves files as they were.
 * missing says the phone has a key the app could not read.
 */
export function setLocalSealKey (hex, { missing = false } = {}) {
  const value = typeof hex === 'string' ? hex.trim().toLowerCase() : ''
  sealKey = /^[0-9a-f]{64}$/.test(value) ? b4a.from(value, 'hex') : null
  sealKeyMissing = sealKey === null && missing === true
  return sealKey !== null
}

export function canSeal () {
  return sealKey !== null
}

/**
 * The chat key from the app, as hex, or the reason there is none. Once here
 * it stays for as long as the backend runs, the phone locked or not, the way
 * a chat app keeps what it has open.
 */
export function setChatSealKey (hex, { state = '' } = {}) {
  const value = typeof hex === 'string' ? hex.trim().toLowerCase() : ''
  if (/^[0-9a-f]{64}$/.test(value)) {
    const key = b4a.from(value, 'hex')
    // Another key than the one in use would lock new writes away from what
    // the first one locked.
    if (chatKey && !b4a.equals(chatKey, key)) return false
    chatKey = key
    chatKeyState = 'ready'
  } else if (chatKey) {
    return true
  } else {
    chatKeyState = CHAT_KEY_STATES.has(state) ? state : 'unset'
  }
  if (chatKeyState !== 'locked') {
    for (const waiter of chatKeyWaiters) waiter()
    chatKeyWaiters.clear()
  }
  return chatKey !== null
}

export function getChatSealKeyState () {
  return chatKeyState
}

// Back to a backend that was told nothing, as a test starts. The app never
// takes a key back: a new backend starts with none.
export function resetChatSealKey () {
  chatKey = null
  chatKeyState = 'unset'
  for (const waiter of chatKeyWaiters) waiter()
  chatKeyWaiters.clear()
}

export function canSealChats () {
  return chatKey !== null
}

/**
 * Resolves once chats and notes can be opened: at once with the key, or on a
 * phone that keeps them plain, and at the unlock while it is locked. Throws
 * when the key made here can no longer be read.
 */
export function waitForChatSealKey () {
  if (chatKeyState === 'locked') {
    return new Promise((resolve) => { chatKeyWaiters.add(resolve) }).then(waitForChatSealKey)
  }
  if (chatKeyState === 'missing') return Promise.reject(new ChatKeyMissingError())
  return Promise.resolve()
}

export class ChatKeyMissingError extends Error {
  constructor (locked = false) {
    super(locked
      ? 'Your chats and notes open once this phone is unlocked'
      : 'This phone no longer gives PeerSky the key your chats and notes are locked with, so they cannot be opened')
    this.name = 'ChatKeyMissingError'
    this.code = locked ? 'CHAT_KEY_LOCKED' : 'CHAT_KEY_MISSING'
  }
}

/** A key of its own for a purpose, made from the chat key, or null. */
export function deriveChatKey (context) {
  if (!chatKey) return null
  const out = b4a.alloc(32)
  sodium.crypto_generichash(out, b4a.from(`peersky-chat:${context}`), chatKey)
  return out
}

/** bytes locked with key: a nonce, then the box. */
export function sealBytes (bytes, key) {
  const nonce = b4a.alloc(sodium.crypto_secretbox_NONCEBYTES)
  sodium.randombytes_buf(nonce)
  const box = b4a.alloc(bytes.byteLength + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(box, bytes, nonce, key)
  return b4a.concat([nonce, box])
}

/** What sealBytes locked. Throws for bytes another key locked, or none. */
export function openBytes (sealed, key) {
  const nonceBytes = sodium.crypto_secretbox_NONCEBYTES
  if (!sealed || sealed.byteLength < nonceBytes + sodium.crypto_secretbox_MACBYTES) throw new Error('Damaged')
  const nonce = sealed.subarray(0, nonceBytes)
  const box = sealed.subarray(nonceBytes)
  const message = b4a.alloc(box.byteLength - sodium.crypto_secretbox_MACBYTES)
  if (!sodium.crypto_secretbox_open_easy(message, box, nonce, key)) throw new Error('Not opened')
  return message
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

function keyFor (seal) {
  return seal === CHAT_SEAL ? chatKey : sealKey
}

export class SealKeyMissingError extends Error {
  constructor () {
    super('This phone\'s secure storage did not give PeerSky its key, so nothing private is saved until it does')
    this.name = 'SealKeyMissingError'
    this.code = 'SEAL_KEY_MISSING'
  }
}

/**
 * The text to write for value: locked when there is a key, plain JSON when
 * the phone has none. Throws when it has one that could not be read. seal
 * CHAT_SEAL locks it with the chat key, which is not there while the phone is
 * locked after a start, and then nothing is written.
 */
export function sealJson (value, { seal = '' } = {}) {
  const key = keyFor(seal)
  if (!key) {
    if (seal === CHAT_SEAL) {
      if (chatKeyState === 'locked') throw new ChatKeyMissingError(true)
      if (chatKeyState === 'missing') throw new ChatKeyMissingError()
    } else if (sealKeyMissing) {
      throw new SealKeyMissingError()
    }
    // As each was written before: chats and notes in one line, since
    // PeerChat's file runs to megabytes.
    return seal === CHAT_SEAL ? JSON.stringify(value) : JSON.stringify(value, null, 2)
  }
  const sealed = sealBytes(b4a.from(JSON.stringify(value)), key)
  const nonceBytes = sodium.crypto_secretbox_NONCEBYTES
  return JSON.stringify({
    [MARK]: 1,
    ...(seal === CHAT_SEAL && { key: CHAT_SEAL }),
    nonce: b4a.toString(sealed.subarray(0, nonceBytes), 'hex'),
    box: b4a.toString(sealed.subarray(nonceBytes), 'base64')
  })
}

/** The value in text, and whether it was locked. */
export function openJson (text, filePath = 'file') {
  const parsed = JSON.parse(text)
  if (!isSealed(parsed)) return { value: parsed, sealed: false }
  try {
    const seal = parsed.key === CHAT_SEAL ? CHAT_SEAL : ''
    const key = keyFor(seal)
    if (!key) throw new Error(seal === CHAT_SEAL ? 'No chat key' : 'No seal key')
    const box = b4a.from(parsed.box, 'base64')
    const nonce = b4a.from(parsed.nonce, 'hex')
    if (nonce.byteLength !== sodium.crypto_secretbox_NONCEBYTES) throw new Error('Damaged')
    const message = openBytes(b4a.concat([nonce, box]), key)
    return { value: JSON.parse(b4a.toString(message, 'utf8')), sealed: true, seal }
  } catch (error) {
    throw new SealedFileError(filePath, error)
  }
}

/** Whether text is a file locked with the chat key. */
export function isChatSealedText (text) {
  try {
    const parsed = JSON.parse(text)
    return isSealed(parsed) && parsed.key === CHAT_SEAL
  } catch {
    return false
  }
}

// How every file sealJson locks with the chat key starts.
const CHAT_SEALED_START = b4a.from(`{"${MARK}":1,"key":"${CHAT_SEAL}"`)

/**
 * Whether the file is one locked with the chat key, from its first bytes, so
 * a big one is not read whole to find out.
 */
export function isChatSealedFile (filePath) {
  let fd
  try {
    fd = openSync(filePath, 'r')
    const start = b4a.alloc(CHAT_SEALED_START.byteLength)
    return readSync(fd, start, 0, start.byteLength, 0) === start.byteLength && b4a.equals(start, CHAT_SEALED_START)
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** null when the file is not there. */
export function readSealedJson (filePath) {
  if (!existsSync(filePath)) return null
  return openJson(b4a.toString(readFileSync(filePath), 'utf8'), filePath)
}

/**
 * flag 'wx' writes only where there is no file yet, and throws EEXIST
 * otherwise. seal: see sealJson.
 */
export function writeSealedJson (filePath, value, { flag = 'w', seal = '', mode } = {}) {
  // Made before anything is written, so a file that may not be written is
  // never half done.
  const text = sealJson(value, { seal })
  mkdirSync(dirname(filePath), { recursive: true })
  if (flag === 'wx') {
    writeFileSync(filePath, text, { flag: 'wx', ...(mode && { mode }) })
    return
  }
  const temporary = `${filePath}.tmp`
  try {
    writeFileSync(temporary, text, mode ? { mode } : undefined)
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

/**
 * Locks the given files that are still plain. Returns the ones it locked.
 * seal: see sealJson.
 */
export function sealFilesAtRest (filePaths, { seal = '' } = {}) {
  if (!keyFor(seal)) return []
  const sealed = []
  for (const filePath of filePaths) {
    try {
      // PeerChat's file runs to megabytes, and it is locked already almost
      // every time.
      if (seal === CHAT_SEAL && isChatSealedFile(filePath)) continue
      const read = readSealedJson(filePath)
      if (read && !read.sealed) {
        writeSealedJson(filePath, read.value, { seal })
        sealed.push(filePath)
      }
    } catch {}
  }
  return sealed
}
