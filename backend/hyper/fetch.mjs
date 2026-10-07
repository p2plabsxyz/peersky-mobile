import b4a from 'b4a'
import makeHyperFetch from 'hypercore-fetch'
import {
  createProxyAssetUrl,
  getHyperNavigationDownloadName,
  getHyperNavigationMediaType,
  headersToObject,
  inlineHyperAssets
} from './assets.mjs'
import { startHyperAssetServer } from './asset-server.mjs'
import { BLOCKED_DRIVE_MESSAGE, isBlockedDrive } from './blocked-drives.mjs'
import {
  DEFAULT_HYPER_DISCOVERY_MAX_RETRY_DELAY,
  DEFAULT_HYPER_DISCOVERY_RETRIES,
  DEFAULT_HYPER_DISCOVERY_RETRY_DELAY,
  withHyperRetry
} from './fetch-retry.mjs'
import {
  adoptLinkedPrivateDriveIfReadable,
  isPrivateHyperAddress,
  withHyperRuntimeForAddress
} from './runtime.mjs'
import { isUnreadableDriveError, PRIVATE_DRIVE_ERROR } from './linked-private-drives.mjs'
import { normalizeDriveAddressId } from './runtime-routing.mjs'
import {
  isNamedDriveRequest,
  namespacePageDriveRequest,
  pageMayWriteTo,
  pageSiteId,
  rememberPageDrive
} from './page-access.mjs'
import { refreshHyperRuntimeNetwork } from './network-refresh.mjs'
import { createHyperUrl, getHyperSearch, getHyperVisibility, parseHyperUrl, toHyperFetchUrl } from './url.mjs'
import { writeHyperResponseToFile } from './binary-response.mjs'
import { parseMultipartFormData } from './form-data.mjs'
import { configureHyperReadTimeout } from './read-policy.mjs'

let hyperFetches = new WeakMap()
let hyperWriteFetches = new WeakMap()

export { stopHyperAssetServer } from './asset-server.mjs'

export function resetHyperFetch () {
  hyperFetches = new WeakMap()
  hyperWriteFetches = new WeakMap()
}

// What a page is allowed to ask for. Everything else is a write, which goes
// down a different path: no asset inlining, no media proxy, and a body.
const HYPER_READ_METHODS = new Set(['GET', 'HEAD'])
// POST creates a named drive, PUT puts a file in it. That is the whole publish
// flow. DELETE is left out on purpose: "DELETE hyper://<key>/" throws away a
// whole drive, and no page needs that to publish.
const HYPER_WRITE_METHODS = new Set(['POST', 'PUT'])
// Uploads here land in the ordinary networked runtime. Private and device-only
// drives live in separate storage this path does not reach, and quietly
// publishing something a page asked to keep private is the one outcome worth
// refusing outright.
const PUBLIC_VISIBILITY = new Set(['', 'public'])

/**
 * @param {object} options
 * @param {string|null} [options.page] The hyper:// page that asked, when the
 *   request came through the page bridge rather than from the app itself.
 */
