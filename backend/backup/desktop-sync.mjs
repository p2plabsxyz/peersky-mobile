// node:crypto, node:fs and node:path rather than the bare modules:
// backend/bare-imports.json maps them at bundle time, and this way the whole
// flow runs under node tests.
import { createCipheriv, createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import b4a from 'b4a'
import sodium from 'sodium-native'
import {
  canonicalJson,
  deriveVerificationCode,
  IDENTITY_PAYLOAD_NAME,
  IDENTITY_TRANSFER_KIND,
  MANIFEST_NAME,
  transferBody
} from './identity-transfer.mjs'
import { isImportableUrl } from './browser-import.mjs'
import { getPrivateDriveKeyRecord } from '../hyper/private-keys.mjs'
import { createStoredZip } from './zip-writer.mjs'

// What a phone sends to PeerSky Desktop: its open tabs, its bookmarks and
// favourites, and its private drive with the key to it. The rest of a phone,
// its chats and notes and stores, means nothing to the desktop, which keeps
// those its own way.
//
// It goes in the desktop's own transfer format, so the desktop checks it with
// the code it already has: a zip of a signed manifest and a payload that is
// AES-256-GCM encrypted with a key sealed to the desktop. Both screens show
// the same six characters, derived the same way as every other transfer.
export const DESKTOP_SYNC_SOURCE = 'mobile'
export const PHONE_TABS_FILE = 'phone-tabs.json'
export const PHONE_BOOKMARKS_FILE = 'phone-bookmarks.json'
export const PHONE_PRIVATE_DRIVES_FILE = 'phone-private-drives.json'
// The desktop fetches this name when it is given a drive's bare address.
export const DESKTOP_TRANSFER_FILE_NAME = '/backup.zip'
export const DESKTOP_TRANSFER_TTL_MS = 15 * 60 * 1000

const DESKTOP_FORMAT_VERSION = '1.0.0'
const DESKTOP_TRANSFER_VERSION = 1
const MAX_TABS = 100
const MAX_BOOKMARKS = 1000
const MAX_TITLE_LENGTH = 256
const HEX = (length) => new RegExp(`^[0-9a-f]{${length}}$`)

/**
 * Reads what would be sent, from the files the app keeps. Tabs are taken at
 * the page each one is on; peersky:// pages are the phone's own and stay.
 */
export function collectDesktopSync ({ storagePath, syncedPrivatePath } = {}) {
  const tabs = []
  const seenTabs = new Set()
  for (const tab of readJson(join(storagePath, 'browser-tabs.json'))?.tabs || []) {
    const entry = normalizeEntry(currentTabUrl(tab), tab?.title)
    if (!entry || seenTabs.has(entry.url)) continue
    seenTabs.add(entry.url)
    tabs.push(entry)
    if (tabs.length === MAX_TABS) break
  }

  const bookmarks = []
  const seenBookmarks = new Set()
  for (const name of ['browser-bookmarks.json', 'browser-favourites.json']) {
    for (const item of readJson(join(storagePath, name))?.items || []) {
      const entry = normalizeEntry(item?.url, item?.title)
      if (!entry || seenBookmarks.has(entry.url) || bookmarks.length === MAX_BOOKMARKS) continue
      seenBookmarks.add(entry.url)
      const createdAt = Number(item.createdAt)
      bookmarks.push({ ...entry, createdAt: Number.isSafeInteger(createdAt) && createdAt > 0 ? createdAt : null })
    }
  }

  return { tabs, bookmarks, privateDrives: sharedPrivateDrives(syncedPrivatePath) }
}

/**
 * The phone's private drive, with its key. The desktop opens it with that
 * key, so it does not matter which key the drive was made with: one from
 * before the phone was linked opens there too, and so does one sent to a
 * second desktop. The key is safe in transit: the payload is sealed to the
 * desktop, and the person has checked the code on both screens.
 */
export function sharedPrivateDrives (syncedPrivatePath) {
  if (!syncedPrivatePath) return []
  const own = getPrivateDriveKeyRecord(syncedPrivatePath)
  if (!own.ok || !own.key || !own.driveId) return []
  return [{ driveId: own.driveId, key: b4a.toString(own.key, 'hex') }]
}

export async function createDesktopTransfer ({
  storagePath,
  syncedPrivatePath,
  outPath,
  target,
  deviceKeys,
  peerskyVersion = '',
  ttlMs = DESKTOP_TRANSFER_TTL_MS,
  now = Date.now
} = {}) {
  const targetKey = String(target?.encryptionPublicKey || '').toLowerCase()
  const nonce = String(target?.nonce || '').toLowerCase()
  if (!HEX(64).test(targetKey) || !HEX(32).test(nonce)) throw new Error('The pairing code is damaged')
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > DESKTOP_TRANSFER_TTL_MS) {
    throw new Error('Transfer lifetime must be between 1 ms and 15 minutes')
  }

  const sync = collectDesktopSync({ storagePath, syncedPrivatePath })
  if (sync.tabs.length === 0 && sync.bookmarks.length === 0 && sync.privateDrives.length === 0) {
    const error = new Error('There are no open pages or bookmarks on this phone to send yet.')
    error.code = 'NOTHING_TO_SEND'
    throw error
  }

  const createdAt = new Date(now()).toISOString()
  const files = [
    { name: PHONE_TABS_FILE, bytes: jsonBytes({ version: 1, tabs: sync.tabs }) },
    { name: PHONE_BOOKMARKS_FILE, bytes: jsonBytes({ version: 1, bookmarks: sync.bookmarks }) }
  ]
  if (sync.privateDrives.length > 0) {
    files.push({ name: PHONE_PRIVATE_DRIVES_FILE, bytes: jsonBytes({ version: 1, drives: sync.privateDrives }) })
  }
  const innerManifest = {
    version: DESKTOP_FORMAT_VERSION,
    peerskyVersion: String(peerskyVersion || ''),
    createdAt,
    source: DESKTOP_SYNC_SOURCE,
    files: Object.fromEntries(files.map((file) => [file.name, `sha256:${sha256(file.bytes)}`]))
  }
  const innerZip = createStoredZip([...files, { name: MANIFEST_NAME, bytes: jsonBytes(innerManifest) }])

  const contentKey = randomBytes(32)
  try {
    const iv = randomBytes(12)
    // bare-crypto seals GCM in one piece at final(); node streams it through
    // update(). Taking both covers either, and the payload here is small.
    const cipher = createCipheriv('aes-256-gcm', contentKey, iv)
    const payload = b4a.concat([toBuffer(cipher.update(innerZip)), toBuffer(cipher.final())])
    const authTag = toBuffer(cipher.getAuthTag())

    const encryptedKey = b4a.alloc(contentKey.byteLength + sodium.crypto_box_SEALBYTES)
    sodium.crypto_box_seal(encryptedKey, contentKey, b4a.from(targetKey, 'hex'))

    const sourceSigningPublicKey = b4a.toString(deviceKeys.signing.publicKey, 'hex')
    const issuedAt = now()
    const transfer = {
      version: DESKTOP_TRANSFER_VERSION,
      identityId: readIdentityId(storagePath),
      sourceSigningPublicKey,
      sourceEncryptionPublicKey: b4a.toString(deviceKeys.encryption.publicKey, 'hex'),
      targetDeviceType: 'desktop',
      targetEncryptionPublicKey: targetKey,
      channel: b4a.toString(randomBytes(32), 'hex'),
      nonce,
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      encryptedKey: b4a.toString(encryptedKey, 'hex'),
      iv: b4a.toString(iv, 'hex'),
      authTag: b4a.toString(authTag, 'hex'),
      payloadSha256: sha256(payload)
    }
    const signature = b4a.alloc(sodium.crypto_sign_BYTES)
    sodium.crypto_sign_detached(signature, b4a.from(canonicalJson(transferBody(transfer))), deviceKeys.signing.secretKey)

    const manifest = {
      version: DESKTOP_FORMAT_VERSION,
      kind: IDENTITY_TRANSFER_KIND,
      peerskyVersion: String(peerskyVersion || ''),
      createdAt,
      identityTransfer: { ...transfer, signature: b4a.toString(signature, 'hex') }
    }
    const outer = createStoredZip([
      { name: MANIFEST_NAME, bytes: jsonBytes(manifest) },
      { name: IDENTITY_PAYLOAD_NAME, bytes: payload }
    ])

    const partialPath = `${outPath}.partial`
    mkdirSync(dirname(outPath), { recursive: true })
    try {
      writeFileSync(partialPath, outer)
      renameSync(partialPath, outPath)
    } catch (error) {
      rmSync(partialPath, { force: true })
      throw error
    }

    return {
      path: outPath,
      bytes: outer.byteLength,
      verificationCode: deriveVerificationCode(sourceSigningPublicKey, targetKey, nonce),
      expiresAt: transfer.expiresAt,
      sent: {
        tabs: sync.tabs.length,
        bookmarks: sync.bookmarks.length,
        privateDrives: sync.privateDrives.length
      }
    }
  } finally {
    sodium.sodium_memzero(contentKey)
  }
}

