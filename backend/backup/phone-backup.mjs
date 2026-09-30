// node:fs and node:path rather than the bare modules: backend/bare-imports.json
// maps them at bundle time, and this way the whole flow runs under node tests.
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  writeSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import b4a from 'b4a'
import sodium from 'sodium-native'
import DeviceFile from 'device-file'
import { createArchiveReader, createArchiveWriter } from './backup-archive.mjs'
import {
  createBackupFileWriter,
  isZipHeader,
  PAYLOAD_ALGORITHM,
  readBackupFileManifest,
  readBackupFilePayload,
  readFileHead
} from './backup-file.mjs'
import { canonicalJson, deriveVerificationCode } from './identity-transfer.mjs'

export const PHONE_BACKUP_KIND = 'peersky-encrypted-backup'
export const PHONE_TRANSFER_KIND = 'peersky-identity-transfer'
export const PHONE_BACKUP_FORMAT = 'peersky-phone-backup'
export const PHONE_BACKUP_VERSION = 1
export const PHONE_TRANSFER_VERSION = 2
export const MIN_BACKUP_PASSPHRASE_LENGTH = 12
// Matches the ceiling the desktop uses and the life of the pairing code, so a
// transfer never outlives the code it was made for.
export const PHONE_TRANSFER_TTL_MS = 15 * 60 * 1000
// A transfer is streamed to disk on both sides, so this is not about memory.
// It is checked before packing so a phone never packs and sends something the
// other side would then refuse to download.
export const MAX_PHONE_TRANSFER_BYTES = 16 * 1024 * 1024 * 1024

// Argon2id at 64 MiB and three passes: slow enough that guessing a passphrase
// from a copied file is expensive, light enough for a budget phone.
export const BACKUP_KDF = Object.freeze({
  kdf: 'argon2id',
  opslimit: 3,
  memlimit: 64 * 1024 * 1024
})

// Everything a phone backup carries, relative to the app's documents folder.
// Left out on purpose: device-key.json and pairing-nonce.json (this device's
// own keys), welcome-seen, notification settings tied to this phone's
// permission, downloads, and the content blocking lists, which rebuild.
export const PHONE_BACKUP_FILES = Object.freeze([
  'browser-bookmarks.json',
  'browser-favourites.json',
  'browser-history.json',
  'browser-preferences.json',
  'browser-tabs.json',
  'hyperdrive-recents.json',
  'p2pmd-profile.json',
  'p2pmd-room-history.json',
  'peerchat-intro.json',
  'peerchat-ui-state.json',
  'peersky-identity.json',
  // The private drive key a desktop sent, kept so a phone restored from this
  // one encrypts its private files for the same desktop.
  'private-drive-key.json',
  'hyper-sdk-offline.json',
  'hyper-sdk-private-offline.json',
  'hyper-sdk-synced-private-offline.json'
])

// The Hyper stores: PeerChat and its chats, P2PMD notes, and every drive,
// public, private and this-device-only.
export const PHONE_BACKUP_STORES = Object.freeze([
  'hyper-sdk',
  'hyper-sdk-private',
  'hyper-sdk-synced-private',
  'hyper-sdk-adopted'
])

// Restoring the key clears these too, present in the backup or not: an
// offline list or an adopted drive left from the old store points at data
// that is no longer there.
const COUPLED_ENTRIES = {
  'hyper-sdk': ['hyper-sdk-offline.json'],
  'hyper-sdk-private': ['hyper-sdk-private-offline.json'],
  'hyper-sdk-synced-private': ['hyper-sdk-synced-private-offline.json', 'hyper-sdk-adopted']
}

const SPACE_MARGIN_BYTES = 32 * 1024 * 1024
const KEY_CHECK_BYTES = 16
const KEY_CHECK_CONTEXT = 'peersky-backup-key-check'
const MAX_ENTRY_NAME_LENGTH = 1024
const MAX_ENTRY_DEPTH = 64
const HEX = (length) => new RegExp(`^[0-9a-f]{${length}}$`)

/**
 * Files inside a store that must not travel. CORESTORE records the device and
 * the inode it was written for, and a copy of it refuses to open anywhere
 * else; a fresh one is written on restore. The rest are locks and logs.
 */