export async function fetchHyper ({
  url,
  method = 'GET',
  body = null,
  headers: requestHeaders = null,
  page = null,
  inlineAssets = false,
  retries = DEFAULT_HYPER_DISCOVERY_RETRIES,
  retryDelay = DEFAULT_HYPER_DISCOVERY_RETRY_DELAY,
  maxRetryDelay = DEFAULT_HYPER_DISCOVERY_MAX_RETRY_DELAY,
  backoffFactor = 2
} = {}) {
  const normalizedMethod = String(method || 'GET').toUpperCase()
  if (!HYPER_READ_METHODS.has(normalizedMethod) && !HYPER_WRITE_METHODS.has(normalizedMethod)) {
    return { ok: false, error: `${normalizedMethod} is not supported over hyper://` }
  }

  const target = parseHyperUrl(url)
  if (target.error) return { ok: false, error: target.error }
  if (isBlockedDrive(target.driveAddress)) return { ok: false, status: 451, error: BLOCKED_DRIVE_MESSAGE }
  // Creating a named drive is hyper://localhost/?key=myapp, so the query has to
  // survive the trip. Reads never carried one.
  const requestUrl = createHyperUrl(target.driveAddress, target.pathname) + getHyperSearch(url)

  const pageSite = page === null ? null : pageSiteId(page)
  if (page !== null && !pageSite) {
    return { ok: false, status: 403, error: 'Only a hyper:// page can make hyper:// requests' }
  }

  if (HYPER_WRITE_METHODS.has(normalizedMethod)) {
    return writeHyper({
      target,
      requestUrl,
      method: normalizedMethod,
      body,
      headers: requestHeaders,
      pageSite
    })
  }

  // A link to someone's private drive can reach a page, and the phone holds
  // the keys that open it. Only that drive's own pages may read it.
  if (pageSite && normalizeDriveAddressId(target.driveAddress) !== pageSite &&
    await isPrivateHyperAddress(target.driveAddress)) {
    return { ok: false, status: 403, error: 'A page cannot read private drives' }
  }

  const read = () => withHyperRuntimeForAddress(target.driveAddress, async (runtime) => {
    await prepareHyperRead(runtime, target.driveAddress)
    const fetch = await getHyperFetch(runtime)

    const result = await withHyperRetry({
      fetch,
      url: requestUrl,
      retries,
      retryDelay,
      maxRetryDelay,
      backoffFactor,
      beforeRetry: () => refreshHyperRuntimeNetwork(runtime),
      readResponse: async (response, headers) => {
        const responseUrl = response.url || requestUrl
        const mediaType = getHyperNavigationMediaType(responseUrl, headers)
        const downloadName = getHyperNavigationDownloadName(responseUrl, headers)
        if (downloadName && !mediaType) {
          await probeResponseBody(response.body)
          const proxyServer = await startHyperAssetServer(routedHyperFetch, routedHyperRangeFetch)
          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            url: responseUrl,
            headers,
            downloadName,
            downloadUrl: createProxyAssetUrl(
              proxyServer.localUrl,
              responseUrl,
              proxyServer.authToken,
              downloadName
            )
          }
        }

        if (mediaType) {
          await cancelResponseBody(response.body)
          const proxyServer = await startHyperAssetServer(routedHyperFetch, routedHyperRangeFetch)
          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            url: responseUrl,
            headers,
            mediaName: normalizeMediaName(responseUrl),
            mediaType,
            mediaUrl: createProxyAssetUrl(
              proxyServer.localUrl,
              responseUrl,
              proxyServer.authToken
            )
          }
        }

        let body = await response.text()

        if (inlineAssets && isHtmlResponse(headers, body)) {
          const proxyServer = await startHyperAssetServer(routedHyperFetch, routedHyperRangeFetch)
          body = await inlineHyperAssets({
            html: body,
            baseUrl: response.url || requestUrl,
            fetch,
            assetBaseUrl: proxyServer.localUrl,
            assetAuthToken: proxyServer.authToken
          })
        }

        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          url: response.url || requestUrl,
          headers,
          body
        }
      }
    })

    return result
  })

  const result = await read()
  // A private drive a linked device made after the link reads as ciphertext
  // from the public store, which came back as a decoding error. Tried with this
  // phone's private keys: one that opens it routes it to the private store from
  // now on, and it is read again, as it is when another of its files read at
  // the same time got there first. A device that is not linked gets told what
  // the drive is.
  if (result?.ok === false && isUnreadableDriveError(result.error)) {
    if (await isPrivateHyperAddress(target.driveAddress) ||
      await adoptLinkedPrivateDriveIfReadable(target.driveAddress)) return read()
    return { ok: false, status: 403, error: PRIVATE_DRIVE_ERROR }
  }
  return result
}

/**
 * A write from a page: POST to create a named drive, PUT a file into one.
 *
 * Nothing here is retried. A read can be attempted again because it has no
 * effect; repeating a write could upload a file twice.
 */