// The profile this phone got from a desktop, when it has one. A phone that
// never had one sends a fresh id each time: the desktop only checks its form.
function readIdentityId (storagePath) {
  const identity = readJson(join(storagePath, 'peersky-identity.json'))
  const id = String(identity?.identityId || '').toLowerCase()
  return HEX(64).test(id) ? id : b4a.toString(randomBytes(32), 'hex')
}

function currentTabUrl (tab) {
  if (!tab || typeof tab !== 'object') return null
  const history = Array.isArray(tab.history) ? tab.history : []
  const index = Number.isSafeInteger(tab.historyIndex) ? tab.historyIndex : history.length - 1
  return history[index]?.url || tab.entry?.url || null
}

function normalizeEntry (url, title) {
  if (!isImportableUrl(url)) return null
  const cleanTitle = typeof title === 'string'
    ? Array.from(title.replace(/\s+/g, ' ').trim()).slice(0, MAX_TITLE_LENGTH).join('')
    : ''
  return { url, title: cleanTitle || url }
}

function readJson (path) {
  try {
    return existsSync(path) ? JSON.parse(b4a.toString(readFileSync(path), 'utf8')) : null
  } catch {
    return null
  }
}

function jsonBytes (value) {
  return b4a.from(JSON.stringify(value, null, 2), 'utf8')
}

function sha256 (bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function toBuffer (value) {
  return value ? b4a.from(value.buffer, value.byteOffset, value.byteLength) : b4a.alloc(0)
}

function randomBytes (length) {
  const bytes = b4a.alloc(length)
  sodium.randombytes_buf(bytes)
  return bytes
}
