import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import b4a from 'b4a'
import { randomBytes } from 'hypercore-crypto'

export const PRIVATE_DRIVE_KEY_FILE = 'private-drive-key.json'
export const PRIVATE_DRIVE_KEY_BYTES = 32
export const PRIVATE_DRIVE_ID_BYTES = 32
const PRIVATE_DRIVE_ID_HEX_LENGTH = PRIVATE_DRIVE_ID_BYTES * 2

let cachedEntry = null

export function getPrivateDriveKeyRecord (storagePath) {
  if (!storagePath) return { ok: false }
  const filePath = getPrivateDriveKeyFile(storagePath)

  try {
    if (!existsSync(filePath)) return { ok: false }
    const parsed = JSON.parse(b4a.toString(readFileSync(filePath), 'utf8'))
    return normalizePrivateDriveKeyRecord(parsed)
  } catch {
    return { ok: false }
  }
}

export function getPrivateDriveKey (storagePath) {
  if (!storagePath) return null
  if (cachedEntry && cachedEntry.path === storagePath) return cachedEntry.key

  const record = getPrivateDriveKeyRecord(storagePath)
  const key = record.ok ? record.key : loadOrCreatePrivateDriveKey(storagePath)
  cachedEntry = { path: storagePath, key }
  return key
}

export function resetPrivateDriveKeyCache () {
  cachedEntry = null
}

export function getPrivateDriveKeyFile (storagePath) {
  const normalized = String(storagePath || '').replace(/[/\\]+$/, '')
  // NOTE: this file lives INSIDE the corestore directory. hypercore-storage's
  // tmpFixStorage moves unknown files from a directory that has no CORESTORE
  // marker into db/ — so this must never be written before the store is
  // opened (the app always opens the runtime first, which creates the marker).
  // If we ever write the key before the store exists it will silently vanish
  // into db/; that is why loadOrCreatePrivateDriveKey writes with {flag:'wx'}
  // and re-checks after a race.
  return `${normalized}/${PRIVATE_DRIVE_KEY_FILE}`
}

export function hasPrivateDriveKey (storagePath) {
  if (!storagePath) return false
  return getPrivateDriveKeyRecord(storagePath).ok
}

export function getPrivateDriveId (storagePath) {
  if (!storagePath) return null
  return getPrivateDriveKeyRecord(storagePath).driveId || null
}

export function rememberPrivateDriveId (storagePath, driveId) {
  if (!storagePath || !isValidPrivateDriveId(driveId) || !hasPrivateDriveKey(storagePath)) return false

  const filePath = getPrivateDriveKeyFile(storagePath)
  try {
    const record = getPrivateDriveKeyRecord(storagePath)
    if (!record.ok) return false
    const parsed = JSON.parse(b4a.toString(readFileSync(filePath), 'utf8'))
    const createdAt = typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString()

    if (record.version === 3) {
      writeFileSync(filePath, JSON.stringify({
        version: 3,
        createdAt,
        key: record.key ? b4a.toString(record.key, 'hex') : null,
        driveId: String(driveId).toLowerCase(),
        encrypted: !!record.encrypted,
        ...(record.announce !== undefined ? { announce: record.announce } : {}),
        ...(record.source ? { source: record.source } : {})
      }, null, 2))
      resetPrivateDriveKeyCache()
      return true
    }

    if (!normalizePrivateDriveKey(parsed.key)) return false
    parsed.version = 2
    parsed.driveId = String(driveId).toLowerCase()
    writeFileSync(filePath, JSON.stringify(parsed, null, 2))
    resetPrivateDriveKeyCache()
    return true
  } catch {
    return false
  }
}