async function writeHyper ({ target, requestUrl, method, body, headers, pageSite = null }) {
  const visibility = getHyperVisibility(requestUrl)
  if (!PUBLIC_VISIBILITY.has(visibility)) {
    return { ok: false, error: `Only public uploads work from a page. Use the Hyperdrive app for ${visibility} ones.` }
  }

  const namedDrive = Boolean(pageSite) && isNamedDriveRequest(requestUrl, method)
  if (namedDrive) {
    const namespaced = namespacePageDriveRequest(requestUrl, pageSite)
    if (namespaced.error) return { ok: false, status: 400, error: namespaced.error }
    requestUrl = namespaced.url
  } else if (pageSite && !pageMayWriteTo(pageSite, target.driveAddress)) {
    return { ok: false, status: 403, error: 'A page can only write to drives it created' }
  }

  return withHyperRuntimeForAddress(target.driveAddress, async (runtime) => {
    const fetch = await getHyperWriteFetch(runtime)
    const payload = decodeRequestBody(body)
    if (payload.error) return { ok: false, error: payload.error }

    const response = await fetch(requestUrl, {
      method,
      ...(payload.bytes === null ? {} : { body: payload.bytes }),
      ...(headers && typeof headers === 'object' ? { headers } : {})
    })

    const responseHeaders = headersToObject(response.headers)
    const responseText = await response.text()
    if (namedDrive && response.ok) rememberPageDrive(pageSite, responseText)
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url || requestUrl,
      headers: responseHeaders,
      body: responseText
    }
  })
}

// The page hands its body over as base64, because the bridge between the
// WebView and here carries text.
function decodeRequestBody (body) {
  if (body === null || body === undefined || body === '') return { bytes: null }
  if (typeof body !== 'string') return { error: 'Request body must be base64 text' }

  try {
    const bytes = b4a.from(body, 'base64')
    return { bytes }
  } catch {
    return { error: 'Request body is not valid base64' }
  }
}

function normalizeMediaName (url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'Hyper media')
  } catch {
    return 'Hyper media'
  }
}

async function cancelResponseBody (body) {
  if (!body) return

  try {
    if (typeof body.getReader === 'function') {
      const reader = body.getReader()
      try {
        await reader.cancel()
      } finally {
        if (reader.releaseLock) reader.releaseLock()
      }
      return
    }

    if (typeof body.destroy === 'function') {
      body.destroy()
      return
    }

    if (typeof body.return === 'function') await body.return()
  } catch {}
}

/**
 * Downloads one hyper:// file straight to disk. Used for a transfer from
 * another device, which can be hundreds of megabytes: the body is written as
 * it arrives instead of being collected in memory. Blocks get a longer wait
 * than a page does, because a transfer comes from one phone over whatever
 * connection it has, and one slow block should not end the whole thing.
 */
export async function fetchHyperToFile ({
  url,
  filePath,
  maxBytes,
  retries = 8,
  retryDelay = 500,
  maxRetryDelay = 4000,
  backoffFactor = 2,
  onProgress
} = {}) {
  const target = parseHyperUrl(url)
  if (target.error) return { ok: false, error: target.error }
  const requestUrl = createHyperUrl(target.driveAddress, target.pathname)

  return withHyperRuntimeForAddress(target.driveAddress, async (runtime) => {
    const drive = await runtime.getDrive(target.driveAddress)
    configureHyperReadTimeout(drive, { timeoutMs: 30000 })
    const fetch = await getHyperFetch(runtime)

    return withHyperRetry({
      fetch,
      url: requestUrl,
      retries,
      retryDelay,
      maxRetryDelay,
      backoffFactor,
      beforeRetry: () => refreshHyperRuntimeNetwork(runtime),
      readResponse: (response, headers) => writeHyperResponseToFile(response, headers, requestUrl, filePath, { maxBytes, onProgress })
    })
  })
}

async function getHyperFetch (runtime) {
  const existing = hyperFetches.get(runtime)
  if (existing) return existing

  ensureFetchGlobals()

  const fetch = await makeHyperFetch({
    sdk: runtime,
    writable: false
  })

  hyperFetches.set(runtime, fetch)
  return fetch
}

