import { fetch as expoFetch } from 'expo/fetch'
import { Directory, File, Paths } from 'expo-file-system'
import {
  FILTER_LIST_SCHEMA_VERSION,
  FILTER_LIST_SOURCES,
  isSafeFilterListResponseUrl,
  MAX_FILTER_LIST_BYTES,
  parseFilterListState,
  serializeFilterListState,
  shouldUpdateFilterLists,
  validateFilterListSnapshot
} from './filter-lists.mjs'
import { createForcedUpdateCoordinator } from './content-blocking-runtime.mjs'

const FILTER_DIRECTORY_NAME = 'content-blocking'
const ACTIVE_STATE_FILENAME = 'active.json'
const UPDATE_TIMEOUT_MS = 30_000
const PREAMBLE_BYTES = 512

export type FilterListState = {
  schemaVersion: number
  updatedAt: number
  snapshotName: string
  lists: Array<{
    id: string
    url: string
    filename: string
    byteLength: number
  }>
}

export async function loadFilterListState (): Promise<FilterListState | null> {
  const activeState = await loadStateFile(getStateFile())
  if (activeState) return activeState

  const backupFile = getStateBackupFile()
  const backupState = await loadStateFile(backupFile)
  if (!backupState) return null

  try {
    const stateFile = getStateFile()
    if (stateFile.exists) stateFile.delete()
    backupFile.move(stateFile)
  } catch (error) {
    console.warn('Unable to restore the previous filter-list state:', error)
  }

  return backupState
}

export function updateFilterLists ({
  force = false,
  now = Date.now()
}: {
  force?: boolean
  now?: number
} = {}): Promise<FilterListState> {
  return coordinateFilterListUpdate({ force, now })
}

const coordinateFilterListUpdate = createForcedUpdateCoordinator(performFilterListUpdate)

export function getFilterListFiles (state: FilterListState) {
  const snapshotDirectory = new Directory(getFilterDirectory(), state.snapshotName)
  return state.lists.map((record) => new File(snapshotDirectory, record.filename))
}

export async function activateFilterListState (state: FilterListState) {
  if (!isSnapshotComplete(state)) {
    throw new Error('Cannot activate an incomplete content-blocking snapshot.')
  }

  replaceStateFile(serializeFilterListState(state))
  removeInactiveSnapshots(state.snapshotName)
}

export async function discardFilterListState (state: FilterListState) {
  const activeState = await loadFilterListState()
  if (activeState?.snapshotName === state.snapshotName) return

  const snapshotDirectory = new Directory(getFilterDirectory(), state.snapshotName)
  if (snapshotDirectory.exists) snapshotDirectory.delete()
}

async function performFilterListUpdate ({
  force,
  now
}: {
  force: boolean
  now: number
}) {
  const currentState = await loadFilterListState()
  if (!force && currentState && !shouldUpdateFilterLists(currentState, now)) {
    return currentState
  }

  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError('Invalid filter-list update time.')
  }

  const filterDirectory = getFilterDirectory()
  filterDirectory.create({ idempotent: true, intermediates: true })
  const snapshotName = `snapshot-${now}`
  const snapshotDirectory = new Directory(filterDirectory, snapshotName)
  if (snapshotDirectory.exists) {
    throw new Error('A filter-list snapshot already exists for this update time.')
  }
  snapshotDirectory.create()

  try {
    const lists = []
    for (const source of FILTER_LIST_SOURCES) {
      const file = new File(snapshotDirectory, `${source.id}.txt`)
      const byteLength = await downloadFilterList(source, file)
      lists.push({
        id: source.id,
        url: source.url,
        filename: `${source.id}.txt`,
        byteLength
      })
    }

    const state = {
      schemaVersion: FILTER_LIST_SCHEMA_VERSION,
      updatedAt: now,
      snapshotName,
      lists
    } as FilterListState

    return state
  } catch (error) {
    if (snapshotDirectory.exists) snapshotDirectory.delete()
    throw error
  }
}

async function downloadFilterList (
  source: typeof FILTER_LIST_SOURCES[number],
  destination: File
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS)
  let handle: ReturnType<File['open']> | null = null

  try {
    const response = await expoFetch(source.url, {
      headers: { Accept: 'text/plain' },
      signal: controller.signal
    })
    if (!response.ok || !response.body) {
      throw new Error(`Unable to download ${source.title} (${response.status}).`)
    }

    if (!isSafeFilterListResponseUrl(response.url, source.url)) {
      throw new Error(`${source.title} redirected to an unsafe URL.`)
    }

    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FILTER_LIST_BYTES) {
      throw new Error(`${source.title} exceeds the size limit.`)
    }

    destination.create({ overwrite: true })
    handle = destination.open()
    const reader = response.body.getReader()
    let byteLength = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_FILTER_LIST_BYTES) {
        await reader.cancel()
        throw new Error(`${source.title} exceeds the size limit.`)
      }
      handle.writeBytes(value)
    }

    handle.close()
    handle = null
    const validation = validateFilterListSnapshot({
      id: source.id,
      byteLength,
      preamble: readAsciiPreamble(destination)
    })
    if (!validation.ok) throw new Error(`${source.title}: ${validation.error}`)
    return byteLength
  } finally {
    clearTimeout(timeout)
    handle?.close()
  }
}

function readAsciiPreamble (file: File) {
  const handle = file.open()
  try {
    return Array.from(handle.readBytes(PREAMBLE_BYTES), (byte) => String.fromCharCode(byte)).join('')
  } finally {
    handle.close()
  }
}

function isSnapshotComplete (state: FilterListState) {
  const snapshotDirectory = new Directory(getFilterDirectory(), state.snapshotName)
  if (!snapshotDirectory.exists) return false

  return state.lists.every((record) => {
    const file = new File(snapshotDirectory, record.filename)
    return file.exists && file.size === record.byteLength
  })
}

async function loadStateFile (file: File) {
  if (!file.exists) return null

  try {
    const state = parseFilterListState(await file.text()) as FilterListState | null
    return state && isSnapshotComplete(state) ? state : null
  } catch (error) {
    console.warn('Unable to load filter-list state:', error)
    return null
  }
}

function replaceStateFile (serialized: string) {
  const filterDirectory = getFilterDirectory()
  const stateFile = getStateFile()
  const temporary = new File(filterDirectory, `${ACTIVE_STATE_FILENAME}.tmp`)
  const backup = new File(filterDirectory, `${ACTIVE_STATE_FILENAME}.previous`)

  if (temporary.exists) temporary.delete()
  if (backup.exists) backup.delete()
  temporary.create()
  temporary.write(serialized)
  if (stateFile.exists) stateFile.move(backup)

  try {
    temporary.move(stateFile)
    if (backup.exists) backup.delete()
  } catch (error) {
    if (backup.exists && !stateFile.exists) backup.move(stateFile)
    throw error
  }
}

function removeInactiveSnapshots (activeSnapshotName: string) {
  try {
    for (const entry of getFilterDirectory().list()) {
      if (entry instanceof Directory &&
          entry.uri !== new Directory(getFilterDirectory(), activeSnapshotName).uri) {
        entry.delete()
      }
    }
  } catch (error) {
    console.warn('Unable to remove old filter-list snapshots:', error)
  }
}

function getFilterDirectory () {
  return new Directory(Paths.document, FILTER_DIRECTORY_NAME)
}

function getStateFile () {
  return new File(getFilterDirectory(), ACTIVE_STATE_FILENAME)
}

function getStateBackupFile () {
  return new File(getFilterDirectory(), `${ACTIVE_STATE_FILENAME}.previous`)
}
