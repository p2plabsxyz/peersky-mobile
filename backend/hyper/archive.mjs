import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import b4a from 'b4a'
import {
  listHyperArchiveItems,
  parseHyperArchive,
  recordHyperArchiveItem,
  removeHyperArchiveItems,
  serializeHyperArchive
} from './archive-core.mjs'
import { getHyperStoragePath } from './runtime.mjs'

const ARCHIVE_FILE_SUFFIX = '-archive.json'
const ARCHIVE_TEMP_SUFFIX = '.temporary'
const MAX_ARCHIVE_FILE_BYTES = 512 * 1024
let archiveTransition = Promise.resolve()

export function listHyperArchive (options = {}, storagePath = getHyperStoragePath()) {
  return withArchiveTransition(() => (
    listHyperArchiveItems(readArchive(storagePath), options)
  ))
}

export async function recordHyperArchive (entry, storagePath = getHyperStoragePath()) {
  try {
    return await withArchiveTransition(() => {
      if (!storagePath) return false
      const items = recordHyperArchiveItem(readArchive(storagePath), entry)
      return writeArchive(storagePath, items)
    })
  } catch (error) {
    console.warn('[hyper] Unable to update archive:', error)
    return false
  }
}

export function removeHyperArchive (filter, storagePath = getHyperStoragePath()) {
  return withArchiveTransition(() => {
    if (!storagePath) return false
    const items = removeHyperArchiveItems(readArchive(storagePath), filter)
    return writeArchive(storagePath, items)
  })
}

export function clearHyperArchive (storagePath = getHyperStoragePath()) {
  return withArchiveTransition(() => {
    if (!storagePath) return false
    removeFile(getArchiveFile(storagePath))
    removeFile(getArchiveFile(storagePath) + ARCHIVE_TEMP_SUFFIX)
    return true
  })
}

function readArchive (storagePath) {
  if (!storagePath) return []
  const file = getArchiveFile(storagePath)
  if (!existsSync(file)) return []

  try {
    if (statSync(file).size > MAX_ARCHIVE_FILE_BYTES) return []
    return parseHyperArchive(String(readFileSync(file, 'utf8')))
  } catch {
    return []
  }
}

function writeArchive (storagePath, items) {
  const file = getArchiveFile(storagePath)
  const temporary = file + ARCHIVE_TEMP_SUFFIX
  const serialized = serializeHyperArchive(items)
  if (b4a.byteLength(serialized) > MAX_ARCHIVE_FILE_BYTES) return false

  mkdirSync(getDirName(file), { recursive: true })
  writeFileSync(temporary, serialized)
  renameSync(temporary, file)
  return true
}

function getArchiveFile (storagePath) {
  return `${String(storagePath).replace(/[/\\]+$/, '')}${ARCHIVE_FILE_SUFFIX}`
}

function getDirName (filepath) {
  const separatorIndex = Math.max(filepath.lastIndexOf('/'), filepath.lastIndexOf('\\'))
  return separatorIndex === -1 ? '.' : filepath.slice(0, separatorIndex) || '.'
}

function removeFile (filepath) {
  try {
    unlinkSync(filepath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

function withArchiveTransition (task) {
  const next = archiveTransition.then(task, task)
  archiveTransition = next.catch(() => {})
  return next
}