export function isSkippedStoreEntry (baseName) {
  return baseName === 'CORESTORE' ||
    baseName === 'LOCK' ||
    baseName === 'LOG' ||
    baseName.startsWith('LOG.old') ||
    baseName.endsWith('.lock') ||
    baseName.endsWith('.dbtmp') ||
    // Half-written files, such as a P2PMD snapshot on its way to a rename.
    baseName.endsWith('.tmp') ||
    baseName === '.DS_Store'
}

/** What a backup would hold right now, and roughly how big it is. */
export function planPhoneBackup (storagePath) {
  const entries = []
  const contents = []
  let totalBytes = 0

  for (const name of PHONE_BACKUP_FILES) {
    const info = safeLstat(join(storagePath, name))
    if (!info || !info.isFile()) continue
    entries.push({ type: 'file', name, path: join(storagePath, name), size: info.size })
    contents.push(name)
    totalBytes += info.size
  }

  for (const store of PHONE_BACKUP_STORES) {
    const root = join(storagePath, store)
    const info = safeLstat(root)
    if (!info || !info.isDirectory()) continue
    contents.push(store)
    entries.push({ type: 'dir', name: store })
    walk(root, store)
  }

  function walk (directory, relative) {
    const children = readdirSync(directory, { withFileTypes: true })
      .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory(), isFile: entry.isFile() }))
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    for (const child of children) {
      if (isSkippedStoreEntry(child.name)) continue
      const path = join(directory, child.name)
      const name = `${relative}/${child.name}`
      if (child.isDirectory) {
        entries.push({ type: 'dir', name })
        walk(path, name)
      } else if (child.isFile) {
        // Symlinks and anything else are left out: a store never has them,
        // and following one could pull in something outside the app.
        const size = lstatSync(path).size
        entries.push({ type: 'file', name, path, size })
        totalBytes += size
      }
    }
  }

  return { entries, contents, totalBytes }
}

export function validateNewBackupPassphrase (passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_BACKUP_PASSPHRASE_LENGTH) {
    throw codedError(`Use at least ${MIN_BACKUP_PASSPHRASE_LENGTH} characters for the passphrase.`, 'WEAK_PASSPHRASE')
  }
  if (passphrase.length > 1024) throw codedError('That passphrase is too long.', 'WEAK_PASSPHRASE')
}

export async function createPhoneBackup ({
  storagePath,
  outPath,
  passphrase,
  peerskyVersion = '',
  platform = '',
  onProgress,
  now = Date.now
} = {}) {
  validateNewBackupPassphrase(passphrase)
  const salt = randomBytes(sodium.crypto_pwhash_SALTBYTES)
  const key = await deriveBackupKey(passphrase, salt, BACKUP_KDF)
  const encryption = {
    algorithm: PAYLOAD_ALGORITHM,
    ...BACKUP_KDF,
    salt: b4a.toString(salt, 'hex'),
    check: b4a.toString(createKeyCheck(key), 'hex')
  }

  try {
    return await writePhoneArchive({
      storagePath,
      outPath,
      key,
      onProgress,
      describe: (plan) => describeBackup({ kind: PHONE_BACKUP_KIND, plan, peerskyVersion, platform, now }),
      finishManifest: (base, payload) => ({ ...base, encryption, ...payload })
    })
  } finally {
    sodium.sodium_memzero(key)
  }
}

/**
 * The same contents as a backup, sealed to one receiving phone instead of a
 * passphrase, and signed so the receiver can show the six character code the
 * sender shows. That code is what proves the two screens belong together.
 */
