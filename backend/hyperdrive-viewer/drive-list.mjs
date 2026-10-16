import b4a from 'b4a'
import { BLOCKED_DRIVE_MESSAGE, isBlockedDrive } from '../hyper/blocked-drives.mjs'
import { isPeerDiscoveryError } from '../hyper/fetch-retry.mjs'
import { isUnreadableDriveError, PRIVATE_DRIVE_ERROR } from '../hyper/linked-private-drives.mjs'
import { configureHyperReadTimeout } from '../hyper/read-policy.mjs'
import { normalizeDriveAddressId } from '../hyper/runtime-routing.mjs'
import { parseHyperUrl } from '../hyper/url.mjs'

// What the Hyperdrive viewer shows of a folder: every file under it, at any
// depth, with its size and when it was written, in the shape the desktop's
// hyperdrive-list answers with.

export const MAX_LISTED_FILES = 50000
// A drive nobody is seeding answers no-peers rather than holding the viewer,
// and a clear or a restore that waits for running reads, for good. A drive
// whose peer answers slowly gets longer: a big folder over the internet is
// thousands of block reads, each one bounded on its own (read-policy.mjs).
export const PEER_WAIT_MS = 30000
export const LIST_TIME_MS = 2 * 60 * 1000
// Longer than any real file's path, and longer than an address can carry.
const MAX_PATH_LENGTH = 4096
// All the paths of one answer together, so a drive of very long names cannot
// fill the worklet's memory before the count runs out.
const MAX_LISTED_PATH_CHARACTERS = 16 * 1024 * 1024

// The viewer explains each code in its own words.
export const LIST_ERROR_STATUS = Object.freeze({
  'not-found': 404,
  'no-peers': 503,
  private: 403,
  timeout: 504,
  'too-large': 413,
  unknown: 500
})

class ListTimeoutError extends Error {}

/** Set off when the viewer stops waiting for an answer. */
export function createListSignal () {
  const listeners = new Set()
  const signal = {
    aborted: false,
    abort () {
      if (signal.aborted) return
      signal.aborted = true
      for (const listener of listeners) listener()
      listeners.clear()
    },
    onAbort (listener) {
      if (signal.aborted) listener()
      else listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
  return signal
}

/**
 * The files under a folder of a drive:
 * { ok: true, entries: [{ path, size, mtime }], truncated, private, writable },
 * or { ok: false, status, code, message }. At the top of a drive whose name
 * this phone knows, `name` is that name (drive-names.mjs).
 *
 * Private drives follow the rules the app's own pages have in fetch.mjs: this
 * phone's private drives and its linked devices' open with their keys, a
 * linked device's newer one is tried with this phone's keys, and anyone
 * else's answers `private`.
 *
 * @param {string} url
 * @param {object} options
 * @param {(address: string, task: (runtime: any) => Promise<any>) => Promise<any>} options.withRuntime
 * @param {(address: string) => Promise<boolean>} [options.isPrivate]
 * @param {(address: string) => Promise<boolean>} [options.opensAsPrivate]
 * @param {(runtime: any) => Promise<unknown>} [options.refreshNetwork]
 * @param {(id: string) => string | null | Promise<string | null>} [options.driveName]
 *   The name a drive was made under, by its key in hex.
 */
export async function listHyperdriveFolder (url, {
  recursive = true,
  signal = null,
  limit = MAX_LISTED_FILES,
  peerWaitMs = PEER_WAIT_MS,
  listTimeMs = LIST_TIME_MS,
  withRuntime,
  isPrivate = async () => false,
  opensAsPrivate = async () => false,
  refreshNetwork = async () => {},
  driveName = () => null
} = {}) {
  const target = parseHyperUrl(url)
  if (target.error || target.driveAddress === 'default') {
    return listFailure('unknown', target.error || 'A hyper:// address is needed.', 400)
  }
  if (isBlockedDrive(target.driveAddress)) return listFailure('unknown', BLOCKED_DRIVE_MESSAGE, 451)

  const folder = target.pathname.endsWith('/') ? target.pathname : `${target.pathname}/`
  const list = () => withRuntime(target.driveAddress, async (runtime) => {
    const drive = await runtime.getDrive(target.driveAddress)
    configureHyperReadTimeout(drive)
    if (!await waitForDrive(drive, runtime, { timeoutMs: peerWaitMs, refreshNetwork, signal })) {
      return listFailure('no-peers', 'Nobody who has this drive could be reached.')
    }

    const listed = await collectFiles(drive, folder, { recursive, limit, timeoutMs: listTimeMs, signal })
    if (listed.entries.length === 0 && folder !== '/' && !await hasAnyEntry(drive, folder, listTimeMs)) {
      return listFailure('not-found', 'Nothing is at this address in the drive.')
    }

    const result = {
      ok: true,
      entries: listed.entries,
      truncated: listed.truncated,
      private: await isPrivate(target.driveAddress).catch(() => false) === true,
      writable: drive.writable === true
    }
    if (folder === '/') {
      const name = await nameOf(drive, target.driveAddress, driveName)
      if (name) result.name = name
    }
    return result
  })

  try {
    return await list()
  } catch (error) {
    // Encrypted, and read without its key. This phone's keys are tried first,
    // as the browser does, so a private drive a linked device made since the
    // link opens here too.
    if (isUnreadableDriveError(error) && await opensAsPrivate(target.driveAddress).catch(() => false)) {
      try {
        return await list()
      } catch (retryError) {
        return failureFor(retryError)
      }
    }
    return failureFor(error)
  }
}

/**
 * A drive this phone knows nothing about yet has no length until a peer says
 * how long it is. That wait is bounded, and true means there is something to
 * read. The release findingPeers() hands back is what makes update() wait for
 * a peer at all, as the desktop's waitForDriveReady does.
 */
async function waitForDrive (drive, runtime, { timeoutMs, refreshNetwork, signal }) {
  if (drive.writable || coreLength(drive) > 0) return true

  const core = drive.core
  const done = typeof core?.findingPeers === 'function' ? core.findingPeers() : null
  let timer = null
  let stopListening = () => {}
  try {
    if (done) {
      const swarm = runtime?.swarm
      if (typeof swarm?.flush === 'function') Promise.resolve(swarm.flush()).then(done, done)
      else done()
    }
    await Promise.resolve(refreshNetwork(runtime)).catch(() => {})
    await Promise.race([
      Promise.resolve(typeof core?.update === 'function' ? core.update({ wait: true }) : null).catch(() => {}),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs) }),
      new Promise((resolve) => { if (signal) stopListening = signal.onAbort(resolve) })
    ])
  } finally {
    clearTimeout(timer)
    stopListening()
    if (done) done()
  }

  if (signal?.aborted) throw abortError()
  return coreLength(drive) > 0
}

