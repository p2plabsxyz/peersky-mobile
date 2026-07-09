import b4a from 'b4a'
import makeHyperFetch from 'hypercore-fetch'
import { getHyperRuntime } from './runtime.mjs'
import { parseHyperUrl } from './url.mjs'

let hyperFetch = null
const MAX_INLINE_ASSETS = 32
const MAX_INLINE_ASSET_BYTES = 2 * 1024 * 1024
const MAX_INLINE_STYLESHEET_BYTES = 4 * 1024 * 1024

export async function fetchHyper ({
  url,
  method = 'GET',
  inlineAssets = false
} = {}) {
  if (method.toUpperCase() !== 'GET') {
    return { ok: false, error: 'Only GET is currently supported' }
  }

  const target = parseHyperUrl(url)
  if (target.error) return { ok: false, error: target.error }

  const runtime = await getHyperRuntime()
  const fetch = await getHyperFetch(runtime)

  try {
    const response = await fetch(url)
    const headers = headersToObject(response.headers)
    let body = await response.text()

    if (inlineAssets && isHtmlResponse(headers, body)) {
      body = await inlineHyperAssets({
        html: body,
        baseUrl: response.url || url,
        fetch
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
  } catch (error) {
    return {
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      url,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function getHyperFetch (runtime) {
  if (hyperFetch) return hyperFetch

  ensureFetchGlobals()

  hyperFetch = await makeHyperFetch({
    sdk: runtime,
    writable: true
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

function headersToObject (headers) {
  const result = {}

  if (!headers) return result

  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      result[key.toLowerCase()] = value
    })
    return result
  }

  if (typeof headers[Symbol.iterator] === 'function') {
    for (const [key, value] of headers) {
      result[String(key).toLowerCase()] = String(value)
    }
    return result
  }

  return result
}

function isHtmlResponse (headers, body) {
  const contentType = headers['content-type'] || ''
  return contentType.includes('text/html') || /^\s*<(?:!doctype|html|head|body|main|section|article|div|h1|p)\b/i.test(body)
}

async function inlineHyperAssets ({
  html,
  baseUrl,
  fetch
}) {
  const replacements = new Map()
  let assetCount = 0

  const assetRefs = findHyperAssetRefs(html, baseUrl)

  for (const [source, assetUrl] of assetRefs) {
    if (assetCount >= MAX_INLINE_ASSETS) break
    if (replacements.has(source)) continue

    assetCount += 1
    const dataUrl = await fetchAsDataUrl(fetch, assetUrl)
    if (!dataUrl) continue

    replacements.set(source, dataUrl)
  }

  return rewriteHyperAssetAttributes(html, baseUrl, replacements)
}

function findHyperAssetRefs (html, baseUrl) {
  const refs = new Map()
  const attributes = /\b(?:src|href|poster)\s*=\s*(["'])([^"']+)\1/gi
  let match = attributes.exec(html)

  while (match) {
    const original = match[2]
    const assetUrl = resolveHyperAssetUrl(original, baseUrl)

    if (assetUrl && shouldInlineAsset(original, assetUrl)) {
      refs.set(original, assetUrl)
    }

    match = attributes.exec(html)
  }

  return refs
}

function resolveHyperAssetUrl (source, baseUrl) {
  const value = String(source || '').trim()
  if (!value || value.startsWith('#')) return null
  if (/^(?:data|blob|javascript|mailto|tel):/i.test(value)) return null
  if (/^https?:\/\//i.test(value)) return null
  if (value.startsWith('//')) return null

  try {
    const resolved = new URL(value, baseUrl)
    return resolved.protocol === 'hyper:' ? resolved.href : null
  } catch {
    return null
  }
}

function shouldInlineAsset (source, assetUrl) {
  const value = `${source} ${assetUrl}`.toLowerCase()
  return /\.(?:avif|bmp|gif|ico|jpeg|jpg|js|mjs|png|svg|webp|css)(?:[?#].*)?$/.test(value)
}

async function fetchAsDataUrl (fetch, assetUrl) {
  try {
    const response = await fetch(assetUrl)
    if (!response.ok) return null

    const headers = headersToObject(response.headers)
    const contentType = headers['content-type'] || getContentTypeFromUrl(assetUrl)
    const byteLimit = getInlineAssetByteLimit(assetUrl, contentType)
    const contentLength = Number(headers['content-length'])
    if (Number.isFinite(contentLength) && contentLength > byteLimit) return null

    const bytes = chunkToUint8Array(await response.arrayBuffer())
    if (bytes.byteLength > byteLimit) return null

    return `data:${contentType};base64,${b4a.toString(bytes, 'base64')}`
  } catch {
    return null
  }
}

function getInlineAssetByteLimit (assetUrl, contentType) {
  if (isStylesheetAsset(assetUrl, contentType)) return MAX_INLINE_STYLESHEET_BYTES
  return MAX_INLINE_ASSET_BYTES
}

function isStylesheetAsset (assetUrl, contentType) {
  if (String(contentType || '').toLowerCase().includes('text/css')) return true

  try {
    return new URL(assetUrl).pathname.toLowerCase().endsWith('.css')
  } catch {
    return String(assetUrl || '').toLowerCase().split(/[?#]/, 1)[0].endsWith('.css')
  }
}

function rewriteHyperAssetAttributes (html, baseUrl, replacements) {
  return html.replace(
    /\b(src|href|poster)(\s*=\s*)(["'])([^"']+)\3/gi,
    (match, name, separator, quote, source) => {
      const assetUrl = resolveHyperAssetUrl(source, baseUrl)
      const dataUrl = assetUrl ? replacements.get(source) : null
      if (!dataUrl) return match
      return `${name}${separator}${quote}${dataUrl}${quote}`
    }
  )
}

function getContentTypeFromUrl (url) {
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase()
    } catch {
      return String(url).toLowerCase()
    }
  })()

  if (pathname.endsWith('.avif')) return 'image/avif'
  if (pathname.endsWith('.bmp')) return 'image/bmp'
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8'
  if (pathname.endsWith('.gif')) return 'image/gif'
  if (pathname.endsWith('.ico')) return 'image/x-icon'
  if (pathname.endsWith('.jpeg') || pathname.endsWith('.jpg')) return 'image/jpeg'
  if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) return 'text/javascript; charset=utf-8'
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
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