export async function createPhoneTransfer ({
  storagePath,
  outPath,
  target,
  deviceKeys,
  peerskyVersion = '',
  platform = '',
  ttlMs = PHONE_TRANSFER_TTL_MS,
  onProgress,
  now = Date.now
} = {}) {
  const targetKey = String(target?.encryptionPublicKey || '').toLowerCase()
  const nonce = String(target?.nonce || '').toLowerCase()
  if (!HEX(64).test(targetKey) || !HEX(32).test(nonce)) throw new Error('The pairing code is damaged')
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > PHONE_TRANSFER_TTL_MS) {
    throw new Error('Transfer lifetime must be between 1 ms and 15 minutes')
  }

  const contentKey = randomBytes(32)
  const encryptedKey = b4a.alloc(contentKey.byteLength + sodium.crypto_box_SEALBYTES)
  sodium.crypto_box_seal(encryptedKey, contentKey, b4a.from(targetKey, 'hex'))

  const sourceSigningPublicKey = b4a.toString(deviceKeys.signing.publicKey, 'hex')
  let transfer = null

  try {
    const result = await writePhoneArchive({
      storagePath,
      outPath,
      key: contentKey,
      onProgress,
      // The packed file is copied again onto the drive it is sent from.
      spaceNeeded: (plan) => 2 * plan.totalBytes,
      maxBytes: MAX_PHONE_TRANSFER_BYTES,
      describe: (plan) => describeBackup({ kind: PHONE_TRANSFER_KIND, plan, peerskyVersion, platform, now }),
      finishManifest: (base, payload) => {
        // The clock starts once the file exists, not when packing began, so a
        // big transfer does not arrive already half expired.
        const issuedAt = now()
        const body = {
          version: PHONE_TRANSFER_VERSION,
          algorithm: PAYLOAD_ALGORITHM,
          sourceSigningPublicKey,
          sourceEncryptionPublicKey: b4a.toString(deviceKeys.encryption.publicKey, 'hex'),
          targetDeviceType: 'mobile',
          targetEncryptionPublicKey: targetKey,
          nonce,
          issuedAt,
          expiresAt: issuedAt + ttlMs,
          encryptedKey: b4a.toString(encryptedKey, 'hex'),
          payloadBytes: payload.payloadBytes,
          payloadSha256: payload.payloadSha256
        }
        const signature = b4a.alloc(sodium.crypto_sign_BYTES)
        sodium.crypto_sign_detached(signature, b4a.from(canonicalJson(body)), deviceKeys.signing.secretKey)
        transfer = { ...body, signature: b4a.toString(signature, 'hex') }
        return { ...base, identityTransfer: transfer }
      }
    })

    return {
      ...result,
      verificationCode: deriveVerificationCode(sourceSigningPublicKey, targetKey, nonce),
      expiresAt: transfer.expiresAt
    }
  } finally {
    sodium.sodium_memzero(contentKey)
  }
}

/** Reads what a file says about itself, without the passphrase. */
export function inspectPhoneBackupFile (filePath) {
  if (isZipHeader(readFileHead(filePath, 4))) {
    // A desktop backup. Phones cannot open those: they carry the desktop's
    // own stores and use a key derivation the phone does not have.
    return { kind: 'desktop-backup' }
  }

  const manifest = readBackupFileManifest(filePath)
  const kind = validatePhoneManifest(manifest)
  return {
    kind: kind === PHONE_BACKUP_KIND ? 'backup' : 'transfer',
    createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt : null,
    deviceType: typeof manifest.deviceType === 'string' ? manifest.deviceType : 'mobile',
    platform: typeof manifest.platform === 'string' ? manifest.platform : '',
    peerskyVersion: typeof manifest.peerskyVersion === 'string' ? manifest.peerskyVersion : '',
    contents: manifest.contents,
    sizeBytes: manifest.sizeBytes,
    needsPassphrase: kind === PHONE_BACKUP_KIND
  }
}

/**
 * Decrypts a phone backup or transfer into a staging folder. Nothing in
 * storage changes here; commitStagedRestore does that once the person has
 * confirmed. A wrong passphrase, a damaged or cut off file, or a transfer
 * meant for someone else all stop here, with the staging folder removed.
 */
