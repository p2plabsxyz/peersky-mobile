import b4a from 'b4a'
import { withHyperRuntimeOperation } from './runtime.mjs'
import { parseHyperUrl } from './url.mjs'
import { resolveHyperdriveAppDriveName } from './storage-core.mjs'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_UPLOAD_BASE64_LENGTH = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4
const MAX_LIST_ITEMS = 100
const MAX_SCANNED_ENTRIES = 500
const MAX_LIST_TIME_MS = 5000
let uploadTransition = Promise.resolve()

export async function listHyperdriveLocation ({ url } = {}, options = {}) {
  const target = parseHyperUrl(url)
  if (target.error || target.driveAddress === 'default') {
    return { ok: false, error: target.error || 'A Hyperdrive address is required.' }
  }

  try {
    return await runWithRuntime(options, async (runtime) => {
      const drive = await runtime.getDrive(target.driveAddress)
      const entry = target.pathname === '/'
        ? null
        : await drive.entry(target.pathname, { timeout: MAX_LIST_TIME_MS })

      if (entry?.value?.blob) {
        return {
          ok: true,
          location: createFileItem(target.driveAddress, target.pathname, entry.value)
        }
      }

      const directory = normalizeDirectoryPath(target.pathname)
      const { items, truncated } = await listDirectory(drive, target.driveAddress, directory)
      if (directory !== '/' && items.length === 0) {
        return { ok: false, error: 'No file or directory was found at this Hyper URL.' }
      }
      return {
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
    })
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function uploadHyperdriveFile ({ name, contentBase64 } = {}, options = {}) {
  const filename = normalizeFilename(name)
  if (!filename) return { ok: false, error: 'Invalid file name.' }
  if (typeof contentBase64 !== 'string' || !contentBase64) {
    return { ok: false, error: 'Missing file content.' }
  }
  if (contentBase64.length > MAX_UPLOAD_BASE64_LENGTH) {
    return { ok: false, error: 'File size must be between 1 byte and 10 MB.' }
  }
  if (!isValidBase64(contentBase64)) {
    return { ok: false, error: 'Invalid file content encoding.' }
  }

  let bytes
  try {
    bytes = b4a.from(contentBase64, 'base64')
  } catch {
    return { ok: false, error: 'Invalid file content encoding.' }
  }

  const paddingLength = contentBase64.endsWith('==') ? 2 : contentBase64.endsWith('=') ? 1 : 0
  const expectedByteLength = (contentBase64.length / 4) * 3 - paddingLength
  if (bytes.byteLength !== expectedByteLength) {
    return { ok: false, error: 'Invalid file content encoding.' }
  }

  if (bytes.byteLength < 1 || bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'File size must be between 1 byte and 10 MB.' }
  }

  return withUploadTransition(() => runWithRuntime(options, async (runtime) => {
    const drive = await runtime.getDrive(resolveHyperdriveAppDriveName())
    const pathname = await uniquePath(drive, `/${filename}`)
    await drive.put(pathname, bytes)

    return {
      ok: true,
      driveUrl: `hyper://${drive.id}/`,
      item: createFileItem(`hyper://${drive.id}/`, pathname, {
        blob: { byteLength: bytes.byteLength }
      })
    }
  }))
}

async function listDirectory (drive, driveAddress, directory) {
  const prefix = directory === '/' ? '/' : `${directory.replace(/\/$/, '')}/`
  const children = new Map()
  const startedAt = Date.now()
  let scanned = 0
  let truncated = false
  const iterator = drive.list(prefix)[Symbol.asyncIterator]()

  try {
    while (true) {
      const remainingTime = MAX_LIST_TIME_MS - (Date.now() - startedAt)
      if (remainingTime <= 0 || scanned >= MAX_SCANNED_ENTRIES) {
        truncated = true
        break
      }

      const { done, value: entry } = await nextEntry(iterator, remainingTime)
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
    truncated
  }
}

function nextEntry (iterator, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Hyperdrive listing timed out.')), timeoutMs)
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
  const filename = Array.from(value.trim())
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && (code < 127 || code > 159)
    })
    .join('')
    .replace(/[/\\?#]/g, '-')
    .replace(/^[. -]+|[. ]+$/g, '')
    .slice(0, 160)
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

function createHyperUrl (driveAddress, pathname) {
  const encodedPath = pathname
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${driveAddress.slice(0, -1)}${encodedPath}`
}

function basename (pathname) {
  const normalized = pathname.replace(/\/$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || 'Hyperdrive'
}

function shortDriveName (driveAddress) {
  const key = driveAddress.slice('hyper://'.length, -1)
  return `${key.slice(0, 8)}...${key.slice(-6)}`
}

function runWithRuntime (options, operation) {
  return options.runtime ? operation(options.runtime) : withHyperRuntimeOperation(operation)
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