/**
 * A second hypercore-fetch, the writable one. With writable off it registers
 * no POST or PUT routes, so publishing failed with "Load failed". The reading
 * instance stays read-only so a rendered page cannot write by accident, and
 * only requests through the bridge get this one. It still refuses any drive
 * this device has no write key for.
 */
async function getHyperWriteFetch (runtime) {
  const existing = hyperWriteFetches.get(runtime)
  if (existing) return existing

  ensureFetchGlobals()

  const fetch = await makeHyperFetch({
    sdk: runtime,
    writable: true
  })

  hyperWriteFetches.set(runtime, fetch)
  return fetch
}

/** Looks for peers of the drive behind url again, as a retry does. */
export function refreshHyperNetworkFor (url) {
  return withHyperRuntimeForAddress(url, (runtime) => refreshHyperRuntimeNetwork(runtime))
}

// What the media links and PeerTunes read through. A song or a picture with
// "&" or "," in its name would not load until the address was respelled.
export function routedHyperFetch (url, options) {
  return withHyperRuntimeForAddress(url, async (runtime) => {
    await prepareHyperRead(runtime, url)
    const fetch = await getHyperFetch(runtime)
    return fetch(toHyperFetchUrl(url), options)
  })
}

export function routedHyperRangeFetch (url, rangeHeader) {
  const target = parseHyperUrl(url)
  if (target.error) throw new Error(target.error)

  return withHyperRuntimeForAddress(target.driveAddress, async (runtime) => {
    await prepareHyperRead(runtime, target.driveAddress)
    const drive = await runtime.getDrive(target.driveAddress)
    const entry = await drive.entry(target.pathname)
    const byteLength = Number(entry?.value?.blob?.byteLength)
    const range = parseBoundedByteRange(rangeHeader, byteLength)
    if (!range) throw new Error('Requested Hyper media range is unavailable')

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      url,
      headers: new Headers({
        'Accept-Ranges': 'bytes',
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${byteLength}`
      }),
      body: drive.createReadStream(target.pathname, range)
    }
  })
}

function parseBoundedByteRange (rangeHeader, byteLength) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1) return null
  const match = String(rangeHeader || '').match(/^bytes=(?:(\d+)-(\d+)|-(\d+))$/i)
  if (!match) return null

  if (match[3]) {
    const suffixLength = Number(match[3])
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) return null
    return {
      start: Math.max(0, byteLength - suffixLength),
      end: byteLength - 1
    }
  }

  const start = Number(match[1])
  const requestedEnd = Number(match[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start > requestedEnd || start >= byteLength) {
    return null
  }
  return { start, end: Math.min(requestedEnd, byteLength - 1) }
}

async function probeResponseBody (body) {
  if (!body) throw new Error('Hyper file response has no content')

  if (typeof body[Symbol.asyncIterator] === 'function') {
    const iterator = body[Symbol.asyncIterator]()
    try {
      const first = await iterator.next()
      if (first.done || !first.value || first.value.byteLength === 0) {
        throw new Error('Hyper file is empty or unavailable')
      }
    } finally {
      if (typeof iterator.return === 'function') await iterator.return()
    }
    return
  }

  if (typeof body.getReader === 'function') {
    const reader = body.getReader()
    try {
      const first = await reader.read()
      if (first.done || !first.value || first.value.byteLength === 0) {
        throw new Error('Hyper file is empty or unavailable')
      }
      await reader.cancel()
    } finally {
      if (reader.releaseLock) reader.releaseLock()
    }
    return
  }

  throw new Error('Hyper file response is not streamable')
}

async function prepareHyperRead (runtime, address) {
  const drive = await runtime.getDrive(address)
  configureHyperReadTimeout(drive)
}

export function ensureFetchGlobals () {
  if (typeof globalThis.Headers !== 'function') {
    globalThis.Headers = BareHeaders
  }

  if (typeof globalThis.Request !== 'function') {
    globalThis.Request = BareRequest
  }

  if (typeof globalThis.Response !== 'function') {
    globalThis.Response = BareResponse
  }
}

function isHtmlResponse (headers, body) {
  const contentType = headers['content-type'] || ''
  return contentType.includes('text/html') || /^\s*<(?:!doctype|html|head|body|main|section|article|div|h1|p)\b/i.test(body)
}

class BareHeaders {
  constructor (headers = {}) {
    this.headers = new Map()

    if (!headers) return

    if (headers instanceof BareHeaders) {
      headers.forEach((value, key) => this.set(key, value))
      return
    }

    if (typeof headers.forEach === 'function') {
      headers.forEach((value, key) => this.set(key, value))
      return
    }

    if (typeof headers[Symbol.iterator] === 'function') {
      for (const [key, value] of headers) {
        this.set(key, value)
      }
      return
    }

    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) this.set(key, value)
    }
  }

  get (key) {
    return this.headers.get(normalizeHeaderName(key)) || null
  }

  set (key, value) {
    this.headers.set(normalizeHeaderName(key), String(value))
  }

  has (key) {
    return this.headers.has(normalizeHeaderName(key))
  }

  forEach (callback) {
    for (const [key, value] of this.headers) {
      callback(value, key, this)
    }
  }
}

class BareRequest {
  constructor (input, init = {}) {
    if (input instanceof BareRequest) {
      this.url = input.url
      this.method = init.method || input.method
      this.headers = new BareHeaders(init.headers || input.headers)
      this.body = init.body === undefined ? input.body : init.body
      return
    }

    this.url = String(input)
    this.method = String(init.method || 'GET').toUpperCase()
    this.headers = new BareHeaders(init.headers)
    this.body = init.body || null
  }

  async text () {
    return bodyToString(this.body)
  }

  async arrayBuffer () {
    return uint8ArrayToArrayBuffer(await bodyToUint8Array(this.body))
  }

  // hypercore-fetch reads a FormData upload, several files at once, with this.
  async formData () {
    return parseMultipartFormData(await bodyToUint8Array(this.body), this.headers.get('content-type'))
  }
}

class BareResponse {
  constructor (body = null, init = {}) {
    this.body = body
    this.status = init.status || init.statusCode || 200
    this.statusText = init.statusText || getStatusText(this.status)
    this.headers = new BareHeaders(init.headers)
    this.ok = this.status >= 200 && this.status < 300
    this.url = ''
  }

  async text () {
    return bodyToString(this.body)
  }

  async json () {
    return JSON.parse(await this.text())
  }

  async arrayBuffer () {
    return uint8ArrayToArrayBuffer(await bodyToUint8Array(this.body))
  }
}

function normalizeHeaderName (key) {
  return String(key).toLowerCase()
}

async function bodyToString (body) {
  const bytes = await bodyToUint8Array(body)
  return b4a.toString(bytes)
}

async function bodyToUint8Array (body) {
  if (!body) return new Uint8Array()
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (typeof body === 'string') return b4a.from(body)

  const chunks = []

  if (typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body) {
      chunks.push(chunkToUint8Array(chunk))
    }
    return concatChunks(chunks)
  }

  if (typeof body.on === 'function') {
    return new Promise((resolve, reject) => {
      body.on('data', (chunk) => chunks.push(chunkToUint8Array(chunk)))
      body.on('end', () => resolve(concatChunks(chunks)))
      body.on('error', reject)
    })
  }

  return b4a.from(String(body))
}

function chunkToUint8Array (chunk) {
  if (chunk instanceof Uint8Array) return chunk
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk)
  return b4a.from(String(chunk))
}

function concatChunks (chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0

  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }

  return result
}

function uint8ArrayToArrayBuffer (bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function getStatusText (status) {
  if (status === 200) return 'OK'
  if (status === 204) return 'No Content'
  if (status === 400) return 'Bad Request'
  if (status === 404) return 'Not Found'
  if (status === 500) return 'Internal Server Error'
  return ''
}
