import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readZipEntries } from './zip.mjs'
import { PEERCHAT_INCOMING_FILE } from '../peerchat/device-link.mjs'
import { P2PMD_INCOMING_FILE } from '../p2pmd/constants.mjs'
import {
  convertDesktopBookmarks,
  convertDesktopTabs,
  INCOMING_BOOKMARKS_FILE,
  INCOMING_TABS_FILE
} from './browser-import.mjs'

export const RESTORE_STAGING_DIR = '.peersky-restore-staging'
export const RESTORE_PREVIOUS_DIR = '.peersky-restore-previous'
export const RESTORE_TRASH_DIR = '.peersky-restore-trash'
const RESTORE_JOURNAL = 'journal.json'

const SKIP_ENTRIES = new Set(['manifest.json', 'manifest.mjson'])

// What the phone keeps from a desktop identity transfer: the identity record,
// the private drives, which private-drive-import adopts after the swap, the
// person's PeerChat, which PeerChat takes on its next start, and their recent
// P2PMD notes, which the app takes once the backend is up.
const KEPT_FILES = new Set([
  'peersky-identity.json',
  'privateHyperdrives.json',
  'private-drive-key.json',
  PEERCHAT_INCOMING_FILE,
  P2PMD_INCOMING_FILE
])
const KEPT_DIRECTORIES = ['hyper-private']

// The desktop sends these, and nothing on the phone reads them. hyper/ is the
// desktop's own corestore: it can run to gigabytes, and it used to be written
// into the phone's storage where nothing ever opened it.
const IGNORED_FILES = new Set([
  'lastOpened.json',
  'peersky-ports.json',
  'peersky-chat-rooms.json',
  'browser-tabs.json',
  'ensCache.json',
  'ipfsCache.json',
  'hyperCache.json'
])
const IGNORED_DIRECTORIES = ['hyper']

// Read, turned into something the phone understands, and handed to the app
// to merge on its next start. See browser-import.mjs.
const CONVERTED_FILES = new Map([
  ['tabs.json', { name: INCOMING_TABS_FILE, convert: convertDesktopTabs }],
  ['bookmarks.json', { name: INCOMING_BOOKMARKS_FILE, convert: convertDesktopBookmarks }]
])

export function desktopConversionFor (name) {
  return CONVERTED_FILES.get(name) || null
}

export function classifyDesktopEntry (name) {
  const top = name.split('/')[0]
  if (name === 'device-key.json') return 'refuse'
  if (KEPT_FILES.has(name)) return 'keep'
  if (KEPT_DIRECTORIES.includes(top)) return 'keep'
  if (CONVERTED_FILES.has(name)) return 'convert'
  if (IGNORED_FILES.has(name) || IGNORED_DIRECTORIES.includes(top)) return 'ignore'
  return 'unknown'
}

/**
 * Unpacks a decrypted desktop identity transfer into a staging folder. Nothing
 * on the phone changes until commitStagedRestore moves it into place.
 */
export async function restoreIdentityFromBackup (innerZipBytes, stagingPath) {
  const entries = readZipEntries(innerZipBytes)
  let restoredFiles = 0

  mkdirSync(stagingPath, { recursive: true })

  for (const entry of entries) {
    const safeName = normalizeZipEntryName(entry.name)
    if (!safeName || SKIP_ENTRIES.has(safeName)) continue

    const plainName = safeName.replace(/\/$/, '')
    const action = classifyDesktopEntry(plainName)
    if (action === 'refuse') throw new Error('Refusing to restore device-key.json from backup')
    if (action === 'unknown') throw new Error(`Refusing to restore unknown file: ${plainName}`)
    if (action === 'ignore') continue

    if (entry.isDirectory) {
      mkdirSync(join(stagingPath, plainName), { recursive: true })
      continue
    }

    if (action === 'convert') {
      const target = CONVERTED_FILES.get(plainName)
      const converted = target.convert(entry.bytes)
      if (!converted) continue
      writeFileSync(join(stagingPath, target.name), converted)
      restoredFiles += 1
      continue
    }

    const targetPath = join(stagingPath, plainName)
    mkdirSync(getDirName(targetPath), { recursive: true })
    writeFileSync(targetPath, entry.bytes)
    restoredFiles += 1
  }

  if (restoredFiles === 0) {
    throw new Error('Decrypted backup did not contain any restorable files')
  }

  return { restoredFiles, names: listStagedNames(stagingPath) }
}

export function listStagedNames (stagingPath) {
  try {
    return readdirSync(stagingPath).filter((name) => !name.startsWith('.')).sort()
  } catch {
    return []
  }
}

