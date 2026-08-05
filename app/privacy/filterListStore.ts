import { fetch as expoFetch } from 'expo/fetch'
import { Asset } from 'expo-asset'
import { Directory, File, Paths } from 'expo-file-system'
import {
  createBundledFilterListState,
  FILTER_LIST_SCHEMA_VERSION,
  FILTER_LIST_SOURCES,
  getBoundedFilterListTransferLength,
  isSafeFilterListResponseUrl,
  MAX_FILTER_LIST_BYTES,
  parseFilterListState,
  readFilterListVersion,
  serializeFilterListState,
  shouldUpdateFilterLists,
  validateBundledFilterListRecord,
  validateFilterListSnapshot
} from './filter-lists.mjs'
import { createForcedUpdateCoordinator } from './content-blocking-runtime.mjs'

const FILTER_DIRECTORY_NAME = 'content-blocking'
const ACTIVE_STATE_FILENAME = 'active.json'
const UPDATE_TIMEOUT_MS = 30_000
const PREAMBLE_BYTES = 512
const VERSION_PREAMBLE_BYTES = 16 * 1024
const bundledManifest = require('../../assets/content-blocking/manifest.json')
const bundledAssets: Record<string, number> = {
  easylist: require('../../assets/content-blocking/easylist.txt'),
  easyprivacy: require('../../assets/content-blocking/easyprivacy.txt')
}
let bundledInstallInFlight: Promise<FilterListState | null> | null = null

export type FilterListState = {
  schemaVersion: number
  updatedAt: number
  snapshotName: string
  lists: Array<{
    id: string
    url: string
    filename: string
    byteLength: number
    version: string
  }>
}

export async function loadFilterListState (): Promise<FilterListState | null> {
  const activeState = await loadStateFile(getStateFile())
  if (activeState) return activeState

  const backupFile = getStateBackupFile()
  const backupState = await loadStateFile(backupFile)
  if (!backupState) return installBundledFilterListState()

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
      const { byteLength, version } = await downloadFilterList(source, file)
      lists.push({
        id: source.id,
        url: source.url,
        filename: `${source.id}.txt`,
        byteLength,
        version
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
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let readerComplete = false

  try {
    const response = await expoFetch(source.url, {
      headers: {
        Accept: 'text/plain',
        Range: `bytes=0-${MAX_FILTER_LIST_BYTES}`
      },
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`Unable to download ${source.title} (${response.status}).`)
    }

    if (!isSafeFilterListResponseUrl(response.url, source.url)) {
      throw new Error(`${source.title} redirected to an unsafe URL.`)
    }

    const contentLength = response.headers.get('content-length')
    const contentRange = response.headers.get('content-range')
    const boundedTransferLength = getBoundedFilterListTransferLength({
      status: response.status,
      contentLength,
      contentRange
    })
    if (boundedTransferLength === null) {
      throw new Error(
        `${source.title} returned an unbounded response ` +
        `(status ${response.status}, length ${contentLength || 'missing'}, range ${contentRange || 'missing'}).`
      )
    }

    destination.create({ overwrite: true })
    handle = destination.open()
    reader = response.body?.getReader() || null
    if (!reader) throw new Error(`${source.title} did not return a readable body.`)
    const preamble = new Uint8Array(VERSION_PREAMBLE_BYTES)
    let preambleLength = 0
    let byteLength = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        readerComplete = true
        break
      }
      byteLength += value.byteLength
      if (byteLength > MAX_FILTER_LIST_BYTES) {
        throw new Error(`${source.title} exceeds the size limit.`)
      }
      handle.writeBytes(value)
      const remaining = preamble.byteLength - preambleLength
      if (remaining > 0) {
        const chunk = value.subarray(0, remaining)
        preamble.set(chunk, preambleLength)
        preambleLength += chunk.byteLength
      }
    }

    handle.close()
    handle = null
    const headerBytes = preamble.subarray(0, preambleLength)
    const validation = validateFilterListSnapshot({
      id: source.id,
      byteLength,
      preamble: Array.from(
        headerBytes.subarray(0, PREAMBLE_BYTES),
        (byte) => String.fromCharCode(byte)
      ).join('')
    })
    if (!validation.ok) throw new Error(`${source.title}: ${validation.error}`)
    return {
      byteLength,
      version: readFilterListVersion(bytesToLatin1(headerBytes))
    }
  } finally {
    clearTimeout(timeout)
    if (reader && !readerComplete) {
      try {
        await reader.cancel()
      } catch (error) {
        console.warn(`Unable to close the ${source.title} response stream:`, error)
      }
    }
    handle?.close()
  }
}

function installBundledFilterListState () {
  if (bundledInstallInFlight) return bundledInstallInFlight
  bundledInstallInFlight = performBundledInstall().finally(() => {
    bundledInstallInFlight = null
  })
  return bundledInstallInFlight
}

async function performBundledInstall (): Promise<FilterListState | null> {
  const state = createBundledFilterListState(bundledManifest) as FilterListState | null
  if (!state) throw new Error('Invalid bundled content-blocking manifest.')

  const filterDirectory = getFilterDirectory()
  filterDirectory.create({ idempotent: true, intermediates: true })
  const snapshotDirectory = new Directory(filterDirectory, state.snapshotName)
  if (snapshotDirectory.exists) snapshotDirectory.delete()
  snapshotDirectory.create()

  try {
    for (const record of state.lists) {
      const moduleId = bundledAssets[record.id]
      if (!moduleId) throw new Error(`Missing bundled ${record.id} asset.`)
      const asset = await Asset.fromModule(moduleId).downloadAsync()
      if (!asset.localUri) throw new Error(`Unable to load bundled ${record.id} asset.`)
      const destination = new File(snapshotDirectory, record.filename)
      new File(asset.localUri).copy(destination)
      const handle = destination.open()
      let preamble
      try {
        preamble = bytesToLatin1(handle.readBytes(VERSION_PREAMBLE_BYTES))
      } finally {
        handle.close()
      }
      const validation = validateBundledFilterListRecord({
        record,
        byteLength: destination.size,
        preamble
      })
      if (!validation.ok) {
        throw new Error(`Bundled ${record.id}: ${validation.error}`)
      }
    }

    replaceStateFile(serializeFilterListState(state))
    removeInactiveSnapshots(state.snapshotName)
    return state
  } catch (error) {
    if (snapshotDirectory.exists) snapshotDirectory.delete()
    throw error
  }
}

function bytesToLatin1 (bytes: Uint8Array) {
  return Array.from(
    bytes,
    (byte) => String.fromCharCode(byte)
  ).join('')
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
    // Expo mutates the source File URI after move(), so resolve active.json again.
    temporary.move(getStateFile())
  } catch (error) {
    const activeFile = getStateFile()
    if (backup.exists && !activeFile.exists) backup.move(activeFile)
    throw error
  }

  try {
    if (backup.exists) backup.delete()
  } catch (error) {
    console.warn('Unable to remove the previous filter-list state:', error)
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
