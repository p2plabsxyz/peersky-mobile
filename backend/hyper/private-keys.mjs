import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import b4a from 'b4a'
import { randomBytes } from 'hypercore-crypto'

export const PRIVATE_DRIVE_KEY_FILE = 'private-drive-key.json'
export const PRIVATE_DRIVE_KEY_BYTES = 32

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

export function normalizePrivateDriveKey (key) {
  if (!key || typeof key !== 'string' || !/^[0-9a-f]+$/i.test(key) || key.length !== PRIVATE_DRIVE_KEY_BYTES * 2) {
    return null
  }
  return b4a.from(key, 'hex')
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
    version: 1,
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
