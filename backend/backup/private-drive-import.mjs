import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import z32 from 'z32'
import {
  isValidPrivateDriveId,
  normalizePrivateDriveKey
} from '../hyper/private-keys.mjs'
import { ADOPTED_CORESTORE_FILE, adoptedStoragePathFor, readSyncedPrivateAdoptedDrives } from '../hyper/runtime-routing.mjs'

const PRIVATE_DRIVE_TRANSFER_ENTRY = 'private-drive-key.json'
const PRIVATE_HYPERDRIVES_REGISTRY = 'privateHyperdrives.json'
const DESKTOP_PRIVATE_STORE_DIR = 'hyper-private'

function extractTransferredPrivateDrives (storagePath) {
  if (!storagePath) return []

  const candidates = []

  const keyFile = join(storagePath, PRIVATE_DRIVE_TRANSFER_ENTRY)
  if (existsSync(keyFile)) {
    candidates.push(...extractSerializedPrivateDriveKey(readFileSync(keyFile, 'utf8')))
  }

  for (const registryEntry of extractDesktopPrivateDriveRegistryEntries(storagePath)) {
    candidates.push(registryEntry)
  }

  const keyFileDriveId = candidates.find((entry) => entry.key)?.driveId
  const deduped = []
  const seen = new Set()
  for (const candidate of candidates) {
    if (seen.has(candidate.driveId)) continue
    seen.add(candidate.driveId)
    if (candidate.key) deduped.unshift(candidate)
    else if (candidate.driveId === keyFileDriveId) deduped.unshift(candidate)
    else deduped.push(candidate)
  }

  return deduped
}

export { extractTransferredPrivateDrives, extractTransferredPrivateDrives as extractTransferredPrivateDrive }
export function adoptTransferredPrivateDrive (storagePath, syncedPrivateStoragePath, adoptedStoragePath = null) {
  if (!storagePath || !syncedPrivateStoragePath) return { adopted: false }

  const transferred = extractTransferredPrivateDrives(storagePath)
  if (transferred.length === 0) return { adopted: false }

  const adoptedStorePath = adoptedStoragePath || adoptedStoragePathFor(syncedPrivateStoragePath)

  try {
    importTransferredPrivateCores(storagePath, adoptedStorePath)

    for (const entry of transferred) {
      const encrypted = !!entry.key
      const announce = entry.announce !== false && encrypted
      writeAdoptedCorestoreMarker(syncedPrivateStoragePath, {
        driveId: entry.driveId,
        encrypted,
        announce,
        source: entry.source,
        ...(encrypted && entry.key ? { key: String(entry.key).toLowerCase() } : {})
      })
    }

    return {
      adopted: true,
      driveId: (transferred.find((entry) => entry.driveId) || transferred[0]).driveId,
      encrypted: transferred.some((entry) => entry.key),
      driveIds: transferred.map((entry) => entry.driveId)
    }
  } catch {
    return { adopted: false }
  }
}

function extractSerializedPrivateDriveKey (serialized) {
  try {
    const parsed = JSON.parse(serialized)
    if (!parsed || typeof parsed !== 'object') return []

    if (parsed.version === 3) {
      if (Array.isArray(parsed.entries) && parsed.entries.length > 0) {
        const topKey = normalizePrivateDriveKey(parsed.key)
        const drives = []
        for (const entry of parsed.entries) {
          const driveId = isValidPrivateDriveId(entry?.driveId) ? String(entry.driveId).toLowerCase() : null
          if (!driveId) continue
          const entryKey = normalizePrivateDriveKey(entry?.key) || topKey
          const encryptable = entryKey !== null && (entry?.encrypted ?? parsed.encrypted) !== false
          const announceable = entryKey !== null && (entry?.announce ?? parsed.announce) !== false
          drives.push({
            key: entryKey ? entryKey.toString('hex') : null,
            driveId,
            source: typeof entry?.source === 'string' ? entry.source : (typeof parsed.source === 'string' ? parsed.source : 'desktop'),
            encrypted: entryKey ? encryptable : false,
            announce: entryKey ? announceable : false
          })
        }
        return drives
      }

      const driveId = isValidPrivateDriveId(parsed.driveId) ? String(parsed.driveId).toLowerCase() : null
      if (!driveId) return []
      const keyBytes = typeof parsed.key === 'string' ? normalizePrivateDriveKey(parsed.key) : null
      return [{
        key: keyBytes ? keyBytes.toString('hex') : null,
        driveId,
        source: typeof parsed.source === 'string' ? parsed.source : 'desktop',
        encrypted: keyBytes !== null && parsed.encrypted !== false,
        announce: keyBytes !== null && parsed.announce !== false
      }]
    }

    if (typeof parsed.key !== 'string') return []
    const keyBytes = normalizePrivateDriveKey(parsed.key)
    if (!keyBytes) return []
    const driveId = isValidPrivateDriveId(parsed.driveId) ? String(parsed.driveId).toLowerCase() : null
    return [{ key: keyBytes.toString('hex'), driveId, source: 'mobile', encrypted: true, announce: true }]
  } catch {
    return []
  }
}

