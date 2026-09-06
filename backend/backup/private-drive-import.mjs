import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importPrivateDriveKey, isValidPrivateDriveId, PRIVATE_DRIVE_KEY_FILE } from '../hyper/private-keys.mjs'

const PRIVATE_DRIVE_TRANSFER_ENTRY = `${PRIVATE_DRIVE_KEY_FILE}`

export function extractTransferredPrivateDrive (storagePath) {
  if (!storagePath) return null

  const filePath = join(storagePath, PRIVATE_DRIVE_TRANSFER_ENTRY)
  try {
    if (!existsSync(filePath)) return null

    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    if (!parsed || typeof parsed.key !== 'string') return null

    const key = /^[0-9a-f]+$/i.test(parsed.key) && parsed.key.length === 64
      ? parsed.key
      : null

    if (!key) return null

    const driveId = isValidPrivateDriveId(parsed.driveId) ? parsed.driveId : null
    return { key, driveId }
  } catch {
    return null
  }
}

export function adoptTransferredPrivateDrive (storagePath, syncedPrivateStoragePath) {
  if (!storagePath || !syncedPrivateStoragePath) return { adopted: false }

  const transferred = extractTransferredPrivateDrive(storagePath)
  if (!transferred) return { adopted: false }

  try {
    importPrivateDriveKey(syncedPrivateStoragePath, transferred)
    return { adopted: true, driveId: transferred.driveId || null }
  } catch {
    return { adopted: false }
  }
}