function coreLength (drive) {
  const length = drive?.core?.length ?? drive?.db?.core?.length
  return Number.isSafeInteger(length) ? length : 0
}

async function collectFiles (drive, folder, { recursive, limit, timeoutMs, signal }) {
  const entries = []
  let truncated = false
  let characters = 0
  const deadline = Date.now() + timeoutMs
  const iterator = drive.list(folder, { recursive: recursive !== false })[Symbol.asyncIterator]()

  try {
    while (true) {
      if (signal?.aborted) throw abortError()
      const { done, value: entry } = await nextWithin(iterator, deadline - Date.now())
      if (done) break

      const path = entry?.key
      const blob = entry?.value?.blob
      // Files only: a link has no blob, and a folder is not an entry at all.
      if (typeof path !== 'string' || !blob || !path.startsWith(folder) || path.length > MAX_PATH_LENGTH) continue
      // The shallow list hands back the first entry inside each subfolder.
      if (recursive === false && path.slice(folder.length).includes('/')) continue

      if (entries.length >= limit || characters + path.length > MAX_LISTED_PATH_CHARACTERS) {
        truncated = true
        break
      }
      characters += path.length
      entries.push({
        path,
        size: Number.isSafeInteger(blob.byteLength) && blob.byteLength >= 0 ? blob.byteLength : 0,
        mtime: timeOf(entry.value.metadata)
      })
    }
  } finally {
    if (typeof iterator.return === 'function') await iterator.return().catch(() => {})
  }

  return { entries, truncated }
}

// The name the drive was made under, by its key: the drive's own, so a drive
// opened by a DNS name finds it too. Not knowing it never fails the listing.
async function nameOf (drive, address, driveName) {
  try {
    const key = drive?.key
    const id = key && key.byteLength === 32 ? b4a.toString(key, 'hex') : normalizeDriveAddressId(address)
    if (!id) return null
    const name = await driveName(id)
    return typeof name === 'string' && name ? name : null
  } catch {
    return null
  }
}

// Whether anything at all is under a folder: one with only subfolders, or
// only links, is still there.
async function hasAnyEntry (drive, folder, timeoutMs) {
  const iterator = drive.list(folder, { recursive: true })[Symbol.asyncIterator]()
  try {
    const { done } = await nextWithin(iterator, timeoutMs)
    return !done
  } finally {
    if (typeof iterator.return === 'function') await iterator.return().catch(() => {})
  }
}

// When the file was written, in milliseconds, as hypercore-fetch keeps it.
function timeOf (metadata) {
  const mtime = metadata && typeof metadata === 'object' ? metadata.mtime : null
  return typeof mtime === 'number' && Number.isFinite(mtime) && mtime > 0 ? mtime : null
}

function nextWithin (iterator, timeoutMs) {
  if (timeoutMs <= 0) return Promise.reject(new ListTimeoutError('Listing the drive took too long.'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ListTimeoutError('Listing the drive took too long.')), timeoutMs)
    iterator.next().then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function abortError () {
  const error = new Error('The viewer stopped waiting for the listing.')
  error.name = 'AbortError'
  return error
}

function failureFor (error) {
  const message = error instanceof Error ? error.message : String(error || '')
  if (error?.name === 'AbortError') return listFailure('unknown', message, 499)
  if (isUnreadableDriveError(error)) return listFailure('private', PRIVATE_DRIVE_ERROR)
  if (error?.code === 'BLOCKED_DRIVE') return listFailure('unknown', BLOCKED_DRIVE_MESSAGE, 451)
  if (error instanceof ListTimeoutError || isRequestTimeout(error)) {
    return listFailure('timeout', 'The drive took too long to answer. Try again.')
  }
  if (isPeerDiscoveryError(message)) return listFailure('no-peers', 'Nobody who has this drive could be reached.')
  return listFailure('unknown', message || 'The folder could not be listed.')
}

function isRequestTimeout (error) {
  const message = error instanceof Error ? error.message : String(error || '')
  return error?.code === 'REQUEST_TIMEOUT' || /\brequest(?:_|\s+)timeout\b|request timed out/i.test(message)
}

function listFailure (code, message, status = LIST_ERROR_STATUS[code]) {
  return { ok: false, status, code, message }
}
