import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import b4a from 'b4a'
import { randomBytes } from 'hypercore-crypto'

export const PRIVATE_DRIVE_KEY_FILE = 'private-drive-key.json'
export const PRIVATE_DRIVE_KEY_BYTES = 32
export const PRIVATE_DRIVE_ID_BYTES = 32
const PRIVATE_DRIVE_ID_HEX_LENGTH = PRIVATE_DRIVE_ID_BYTES * 2

let cachedKey = null
let cachedStoragePath = null

export function getPrivateDriveKey (storagePath) {
  if (!storagePath) return null
  if (cachedStoragePath === storagePath && cachedKey) return cachedKey

  const key = loadOrCreatePrivateDriveKey(storagePath)
  if (!key) return null

  cachedStoragePath = storagePath
  cachedKey = key
  return key
}

export function resetPrivateDriveKeyCache () {
  cachedKey = null
  cachedStoragePath = null
}

export function getPrivateDriveKeyFile (storagePath) {
  const normalized = String(storagePath || '').replace(/[/\\]+$/, '')
  return `${normalized}/${PRIVATE_DRIVE_KEY_FILE}`
}

export function hasPrivateDriveKey (storagePath) {
  if (!storagePath) return false
  return getPrivateDriveKeyRecord(storagePath).ok
}

export function getPrivateDriveId (storagePath) {
  if (!storagePath) return null
  const record = getPrivateDriveKeyRecord(storagePath)
  return record.ok ? record.driveId : null
}

export function rememberPrivateDriveId (storagePath, driveId) {
  if (!storagePath || !isValidPrivateDriveId(driveId) || !hasPrivateDriveKey(storagePath)) return false

  const filePath = getPrivateDriveKeyFile(storagePath)
  try {
    const record = JSON.parse(b4a.toString(readFileSync(filePath), 'utf8'))
    if (!normalizePrivateDriveKey(record.key)) return false

    record.version = 2
    record.driveId = String(driveId).toLowerCase()
    writeFileSync(filePath, JSON.stringify(record, null, 2))
    resetPrivateDriveKeyCache()
    return true
  } catch {
    return false
  }
}

export function importPrivateDriveKey (storagePath, { key, driveId }) {
  if (!storagePath) throw new Error('Private drive key requires a storage path.')
  const keyBytes = typeof key === 'string' ? normalizePrivateDriveKey(key) : null
  if (!keyBytes) throw new Error('Invalid private drive key.')
  if (driveId !== undefined && driveId !== null && !isValidPrivateDriveId(driveId)) {
    throw new Error('Invalid private drive identity.')
  }

  const serialized = {
    version: 2,
    createdAt: new Date().toISOString(),
    key: b4a.toString(keyBytes, 'hex'),
    ...(isValidPrivateDriveId(driveId) ? { driveId: String(driveId).toLowerCase() } : {})
  }

  mkdirSync(storagePath, { recursive: true })
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

function getPrivateDriveKeyRecord (storagePath) {
  if (!storagePath) return { ok: false }
  const filePath = getPrivateDriveKeyFile(storagePath)

  try {
    if (!existsSync(filePath)) return { ok: false }
    const parsed = JSON.parse(b4a.toString(readFileSync(filePath), 'utf8'))
    const key = normalizePrivateDriveKey(parsed.key)
    if (!key) return { ok: false }
    return {
      ok: true,
      key,
      driveId: isValidPrivateDriveId(parsed.driveId) ? String(parsed.driveId).toLowerCase() : null
    }
  } catch {
    return { ok: false }
  }
}

function loadOrCreatePrivateDriveKey (storagePath) {
  const filePath = getPrivateDriveKeyFile(storagePath)

  try {
    if (existsSync(filePath)) {
      const parsed = JSON.parse(b4a.toString(readFileSync(filePath), 'utf8'))
      const key = normalizePrivateDriveKey(parsed.key)
      if (key) return key
    }
  } catch {
    // Fall through and regenerate below.
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
      const parsed = JSON.parse(b4a.toString(readFileSync(filePath), 'utf8'))
      const persisted = normalizePrivateDriveKey(parsed.key)
      if (persisted) return persisted
    } catch {}
    throw error
  }

  return key
}
