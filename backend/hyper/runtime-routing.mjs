import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import z32 from 'z32'

export const ADOPTED_CORESTORE_FILE = 'adopted-corestore.json'
export const DEFAULT_ANNOUNCE = true

// Adopted drives live in their OWN corestore directory, never overlaid onto
// the phone's live hyper-sdk-synced-private store. Copying one Corestore's
// RocksDB files into another (corestore 7 keeps a db/ per store) corrupts
// both stores, so the adopted store is kept as a separate sibling root.
export const ADOPTED_STORAGE_DIR = 'hyper-sdk-adopted'

export function adoptedStoragePathFor (syncedPrivateStoragePath) {
  const root = String(syncedPrivateStoragePath || '').replace(/[/\\]+$/, '')
  if (!root) return ADOPTED_STORAGE_DIR
  const separatorIndex = Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\'))
  const base = separatorIndex === -1 ? '' : root.slice(0, separatorIndex + 1)
  return `${base}${ADOPTED_STORAGE_DIR}`
}

export function createPrivateHyperRuntimeOptions (storage) {
  return {
    storage,
    autoJoin: false,
    doReplicate: false
  }
}

export function createSyncedPrivateHyperRuntimeOptions (storage) {
  return {
    storage,
    autoJoin: false,
    doReplicate: true
  }
}

export function normalizeDriveAddressId (addressOrHostname) {
  let hostname
  try {
    const url = new URL(String(addressOrHostname))
    if (url.protocol === 'hyper:' && url.hostname) hostname = url.hostname
  } catch {
    hostname = String(addressOrHostname)
  }

  if (!hostname) return null
  hostname = hostname.toLowerCase()

  try {
    if (/^[a-z0-9]{52}$/.test(hostname)) {
      const decoded = z32.decode(hostname)
      if (decoded.byteLength === 32) return Buffer.from(decoded).toString('hex')
      return null
    }
    if (/^[0-9a-f]{64}$/.test(hostname)) return hostname
  } catch {}

  return null
}

export function matchesHyperdriveAddress (address, driveId) {
  if (!driveId) return false
  const normalizedDriveId = String(driveId).toLowerCase()
  const normalizedAddress = normalizeDriveAddressId(address)
  return normalizedAddress !== null && normalizedAddress === normalizedDriveId
}

export function readSyncedPrivateAdoptedDrives (storage) {
  if (!storage) return []
  try {
    const markerPath = join(getStorageRoot(storage), ADOPTED_CORESTORE_FILE)
    if (!existsSync(markerPath)) return []
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    if (!marker || typeof marker !== 'object') return []

    const drives = normalizeMarkerDrives(marker.drives || (marker.driveId ? [marker] : []))
    return drives
  } catch {
    return []
  }
}

function normalizeMarkerDrives (entries) {
  const drives = []
  const seen = new Set()

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const driveId = typeof entry.driveId === 'string'
      ? entry.driveId.toLowerCase()
      : null
    if (!/^[0-9a-f]{64}$/.test(driveId || '')) continue
    if (seen.has(driveId)) continue
    seen.add(driveId)
    const encrypted = entry.encrypted !== false
    drives.push({
      driveId,
      encrypted,
      announce: entry.announce !== false && encrypted,
      source: typeof entry.source === 'string' ? entry.source : null
    })
  }

  return drives
}

function getStorageRoot (storage) {
  return String(storage).replace(/[/\\]+$/, '')
}