export function importPrivateDriveKey (storagePath, { key, driveId, source, announce, preserve } = {}) {
  if (!storagePath) throw new Error('Private drive key requires a storage path.')
  const keyBytes = typeof key === 'string' ? normalizePrivateDriveKey(key) : null
  if (key !== null && key !== undefined && !keyBytes) throw new Error('Invalid private drive key.')
  if (driveId !== undefined && driveId !== null && !isValidPrivateDriveId(driveId)) {
    throw new Error('Invalid private drive identity.')
  }

  mkdirSync(storagePath, { recursive: true })

  // Policy decision (desktop side mirrors this): an incoming record WITH a key
  // wins — that is what makes linking actually sync both devices against one
  // encrypted drive ("link my phone"). preserve only guards the case where the
  // incoming record has NO key (desktop's device-only export): it must never
  // clobber a phone-held encryption key with a plaintext identity. Re-encrypting
  // the phone's existing local files into the incoming-keyed drive is handled at
  // the adoption layer when desktop ships a real key.
  if (preserve && !keyBytes && getPrivateDriveKeyRecord(storagePath).ok) {
    const existing = getPrivateDriveKeyRecord(storagePath)
    return existing.key
  }

  if (!keyBytes) {
    if (!isValidPrivateDriveId(driveId)) {
      throw new Error('Adopting an unencrypted drive requires a drive identity.')
    }
    writeFileSync(getPrivateDriveKeyFile(storagePath), JSON.stringify({
      version: 3,
      createdAt: new Date().toISOString(),
      key: null,
      driveId: String(driveId).toLowerCase(),
      encrypted: false,
      ...(announce !== undefined ? { announce } : { announce: false }),
      ...(source ? { source } : {})
    }, null, 2))
    resetPrivateDriveKeyCache()
    return null
  }

  const serialized = {
    version: 2,
    createdAt: new Date().toISOString(),
    key: b4a.toString(keyBytes, 'hex'),
    ...(isValidPrivateDriveId(driveId) ? { driveId: String(driveId).toLowerCase() } : {}),
    ...(announce !== undefined ? { announce } : {})
  }

  writeFileSync(getPrivateDriveKeyFile(storagePath), JSON.stringify(serialized, null, 2))
  resetPrivateDriveKeyCache()
  return keyBytes
}

export function normalizePrivateDriveKey (key) {
  if (!key || typeof key !== 'string' || !/^[0-9a-f]+$/i.test(key) || key.length !== PRIVATE_DRIVE_KEY_BYTES * 2) {
    return null
  }
  return b4a.from(key, 'hex')
}

export function isValidPrivateDriveId (driveId) {
  return typeof driveId === 'string' && /^[0-9a-f]+$/i.test(driveId) && driveId.length === PRIVATE_DRIVE_ID_HEX_LENGTH
}

function normalizePrivateDriveKeyRecord (parsed) {
  if (!parsed || typeof parsed !== 'object') return { ok: false }

  const keyBytes = normalizePrivateDriveKey(parsed.key)
  const driveId = isValidPrivateDriveId(parsed.driveId) ? String(parsed.driveId).toLowerCase() : null

  if (parsed.version === 3) {
    if (!keyBytes && !driveId) return { ok: false }
    return {
      ok: true,
      key: keyBytes,
      driveId,
      encrypted: keyBytes !== null && parsed.encrypted !== false,
      announce: keyBytes !== null && parsed.announce !== false,
      source: typeof parsed.source === 'string' ? parsed.source : (keyBytes ? 'mobile' : 'desktop'),
      version: 3
    }
  }

  if (!keyBytes) return { ok: false }
  return {
    ok: true,
    key: keyBytes,
    driveId,
    encrypted: true,
    announce: true,
    source: 'mobile',
    version: 2
  }
}

function loadOrCreatePrivateDriveKey (storagePath) {
  const filePath = getPrivateDriveKeyFile(storagePath)

  try {
    if (existsSync(filePath)) {
      const record = normalizePrivateDriveKeyRecord(JSON.parse(b4a.toString(readFileSync(filePath), 'utf8')))
      if (record.ok) return record.key
    }
  } catch {
  }

  const key = randomBytes(PRIVATE_DRIVE_KEY_BYTES)
  const serialized = JSON.stringify({
    version: 2,
    createdAt: new Date().toISOString(),
    key: b4a.toString(key, 'hex')
  })

  try {
    mkdirSync(storagePath, { recursive: true })
    writeFileSync(filePath, serialized, { flag: 'wx' })
  } catch (error) {
    if (!existsSync(filePath)) throw error
    try {
      const record = normalizePrivateDriveKeyRecord(JSON.parse(b4a.toString(readFileSync(filePath), 'utf8')))
      if (record.ok) return record.key
    } catch {}
    throw error
  }

  return key
}
