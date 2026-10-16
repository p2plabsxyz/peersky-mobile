import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeDriveAddressId } from '../hyper/runtime-routing.mjs'

// The name a person gave a drive, which the viewer shows at its top in place
// of the key. A name is never made up from an address or from what the drive
// holds. This phone names none of the drives it makes: uploads go into
// Public, Private and This device only, which nobody named, the way the
// desktop calls an upload with no name Drive. What it does know is the
// desktop's list of private drives, by the names they were made under there,
// which Link Device keeps (backend/backup/restore.mjs).

export const PRIVATE_DRIVE_REGISTRY_FILE = 'privateHyperdrives.json'
// As the desktop caps the list.
const MAX_REGISTRY_BYTES = 1024 * 1024
const MAX_NAME_LENGTH = 255
// What the desktop calls an upload that was given no name. No name at all.
const UNNAMED_DRIVE = 'Drive'
const DRIVE_ROOT = /^hyper:\/\/([a-z0-9]{52}|[0-9a-f]{64})\/?$/i

/**
 * The drives in the desktop's private drive list kept in a folder, as
 * [{ name, id }], id being the drive's key in hex. None when there is no
 * list, or it cannot be read.
 * @param {string} directory
 * @returns {{ name: unknown, id: string }[]}
 */
export function readPrivateDriveRecords (directory) {
  if (!directory) return []
  try {
    const file = join(directory, PRIVATE_DRIVE_REGISTRY_FILE)
    if (statSync(file).size > MAX_REGISTRY_BYTES) return []
    const entries = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(entries)) return []
    const records = []
    for (const entry of entries) {
      const host = DRIVE_ROOT.exec(String(entry?.url || ''))?.[1]
      const id = host ? normalizeDriveAddressId(host) : null
      if (id) records.push({ name: entry.name, id })
    }
    return records
  } catch {
    return []
  }
}

/**
 * The name a drive was made under, matched by its id (its key in hex). Null
 * when none of the records has one.
 * @param {{ name?: unknown, id?: string | null }[]} records
 * @param {string | null | undefined} id
 * @returns {string | null}
 */
export function knownDriveName (records, id) {
  if (!id) return null
  const record = records.find((entry) => entry?.id === id)
  const name = typeof record?.name === 'string' ? record.name.trim() : ''
  if (!name || name === UNNAMED_DRIVE) return null
  // As a drive's name may be when the desktop makes one.
  const characters = Array.from(name)
  const control = characters.some((character) => {
    const code = character.codePointAt(0)
    return code <= 31 || (code >= 127 && code <= 159)
  })
  return characters.length <= MAX_NAME_LENGTH && !control ? name : null
}