export async function stagePhoneBackupFile ({
  filePath,
  stagingPath,
  passphrase,
  deviceKeys,
  expectedNonce,
  now = Date.now(),
  kinds = [PHONE_BACKUP_KIND, PHONE_TRANSFER_KIND],
  onProgress
} = {}) {
  const manifest = readBackupFileManifest(filePath)
  const kind = validatePhoneManifest(manifest)
  // A transfer is only ever opened the way it was sent, with the six
  // characters on both screens compared. Opening one as a backup file would
  // skip that comparison, so the caller says which kind it expects.
  if (!kinds.includes(kind)) {
    throw codedError(
      kind === PHONE_TRANSFER_KIND
        ? 'This file is a transfer made for one phone, not a backup. On the phone that sent it, use Sync with another device instead.'
        : 'This is a backup file, not a transfer. Open it with Restore from a backup file.',
      'WRONG_KIND'
    )
  }
  let key
  let sas = null

  if (kind === PHONE_BACKUP_KIND) {
    if (typeof passphrase !== 'string' || !passphrase) {
      throw codedError('Enter the passphrase for this backup.', 'PASSPHRASE_REQUIRED')
    }
    const encryption = manifest.encryption
    key = await deriveBackupKey(passphrase, b4a.from(encryption.salt, 'hex'), encryption)
    // Checked against a value made from the key, before the payload is
    // touched: a wrong passphrase and a damaged file are different problems
    // with different fixes, and the first frame alone cannot tell them apart.
    if (!b4a.equals(createKeyCheck(key), b4a.from(encryption.check, 'hex'))) {
      sodium.sodium_memzero(key)
      throw codedError('That passphrase does not open this backup. Check it and try again.', 'WRONG_PASSPHRASE')
    }
  } else {
    const opened = openPhoneTransfer(manifest.identityTransfer, { deviceKeys, expectedNonce, now })
    key = opened.key
    sas = opened.sas
  }

  assertFreeSpace(dirname(stagingPath), manifest.sizeBytes + SPACE_MARGIN_BYTES)
  rmSync(stagingPath, { recursive: true, force: true })
  mkdirSync(stagingPath, { recursive: true })

  const restoredTop = new Set()
  let restoredFiles = 0
  let about = null
  let fd = null
  let skipping = false

  const reader = createArchiveReader({
    onAbout (header) {
      about = readAbout(header)
    },
    onDirectory (name) {
      const entry = resolvePhoneEntry(name, 'dir')
      if (!entry) return
      mkdirSync(join(stagingPath, entry.path), { recursive: true })
      restoredTop.add(entry.top)
    },
    onFileStart (name) {
      const entry = resolvePhoneEntry(name, 'file')
      if (!entry) {
        skipping = true
        return
      }
      const target = join(stagingPath, entry.path)
      mkdirSync(dirname(target), { recursive: true })
      fd = openSync(target, 'w')
      restoredTop.add(entry.top)
    },
    onFileData (chunk) {
      if (skipping) return
      let offset = 0
      while (offset < chunk.byteLength) offset += writeSync(fd, chunk, offset, chunk.byteLength - offset)
    },
    onFileEnd () {
      if (skipping) {
        skipping = false
        return
      }
      closeSync(fd)
      fd = null
      restoredFiles += 1
    }
  })

  try {
    const { payloadSha256, payloadBytes } = await readBackupFilePayload(filePath, key, {
      onChunk: (chunk) => reader.push(chunk),
      onProgress
    })
    reader.finish()

    const expected = kind === PHONE_TRANSFER_KIND ? manifest.identityTransfer : manifest
    if (expected.payloadSha256 !== payloadSha256 || expected.payloadBytes !== payloadBytes) {
      throw new Error('Backup file is damaged')
    }
    if (restoredTop.size === 0) throw new Error('The backup is empty.')

    for (const store of PHONE_BACKUP_STORES) {
      if (restoredTop.has(store)) await writeFreshDeviceFile(join(stagingPath, store))
    }
  } catch (error) {
    if (fd !== null) {
      try { closeSync(fd) } catch {}
    }
    rmSync(stagingPath, { recursive: true, force: true })
    throw error
  } finally {
    sodium.sodium_memzero(key)
  }

  const names = [...restoredTop].sort()
  const replace = []
  for (const name of names) {
    for (const coupled of COUPLED_ENTRIES[name] || []) {
      if (!restoredTop.has(coupled)) replace.push(coupled)
    }
  }

  return { kind, names, replace, restoredFiles, about, sas }
}

