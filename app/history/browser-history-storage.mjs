import {
  MAX_BROWSER_HISTORY_FILE_BYTES,
  parseBrowserHistoryResult
} from './browser-history.mjs'

export async function readBrowserHistoryFile (
  file,
  maxBytes = MAX_BROWSER_HISTORY_FILE_BYTES
) {
  if (!file.exists) return { ok: true, exists: false, items: [] }

  const size = Number(file.size)
  if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
    return { ok: false, exists: true, items: [], error: 'Browser history file is too large.' }
  }

  const result = parseBrowserHistoryResult(await file.text())
  if (!result.ok) {
    return { ok: false, exists: true, items: [], error: 'Browser history file is malformed.' }
  }

  return { ok: true, exists: true, items: result.items }
}

export function replaceBrowserHistoryFile ({ activeUri, backupUri, createFile, temporaryUri }, serialized) {
  let temporary = createFile(temporaryUri)
  if (temporary.exists) temporary.delete()
  temporary.create({ intermediates: true })
  temporary.write(serialized)

  let backup = createFile(backupUri)
  if (backup.exists) backup.delete()

  const active = createFile(activeUri)
  if (active.exists) active.move(backup)

  try {
    temporary = createFile(temporaryUri)
    temporary.move(createFile(activeUri))
  } catch (error) {
    const failedActive = createFile(activeUri)
    if (failedActive.exists) failedActive.delete()
    backup = createFile(backupUri)
    if (backup.exists) backup.move(createFile(activeUri))
    throw error
  }

  backup = createFile(backupUri)
  if (backup.exists) backup.delete()
}