/**
 * Moves each staged top-level entry into storage, replacing what was there.
 * Entries in `replace` are cleared even when the restore has none of its own,
 * for data that only makes sense beside something being restored.
 *
 * Everything else in storage is left exactly where it is. This used to rename
 * the whole storage folder away and keep a short list of device files, and
 * that folder is the app's documents: bookmarks, history, settings and
 * downloads all went with it.
 *
 * All or nothing. A failed move puts back the ones already made. If the app
 * is killed part way, a journal written before the first move lets the next
 * start undo it (recoverInterruptedRestore). Once every entry is in place the
 * old copies are renamed to a trash folder, which is the step that marks the
 * restore finished: deleting them can take a while, and a crash during that
 * must not look like a restore to undo.
 */
export function commitStagedRestore ({ storagePath, stagingPath, names, replace = [] }) {
  if (!storagePath || !stagingPath || !Array.isArray(names) || !existsSync(stagingPath)) {
    throw new Error('Identity restore paths are invalid')
  }

  const incoming = new Set(names.map(assertTopLevelName))
  const targets = [...new Set([...incoming, ...replace.map(assertTopLevelName)])]
  const previousPath = join(storagePath, RESTORE_PREVIOUS_DIR)
  const trashPath = join(storagePath, RESTORE_TRASH_DIR)
  const moved = []
  const placed = []

  recoverInterruptedRestore(storagePath)
  mkdirSync(previousPath, { recursive: true })
  writeFileSync(join(previousPath, RESTORE_JOURNAL), JSON.stringify({
    incoming: [...incoming],
    existing: targets.filter((name) => existsSync(join(storagePath, name)))
  }))

  try {
    for (const name of targets) {
      const current = join(storagePath, name)
      if (existsSync(current)) {
        renameSync(current, join(previousPath, name))
        moved.push(name)
      }
      if (incoming.has(name)) {
        renameSync(join(stagingPath, name), current)
        placed.push(name)
      }
    }
  } catch (error) {
    for (const name of placed.reverse()) {
      try { renameSync(join(storagePath, name), join(stagingPath, name)) } catch {}
    }
    for (const name of moved.reverse()) {
      try { renameSync(join(previousPath, name), join(storagePath, name)) } catch {}
    }
    // Only once everything is back. Anything that could not be moved back
    // stays, and the next start puts it back.
    if (readdirSync(previousPath).every((name) => name === RESTORE_JOURNAL)) {
      rmSync(previousPath, { recursive: true, force: true })
    }
    throw error
  }

  renameSync(previousPath, trashPath)
  rmSync(trashPath, { recursive: true, force: true })
  rmSync(stagingPath, { recursive: true, force: true })

  return {
    restored: placed,
    removed: moved.filter((name) => !incoming.has(name))
  }
}

/**
 * Puts storage back the way it was before a restore the app was killed in
 * the middle of. Anything the restore had placed goes, and every old entry
 * comes back. Run before the stores are opened.
 */
export function recoverInterruptedRestore (storagePath) {
  // The restore finished; only deleting the old copies was cut short.
  rmSync(join(storagePath, RESTORE_TRASH_DIR), { recursive: true, force: true })

  const previousPath = join(storagePath, RESTORE_PREVIOUS_DIR)
  if (!existsSync(previousPath)) return { recovered: false }

  let journal = null
  try {
    journal = JSON.parse(readFileSync(join(previousPath, RESTORE_JOURNAL), 'utf8'))
  } catch {}
  const existing = new Set(Array.isArray(journal?.existing) ? journal.existing : [])
  const incoming = Array.isArray(journal?.incoming) ? journal.incoming : []

  for (const name of readdirSync(previousPath)) {
    if (name === RESTORE_JOURNAL) continue
    const current = join(storagePath, assertTopLevelName(name))
    rmSync(current, { recursive: true, force: true })
    renameSync(join(previousPath, name), current)
  }

  // Nothing stood here before the restore, so whatever does now came from it.
  for (const name of incoming) {
    if (existing.has(name)) continue
    rmSync(join(storagePath, assertTopLevelName(name)), { recursive: true, force: true })
  }

  rmSync(previousPath, { recursive: true, force: true })
  return { recovered: true }
}

function assertTopLevelName (name) {
  const value = String(name || '')
  if (!value || value === '.' || value === '..' || /[/\\\0]/.test(value) || value.startsWith('.peersky-restore')) {
    throw new Error(`Refusing to restore ${value || 'an unnamed entry'}`)
  }
  return value
}

function normalizeZipEntryName (name) {
  const slashNormalized = String(name || '').replace(/\\/g, '/')
  const isDirectory = slashNormalized.endsWith('/')
  const normalized = slashNormalized.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!normalized) return ''

  const parts = []
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') throw new Error('Backup contains illegal path traversal entries')
    parts.push(part)
  }

  const safeName = parts.join('/')
  return isDirectory ? `${safeName}/` : safeName
}

function getDirName (filepath) {
  const separatorIndex = Math.max(filepath.lastIndexOf('/'), filepath.lastIndexOf('\\'))
  return separatorIndex === -1 ? '.' : filepath.slice(0, separatorIndex)
}