// Checks every name the archive hands over before anything is written. Only
// the known top-level files and stores are restored; anything else is skipped
// rather than written, which keeps a newer backup restorable on an older app.
export function resolvePhoneEntry (name, type) {
  if (typeof name !== 'string' || !name || name.length > MAX_ENTRY_NAME_LENGTH) {
    throw new Error('Backup archive is damaged')
  }
  if (name.startsWith('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error('Backup contains illegal path traversal entries')
  }

  const parts = name.split('/')
  if (parts.length > MAX_ENTRY_DEPTH) throw new Error('Backup archive is damaged')
  for (const part of parts) {
    if (!part || part === '.' || part === '..') throw new Error('Backup contains illegal path traversal entries')
  }

  const top = parts[0]
  if (parts.length === 1) {
    if (type === 'file' && PHONE_BACKUP_FILES.includes(top)) return { top, path: name }
    if (type === 'dir' && PHONE_BACKUP_STORES.includes(top)) return { top, path: name }
    return null
  }

  if (!PHONE_BACKUP_STORES.includes(top)) return null
  if (type === 'file' && isSkippedStoreEntry(parts[parts.length - 1])) return null
  return { top, path: name }
}

export function openPhoneTransfer (transfer, { deviceKeys, expectedNonce, now = Date.now() } = {}) {
  if (!transfer || typeof transfer !== 'object') throw new Error('Identity transfer metadata is missing')
  if (transfer.version !== PHONE_TRANSFER_VERSION || transfer.algorithm !== PAYLOAD_ALGORITHM) {
    throw new Error('This transfer was made by a different PeerSky version. Update both devices and send it again.')
  }

  for (const [field, length] of [
    ['sourceSigningPublicKey', 64],
    ['sourceEncryptionPublicKey', 64],
    ['targetEncryptionPublicKey', 64],
    ['nonce', 32],
    ['encryptedKey', (32 + sodium.crypto_box_SEALBYTES) * 2],
    ['payloadSha256', 64],
    ['signature', sodium.crypto_sign_BYTES * 2]
  ]) {
    if (typeof transfer[field] !== 'string' || !HEX(length).test(transfer[field])) {
      throw new Error('Identity transfer metadata is invalid')
    }
  }
  if (transfer.targetDeviceType !== 'mobile') throw new Error('Identity transfer metadata is invalid')
  if (!Number.isSafeInteger(transfer.payloadBytes) || transfer.payloadBytes < 0) {
    throw new Error('Identity transfer metadata is invalid')
  }

  if (!Number.isSafeInteger(transfer.issuedAt) || !Number.isSafeInteger(transfer.expiresAt)) {
    throw new Error('Identity transfer is missing timestamps')
  }
  if (transfer.expiresAt <= transfer.issuedAt || transfer.expiresAt - transfer.issuedAt > PHONE_TRANSFER_TTL_MS) {
    throw new Error('Identity transfer TTL exceeds maximum allowed duration')
  }
  if (now > transfer.expiresAt) {
    throw new Error('This transfer has expired. Send it again from the other phone.')
  }
  if (now < transfer.issuedAt - 60000) {
    throw new Error('Identity transfer is issued in the future. Check the clock on both phones.')
  }

  if (!expectedNonce || transfer.nonce !== expectedNonce) {
    throw new Error('This transfer was made for a different code. Scan this phone\'s code again on the other phone.')
  }

  const ownKey = b4a.toString(deviceKeys.encryption.publicKey, 'hex')
  if (transfer.targetEncryptionPublicKey !== ownKey) {
    throw new Error('Identity transfer is encrypted for a different device')
  }

  const { signature, ...body } = transfer
  const verified = sodium.crypto_sign_verify_detached(
    b4a.from(signature, 'hex'),
    b4a.from(canonicalJson(body)),
    b4a.from(transfer.sourceSigningPublicKey, 'hex')
  )
  if (!verified) throw new Error('Identity transfer signature is invalid')

  const key = b4a.alloc(32)
  const opened = sodium.crypto_box_seal_open(
    key,
    b4a.from(transfer.encryptedKey, 'hex'),
    deviceKeys.encryption.publicKey,
    deviceKeys.encryption.secretKey
  )
  if (!opened) throw new Error('Could not decrypt identity transfer key')

  return {
    key,
    sas: deriveVerificationCode(transfer.sourceSigningPublicKey, transfer.targetEncryptionPublicKey, transfer.nonce)
  }
}

export function validatePhoneManifest (manifest) {
  if (!manifest || manifest.format !== PHONE_BACKUP_FORMAT) {
    throw new Error('This file is not a PeerSky phone backup.')
  }
  if (manifest.version !== PHONE_BACKUP_VERSION) {
    throw new Error('This backup was made by a newer PeerSky. Update the app, then try again.')
  }
  if (manifest.kind !== PHONE_BACKUP_KIND && manifest.kind !== PHONE_TRANSFER_KIND) {
    throw new Error('This file is not a PeerSky phone backup.')
  }
  if (!Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes < 0) throw new Error('Backup file is damaged')
  if (!Array.isArray(manifest.contents) || manifest.contents.length > 64 ||
      manifest.contents.some((name) => typeof name !== 'string' || !name || name.length > 256)) {
    throw new Error('Backup file is damaged')
  }

  if (manifest.kind === PHONE_BACKUP_KIND) {
    const encryption = manifest.encryption
    if (!encryption || encryption.algorithm !== PAYLOAD_ALGORITHM || encryption.kdf !== 'argon2id') {
      throw new Error('This backup uses encryption this version of PeerSky does not know.')
    }
    // Bounded, so a crafted file cannot ask the phone for gigabytes of memory
    // or minutes of work before the passphrase is even checked.
    if (!Number.isSafeInteger(encryption.opslimit) || encryption.opslimit < 1 || encryption.opslimit > 10 ||
        !Number.isSafeInteger(encryption.memlimit) || encryption.memlimit < 8 * 1024 * 1024 ||
        encryption.memlimit > 256 * 1024 * 1024 ||
        typeof encryption.salt !== 'string' || !HEX(sodium.crypto_pwhash_SALTBYTES * 2).test(encryption.salt) ||
        typeof encryption.check !== 'string' || !HEX(KEY_CHECK_BYTES * 2).test(encryption.check)) {
      throw new Error('Backup file is damaged')
    }
    if (typeof manifest.payloadSha256 !== 'string' || !HEX(64).test(manifest.payloadSha256) ||
        !Number.isSafeInteger(manifest.payloadBytes)) {
      throw new Error('Backup file is damaged')
    }
  }

  return manifest.kind
}

export async function deriveBackupKey (passphrase, salt, { opslimit, memlimit }) {
  const key = b4a.alloc(32)
  const password = b4a.from(normalizePassphrase(passphrase))
  try {
    if (typeof sodium.crypto_pwhash_async === 'function') {
      await sodium.crypto_pwhash_async(key, password, salt, opslimit, memlimit, sodium.crypto_pwhash_ALG_ARGON2ID13)
    } else {
      sodium.crypto_pwhash(key, password, salt, opslimit, memlimit, sodium.crypto_pwhash_ALG_ARGON2ID13)
    }
  } finally {
    sodium.sodium_memzero(password)
  }
  return key
}

// The same passphrase typed on two keyboards can come out as different code
// points for an accented letter. Composing it first means it still opens.
function normalizePassphrase (passphrase) {
  try {
    return typeof passphrase.normalize === 'function' ? passphrase.normalize('NFC') : passphrase
  } catch {
    return passphrase
  }
}

async function writePhoneArchive ({
  storagePath,
  outPath,
  key,
  onProgress,
  describe,
  finishManifest,
  spaceNeeded = (plan) => plan.totalBytes,
  maxBytes = Infinity
}) {
  const plan = planPhoneBackup(storagePath)
  if (plan.contents.length === 0) throw new Error('There is nothing on this phone to back up yet.')
  if (plan.totalBytes > maxBytes) {
    throw codedError(
      `This phone holds ${formatBytes(plan.totalBytes)}, more than can be sent in one go (${formatBytes(maxBytes)}). Clear cached P2P data in Settings, or save a backup file instead.`,
      'TOO_LARGE'
    )
  }
  assertFreeSpace(dirname(outPath), spaceNeeded(plan) + SPACE_MARGIN_BYTES)

  const partialPath = `${outPath}.partial`
  mkdirSync(dirname(outPath), { recursive: true })
  rmSync(partialPath, { force: true })

  const writer = createBackupFileWriter(partialPath, key)
  const base = describe(plan)
  let written = 0
  const archive = createArchiveWriter(async (bytes) => {
    await writer.write(bytes)
    written += bytes.byteLength
    if (onProgress) onProgress(Math.min(written, plan.totalBytes), plan.totalBytes)
  })

  try {
    await archive.addAbout({
      format: PHONE_BACKUP_FORMAT,
      createdAt: base.createdAt,
      deviceType: base.deviceType,
      platform: base.platform,
      peerskyVersion: base.peerskyVersion,
      contents: base.contents
    })
    for (const entry of plan.entries) {
      if (entry.type === 'dir') await archive.addDirectory(entry.name)
      else await archive.addFile(entry.name, entry.path)
    }
    await archive.end()

    const { bytes, manifest } = writer.finish((payload) => finishManifest(base, payload))
    renameSync(partialPath, outPath)
    return { path: outPath, bytes, manifest, contents: plan.contents, sizeBytes: plan.totalBytes }
  } catch (error) {
    writer.abort()
    rmSync(partialPath, { force: true })
    throw error
  }
}

function describeBackup ({ kind, plan, peerskyVersion, platform, now }) {
  return {
    version: PHONE_BACKUP_VERSION,
    kind,
    format: PHONE_BACKUP_FORMAT,
    deviceType: 'mobile',
    platform: String(platform || ''),
    peerskyVersion: String(peerskyVersion || ''),
    createdAt: new Date(now()).toISOString(),
    contents: plan.contents,
    sizeBytes: plan.totalBytes
  }
}

function readAbout (header) {
  return {
    createdAt: typeof header.createdAt === 'string' ? header.createdAt : null,
    deviceType: typeof header.deviceType === 'string' ? header.deviceType : 'mobile',
    platform: typeof header.platform === 'string' ? header.platform : '',
    peerskyVersion: typeof header.peerskyVersion === 'string' ? header.peerskyVersion : '',
    contents: Array.isArray(header.contents) ? header.contents.filter((name) => typeof name === 'string').slice(0, 64) : []
  }
}

// A restored store gets a device file of its own. Without one, the storage
// layer takes the folder for an old layout and moves everything it does not
// recognise into db/, and PeerChat's state and the P2PMD snapshots live in
// that folder. Written in staging: the rename into place keeps the inode it
// records.
async function writeFreshDeviceFile (storeRoot) {
  const deviceFile = new DeviceFile(join(storeRoot, 'CORESTORE'), { lock: false, data: {} })
  await deviceFile.ready()
  await deviceFile.close()
}

function assertFreeSpace (directory, neededBytes) {
  let free = null
  try {
    mkdirSync(directory, { recursive: true })
    const info = statfsSync(directory)
    free = Number(info.bavail) * Number(info.bsize)
  } catch {}

  if (free !== null && Number.isFinite(free) && free < neededBytes) {
    throw codedError(
      `Not enough free space. This needs about ${formatBytes(neededBytes)}, and the phone has ${formatBytes(free)} free.`,
      'NO_SPACE'
    )
  }
}

export function formatBytes (bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function safeLstat (path) {
  try {
    return existsSync(path) ? lstatSync(path) : null
  } catch {
    return null
  }
}

// A keyed hash of a fixed string. It says whether a passphrase is right
// without decrypting anything, and says nothing that the Argon2id cost does
// not already protect.
function createKeyCheck (key) {
  const check = b4a.alloc(KEY_CHECK_BYTES)
  sodium.crypto_generichash(check, b4a.from(KEY_CHECK_CONTEXT), key)
  return check
}

function randomBytes (length) {
  const bytes = b4a.alloc(length)
  sodium.randombytes_buf(bytes)
  return bytes
}

function codedError (message, code) {
  const error = new Error(message)
  error.code = code
  return error
}