function extractDesktopPrivateDriveRegistryEntries (storagePath) {
  const registryPath = join(storagePath, PRIVATE_HYPERDRIVES_REGISTRY)
  if (!existsSync(registryPath)) return []

  let entries
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8'))
    if (!Array.isArray(parsed)) return []
    entries = parsed.map(normalizeRegistryEntry).filter((entry) => entry !== null)
  } catch {
    return []
  }

  entries.sort((left, right) => right.timestamp - left.timestamp)

  const drives = []
  for (const entry of entries) {
    const driveId = decodeRegistryDriveId(entry.driveAddress)
    if (!driveId) continue
    drives.push({ key: null, driveId, source: 'desktop', encrypted: false, announce: false })
  }

  return drives
}

function normalizeRegistryEntry (entry) {
  if (!entry || typeof entry !== 'object') return null

  const url = parseHyperUrl(entry.url)
  if (!url || !(/^(?:[a-z0-9]{52}|[a-f0-9]{64})$/i.test(url.hostname))) return null

  const timestamp = Number(entry.timestamp)
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) return null

  return { driveAddress: url.hostname, timestamp }
}

function decodeRegistryDriveId (hostname) {
  try {
    if (/^[0-9a-f]{64}$/i.test(hostname)) return hostname.toLowerCase()

    const bytes = z32.decode(String(hostname).toLowerCase())
    if (bytes.byteLength === 32) return Buffer.from(bytes).toString('hex')
  } catch {}
  return null
}

function parseHyperUrl (value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'hyper:' && url.pathname === '/'
      ? { hostname: url.hostname }
      : null
  } catch {
    return null
  }
}

function importTransferredPrivateCores (storagePath, adoptedStoragePath) {
  const sourceRoot = join(storagePath, DESKTOP_PRIVATE_STORE_DIR)
  if (!existsSync(sourceRoot)) return
  // Copy into the dedicated adopted corestore root (hyper-sdk-adopted), which
  // is a fresh directory. Overlaying onto the phone's live hyper-sdk-synced-
  // private/ store would lay one Corestore RocksDB (db/) over another and
  // corrupt both ("Invalid device file, was modified").
  copyTree(sourceRoot, adoptedStoragePath)
}

function copyTree (source, destination) {
  mkdirSync(destination, { recursive: true })

  for (const entry of readdirSync(source)) {
    const sourcePath = join(source, entry)
    const destinationPath = join(destination, entry)
    const info = statSync(sourcePath)

    if (info.isDirectory()) {
      copyTree(sourcePath, destinationPath)
    } else if (info.isFile()) {
      mkdirSync(destination, { recursive: true })
      writeFileSync(destinationPath, readFileSync(sourcePath))
    }
  }
}

function writeAdoptedCorestoreMarker (syncedPrivateStoragePath, transferred) {
  mkdirSync(syncedPrivateStoragePath, { recursive: true })
  const existing = readSyncedPrivateAdoptedDrives(syncedPrivateStoragePath)

  const seen = new Set(existing.map((entry) => entry.driveId))
  const drives = existing.map((entry) => ({
    driveId: entry.driveId,
    encrypted: entry.encrypted,
    announce: entry.announce,
    ...(entry.source ? { source: entry.source } : {}),
    ...(entry.encrypted && entry.key ? { key: entry.key } : {})
  }))

  if (!seen.has(transferred.driveId)) {
    drives.push({
      driveId: transferred.driveId,
      encrypted: !!transferred.encrypted,
      announce: !!transferred.announce,
      ...(transferred.source ? { source: transferred.source } : {}),
      ...(transferred.encrypted && transferred.key ? { key: String(transferred.key).toLowerCase() } : {})
    })
  }

  writeFileSync(join(syncedPrivateStoragePath, ADOPTED_CORESTORE_FILE), JSON.stringify({
    version: 2,
    drives
  }, null, 2))
}
