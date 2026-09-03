import b4a from 'b4a'
import { createReadStream, statSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import {
  rememberPrivateHyperdrive,
  withHyperRuntimeForAddress,
  withHyperRuntimeOperation,
  withPrivateHyperRuntimeOperation
} from './runtime.mjs'
import { createHyperUrl, parseHyperUrl } from './url.mjs'
import { recordHyperArchive } from './archive.mjs'
import { resolveHyperdriveUploadTarget } from './storage-core.mjs'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_UPLOAD_BASE64_LENGTH = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4
const MAX_UPLOAD_FILE_URI_LENGTH = 8192
const MAX_LIST_ITEMS = 100
const MAX_SCANNED_ENTRIES = 500
const MAX_LIST_TIME_MS = 5000
const DIRECTORY_DISCOVERY_RETRY_DELAYS_MS = [500, 1000, 1500]
let uploadTransition = Promise.resolve()

export async function listHyperdriveLocation ({ url } = {}, options = {}) {
  const target = parseHyperUrl(url)
  if (target.error || target.driveAddress === 'default') {
    return { ok: false, error: target.error || 'A Hyperdrive address is required.' }
  }

  try {
    return await runWithRuntime(options, async (runtime) => {
      const drive = await runtime.getDrive(target.driveAddress)
      const explicitDirectory = target.pathname === '/' || target.pathname.endsWith('/')
      const entry = explicitDirectory
        ? null
        : await drive.entry(target.pathname, { timeout: MAX_LIST_TIME_MS })

      if (entry?.value?.blob) {
        const response = {
          ok: true,
          location: createFileItem(target.driveAddress, target.pathname, entry.value)
        }
        await (options.recordArchive || recordHyperArchive)({
          url: response.location.url,
          name: response.location.name,
          source: 'fetched'
        })
        return response
      }

      const directory = normalizeDirectoryPath(target.pathname)
      const { items, truncated, timedOut } = await listDirectoryWithDiscoveryRetry(
        drive,
        target.driveAddress,
        directory,
        resolveListTimeMs(options.listTimeMs),
        options.directoryRetryDelaysMs
      )
      if (directory !== '/' && items.length === 0 && !timedOut) {
        return { ok: false, error: 'No file or directory was found at this Hyper URL.' }
      }
      const response = {
        ok: true,
        location: {
          type: 'directory',
          name: directory === '/' ? shortDriveName(target.driveAddress) : basename(directory),
          url: createHyperUrl(target.driveAddress, directory),
          path: directory
        },
        items,
        truncated
      }
      await (options.recordArchive || recordHyperArchive)({
        url: response.location.url,
        name: response.location.name,
        source: 'fetched'
      })
      return response
    }, { address: target.driveAddress })
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function listDirectoryWithDiscoveryRetry (
  drive,
  driveAddress,
  directory,
  maxListTimeMs,
  retryDelays = DIRECTORY_DISCOVERY_RETRY_DELAYS_MS
) {
  const startedAt = Date.now()
  const delays = Array.isArray(retryDelays)
    ? retryDelays.filter((delay) => Number.isSafeInteger(delay) && delay >= 0).slice(0, 3)
    : DIRECTORY_DISCOVERY_RETRY_DELAYS_MS
  let attempts = 0
  let result

  while (true) {
    attempts += 1
    result = await listDirectory(
      drive,
      driveAddress,
      directory,
      Math.max(1, maxListTimeMs - (Date.now() - startedAt))
    )
    if (result.items.length > 0 || result.timedOut || !isAwaitingInitialMetadata(drive)) break

    const delay = delays[attempts - 1]
    const remainingTime = maxListTimeMs - (Date.now() - startedAt)
    if (delay === undefined || delay >= remainingTime) break
    await wait(delay)
  }

  return result
}

function isAwaitingInitialMetadata (drive) {
  const core = drive?.core || drive?.db?.core || null
  return core?.length === 0
}

function wait (delay) {
  return new Promise((resolve) => setTimeout(resolve, delay))
}

export async function uploadHyperdriveFile ({
  name,
  contentBase64,
  fileUri,
  byteLength,
  visibility
} = {}, options = {}) {
  const filename = normalizeFilename(name)
  if (!filename) return { ok: false, error: 'Invalid file name.' }
  const uploadTarget = resolveHyperdriveUploadTarget(visibility)
  if (!uploadTarget) return { ok: false, error: 'Choose public or private upload visibility.' }
  const localFile = normalizeLocalUploadFile(fileUri, byteLength)
  if (!localFile && (typeof contentBase64 !== 'string' || !contentBase64)) {
    return { ok: false, error: 'Missing file content.' }
  }
  if (!localFile && contentBase64.length > MAX_UPLOAD_BASE64_LENGTH) {
    return { ok: false, error: 'File size must be between 1 byte and 10 MB.' }
  }
  if (!localFile && !isValidBase64(contentBase64)) {
    return { ok: false, error: 'Invalid file content encoding.' }
  }

  const bytes = localFile ? null : decodeInlineUpload(contentBase64)
  if (!localFile && !bytes) return { ok: false, error: 'Invalid file content encoding.' }
  if (!localFile && (bytes.byteLength < 1 || bytes.byteLength > MAX_UPLOAD_BYTES)) {
    return { ok: false, error: 'File size must be between 1 byte and 10 MB.' }
  }

  return withUploadTransition(() => runWithRuntime(options, async (runtime) => {
    const drive = await runtime.getDrive(uploadTarget.driveName, {
      autoJoin: uploadTarget.autoJoin
    })
    if (visibility === 'private') rememberPrivateHyperdrive(drive)
    const pathname = await uniquePath(drive, `/${filename}`)
    if (localFile) {
      await writeLocalUpload(drive, pathname, localFile, options)
    } else {
      await drive.put(pathname, bytes)
    }

    const storedEntry = await drive.entry(pathname)
    const expectedByteLength = localFile?.byteLength || bytes.byteLength
    if (
      !storedEntry?.value?.blob ||
      storedEntry.value.blob.byteLength !== expectedByteLength
    ) {
      throw new Error('The uploaded file could not be verified in Hyperdrive.')
    }

    const item = createFileItem(`hyper://${drive.id}/`, pathname, {
      blob: { byteLength: expectedByteLength }
    })
    await (options.recordArchive || recordHyperArchive)({
      url: item.url,
      name: item.name,
      source: 'published',
      appId: 'hyperdrive'
    })

    return {
      ok: true,
      driveUrl: `hyper://${drive.id}/`,
      item: {
        ...item,
        visibility
      }
    }
  }, { privateRuntime: visibility === 'private' }))
}

function normalizeLocalUploadFile (fileUri, byteLength) {
  if (
    typeof fileUri !== 'string' ||
    fileUri.length < 1 ||
    fileUri.length > MAX_UPLOAD_FILE_URI_LENGTH ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1
  ) return null

  try {
    const parsed = new URL(fileUri)
    if (parsed.protocol !== 'file:' || parsed.hostname || parsed.search || parsed.hash) return null
    const filepath = decodeURIComponent(parsed.pathname)
    const normalizedPath = filepath.replaceAll('\\', '/')
    if (
      normalizedPath.includes('\0') ||
      normalizedPath.split('/').some((segment) => segment === '..') ||
      !/\/(?:cache|caches)\/documentpicker\//i.test(normalizedPath)
    ) return null

    return { path: filepath, byteLength }
  } catch {
    return null
  }
}

function decodeInlineUpload (contentBase64) {
  try {
    const bytes = b4a.from(contentBase64, 'base64')
    const paddingLength = contentBase64.endsWith('==') ? 2 : contentBase64.endsWith('=') ? 1 : 0
    const expectedByteLength = (contentBase64.length / 4) * 3 - paddingLength
    return bytes.byteLength === expectedByteLength ? bytes : null
  } catch {
    return null
  }
}

async function writeLocalUpload (drive, pathname, localFile, options) {
  if (options.uploadLocalFile) {
    await options.uploadLocalFile({ drive, pathname, ...localFile })
    return
  }

  const stat = statSync(localFile.path)
  if (!stat.isFile() || stat.size !== localFile.byteLength) {
    throw new Error('The selected file changed before it could be uploaded.')
  }

  await pipeline(
    createReadStream(localFile.path),
    drive.createWriteStream(pathname)
  )
}

async function listDirectory (drive, driveAddress, directory, maxListTimeMs) {
  const prefix = directory === '/' ? '/' : `${directory.replace(/\/$/, '')}/`
  const children = new Map()
  const startedAt = Date.now()
  let scanned = 0
  let truncated = false
  let timedOut = false
  const iterator = drive.list(prefix)[Symbol.asyncIterator]()

  try {
    while (true) {
      const remainingTime = maxListTimeMs - (Date.now() - startedAt)
      if (remainingTime <= 0 || scanned >= MAX_SCANNED_ENTRIES) {
        truncated = true
        break
      }

      let result
      try {
        result = await nextEntry(iterator, remainingTime)
      } catch (error) {
        if (!(error instanceof HyperdriveListTimeoutError)) throw error
        truncated = true
        timedOut = true
        break
      }
      const { done, value: entry } = result
      if (done) break
      scanned += 1
      if (!entry?.key || !entry.value) continue

      const relative = entry.key.slice(prefix.length)
      if (!relative) continue
      const [childName, ...rest] = relative.split('/')
      if (!childName || children.has(childName)) continue

      const childPath = `${prefix}${childName}`
      children.set(childName, rest.length > 0
        ? {
            type: 'directory',
            name: childName,
            path: `${childPath}/`,
            url: createHyperUrl(driveAddress, `${childPath}/`)
          }
        : createFileItem(driveAddress, childPath, entry.value))

      if (children.size >= MAX_LIST_ITEMS) {
        truncated = true
        break
      }
    }
  } finally {
    if (typeof iterator.return === 'function') await iterator.return()
  }

  return {
    items: Array.from(children.values()).sort((left, right) => {
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name)
    }),
    truncated,
    timedOut
  }
}

class HyperdriveListTimeoutError extends Error {}

function nextEntry (iterator, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new HyperdriveListTimeoutError('Hyperdrive listing timed out.')), timeoutMs)
    iterator.next().then(
      (result) => {
        clearTimeout(timeout)
        resolve(result)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

function resolveListTimeMs (value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_LIST_TIME_MS
    ? value
    : MAX_LIST_TIME_MS
}

function createFileItem (driveAddress, pathname, value) {
  return {
    type: 'file',
    name: basename(pathname),
    path: pathname,
    url: createHyperUrl(driveAddress, pathname),
    byteLength: Number.isSafeInteger(value?.blob?.byteLength)
      ? value.blob.byteLength
      : 0
  }
}

async function uniquePath (drive, pathname) {
  if (!await drive.exists(pathname)) return pathname

  const dot = pathname.lastIndexOf('.')
  const stem = dot > 0 ? pathname.slice(0, dot) : pathname
  const extension = dot > 0 ? pathname.slice(dot) : ''
  for (let suffix = 1; suffix <= 1000; suffix++) {
    const candidate = `${stem} (${suffix})${extension}`
    if (!await drive.exists(candidate)) return candidate
  }
  throw new Error('Unable to create a unique file name.')
}

function normalizeFilename (value) {
  if (typeof value !== 'string') return null
  const sanitized = Array.from(value.trim())
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && (code < 127 || code > 159)
    })
    .join('')
    .replace(/[/\\?#]/g, '-')
    .replace(/^[. -]+|[. ]+$/g, '')
  const filename = Array.from(sanitized).slice(0, 160).join('')
  return filename && filename !== '.' && filename !== '..' ? filename : null
}

function isValidBase64 (value) {
  if (value.length % 4 !== 0) return false

  const paddingLength = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const contentLength = value.length - paddingLength
  for (let index = 0; index < contentLength; index++) {
    const code = value.charCodeAt(index)
    const isAlphaNumeric =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122)
    if (!isAlphaNumeric && code !== 43 && code !== 47) return false
  }

  for (let index = contentLength; index < value.length; index++) {
    if (value.charCodeAt(index) !== 61) return false
  }
  return true
}

function normalizeDirectoryPath (pathname) {
  return pathname === '/' ? '/' : `${pathname.replace(/\/$/, '')}/`
}

function basename (pathname) {
  const normalized = pathname.replace(/\/$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || 'Hyperdrive'
}

function shortDriveName (driveAddress) {
  const key = driveAddress.slice('hyper://'.length, -1)
  return `${key.slice(0, 8)}...${key.slice(-6)}`
}

function runWithRuntime (options, operation, { address, privateRuntime = false } = {}) {
  if (privateRuntime && options.privateRuntime) return operation(options.privateRuntime)
  if (options.runtime) return operation(options.runtime)
  if (privateRuntime) return withPrivateHyperRuntimeOperation(operation)
  if (address) return withHyperRuntimeForAddress(address, operation)
  return withHyperRuntimeOperation(operation)
}

async function withUploadTransition (operation) {
  const previous = uploadTransition
  let release
  uploadTransition = new Promise((resolve) => { release = resolve })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}
