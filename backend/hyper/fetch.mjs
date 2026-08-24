import b4a from 'b4a'
import makeHyperFetch from 'hypercore-fetch'
import {
  createProxyAssetUrl,
  getHyperNavigationDownloadName,
  getHyperNavigationMediaType,
  inlineHyperAssets
} from './assets.mjs'
import { startHyperAssetServer } from './asset-server.mjs'
import {
  DEFAULT_HYPER_DISCOVERY_MAX_RETRY_DELAY,
  DEFAULT_HYPER_DISCOVERY_RETRIES,
  DEFAULT_HYPER_DISCOVERY_RETRY_DELAY,
  withHyperRetry
} from './fetch-retry.mjs'
import { getHyperRuntime } from './runtime.mjs'
import { parseHyperUrl } from './url.mjs'

let hyperFetch = null

export { stopHyperAssetServer } from './asset-server.mjs'
export {
  DEFAULT_HYPER_DISCOVERY_MAX_RETRY_DELAY,
  DEFAULT_HYPER_DISCOVERY_RETRIES,
  DEFAULT_HYPER_DISCOVERY_RETRY_DELAY,
  isPeerDiscoveryError,
  withHyperRetry
} from './fetch-retry.mjs'

export function resetHyperFetch () {
  hyperFetch = null
}

export async function fetchHyper ({
  url,
  method = 'GET',
  inlineAssets = false,
  retries = DEFAULT_HYPER_DISCOVERY_RETRIES,
  retryDelay = DEFAULT_HYPER_DISCOVERY_RETRY_DELAY,
  maxRetryDelay = DEFAULT_HYPER_DISCOVERY_MAX_RETRY_DELAY,
  backoffFactor = 2
} = {}) {
  if (method.toUpperCase() !== 'GET') {
    return { ok: false, error: 'Only GET is currently supported' }
  }

  const target = parseHyperUrl(url)
  if (target.error) return { ok: false, error: target.error }

  const runtime = await getHyperRuntime()
  const fetch = await getHyperFetch(runtime)

  return withHyperRetry({
    fetch,
    url,
    retries,
    retryDelay,
    maxRetryDelay,
    backoffFactor,
    readResponse: async (response, headers) => {
      const responseUrl = response.url || url
      const mediaType = getHyperNavigationMediaType(responseUrl, headers)
      const downloadName = getHyperNavigationDownloadName(responseUrl, headers)
      if (downloadName && !mediaType) {
        await cancelResponseBody(response.body)
        const proxyServer = await startHyperAssetServer(fetch)
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
        const proxyServer = await startHyperAssetServer(fetch)
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
        const proxyServer = await startHyperAssetServer(fetch)
        body = await inlineHyperAssets({
          html: body,
          baseUrl: response.url || url,
          fetch,
          assetBaseUrl: proxyServer.localUrl,
          assetAuthToken: proxyServer.authToken
        })
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url || url,
        headers,
        body
      }
    }
  })
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

export async function fetchHyperBinary ({
  url,
  method = 'GET',
  retries = DEFAULT_HYPER_DISCOVERY_RETRIES,
  retryDelay = DEFAULT_HYPER_DISCOVERY_RETRY_DELAY,
  maxRetryDelay = DEFAULT_HYPER_DISCOVERY_MAX_RETRY_DELAY,
  backoffFactor = 2
} = {}) {
  if (method.toUpperCase() !== 'GET') {
    return { ok: false, error: 'Only GET is currently supported' }
  }

  const target = parseHyperUrl(url)
  if (target.error) return { ok: false, error: target.error }

  const runtime = await getHyperRuntime()
  const fetch = await getHyperFetch(runtime)

  return withHyperRetry({
    fetch,
    url,
    retries,
    retryDelay,
    maxRetryDelay,
    backoffFactor,
    readResponse: async (response, headers) => {
      const contentLength = Number(headers['content-length'] || 0)
      if (contentLength > 50 * 1024 * 1024) {
        throw new Error(`Response exceeds 50MB limit: ${contentLength} bytes`)
      }

      const chunks = []
      let totalLength = 0
      const body = response.body

      if (body && typeof body.getReader === 'function') {
        const reader = body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          totalLength += value.byteLength || value.length
          if (totalLength > 50 * 1024 * 1024) throw new Error('Response exceeds 50MB limit')
          chunks.push(chunkToUint8Array(value))
        }
      } else if (body && typeof body[Symbol.asyncIterator] === 'function') {
        for await (const chunk of body) {
          totalLength += chunk.byteLength || chunk.length
          if (totalLength > 50 * 1024 * 1024) throw new Error('Response exceeds 50MB limit')
          chunks.push(chunkToUint8Array(chunk))
        }
      } else {
        const buf = chunkToUint8Array(await response.arrayBuffer())
        if (buf.byteLength > 50 * 1024 * 1024) throw new Error('Response exceeds 50MB limit')
        chunks.push(buf)
      }

      const bytes = b4a.concat(chunks)

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url || url,
        headers,
        bytes
      }
    }
  })
}

async function getHyperFetch (runtime) {
  if (hyperFetch) return hyperFetch

  ensureFetchGlobals()

  hyperFetch = await makeHyperFetch({
    sdk: runtime,
    writable: false
  })

  return hyperFetch
}

function ensureFetchGlobals () {
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
