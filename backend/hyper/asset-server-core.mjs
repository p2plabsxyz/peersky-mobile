import b4a from 'b4a'
import {
  getContentTypeFromUrl,
  headersToObject,
  isMalformedRangeHeader
} from './assets.mjs'
import { parseHyperUrl } from './url.mjs'

const HYPER_ASSET_HOST = '127.0.0.1'

export function createHyperAssetServer ({
  fetch,
  httpImpl
}) {
  if (!httpImpl || typeof httpImpl.createServer !== 'function') {
    throw new Error('Missing HTTP implementation for Hyper asset server')
  }

  return httpImpl.createServer((req, res) => {
    handleHyperAssetRequest(req, res, fetch)
  })
}

function handleHyperAssetRequest (req, res, fetch) {
  if (req.method === 'OPTIONS') {
    sendAssetEmpty(res, 204)
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendAssetText(res, 405, 'Method not allowed')
    return
  }

  const requestUrl = new URL(String(req.url || '/'), `http://${HYPER_ASSET_HOST}`)
  if (requestUrl.pathname !== '/asset') {
    sendAssetText(res, 404, 'Not found')
    return
  }

  const assetUrl = requestUrl.searchParams.get('url')
  if (!assetUrl) {
    sendAssetText(res, 400, 'Missing asset url')
    return
  }

  const parsed = parseHyperUrl(assetUrl)
  if (parsed.error) {
    sendAssetText(res, 400, parsed.error)
    return
  }

  streamHyperAsset(fetch, assetUrl, req, res)
    .catch((error) => {
      sendAssetError(res, error)
    })
}

async function streamHyperAsset (fetch, assetUrl, req, res) {
  const rangeHeader = getRequestHeader(req, 'range')
  if (isMalformedRangeHeader(rangeHeader)) {
    sendAssetEmpty(res, 416)
    return
  }

  const response = await fetch(assetUrl, rangeHeader
    ? { headers: new Headers([['Range', String(rangeHeader)]]) }
    : undefined)

  if (!response.ok) {
    throw createHttpError(response.status || 502, response.statusText || 'Unable to fetch Hyper asset')
  }

  const headers = headersToObject(response.headers)
  const status = rangeHeader && headers['content-range'] ? 206 : response.status
  const contentType = headers['content-type'] || getContentTypeFromUrl(assetUrl)

  if (isStreamableBody(response.body)) {
    sendProxyAssetHeaders(res, {
      status,
      headers,
      contentType
    })

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    await writeResponseBody(res, response.body)
    return
  }

  throw createHttpError(502, 'Hyper asset response is not streamable')
}

function getRequestHeader (req, name) {
  const headers = req.headers || {}
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || null
}

function sendProxyAssetHeaders (res, {
  status,
  headers,
  contentType
}) {
  setAssetCorsHeaders(res)
  res.statusCode = status
  res.setHeader('Accept-Ranges', headers['accept-ranges'] || 'bytes')
  res.setHeader('Cache-Control', headers['cache-control'] || 'public, max-age=300')
  res.setHeader('Content-Type', contentType)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Connection', 'close')

  copyProxyHeader(res, headers, 'content-length')
  copyProxyHeader(res, headers, 'content-range')
  copyProxyHeader(res, headers, 'etag')
  copyProxyHeader(res, headers, 'last-modified')
}

function copyProxyHeader (res, headers, name) {
  const value = headers[name]
  if (value !== undefined && value !== null) res.setHeader(name, value)
}

function isStreamableBody (body) {
  return Boolean(
    body &&
    (
      typeof body[Symbol.asyncIterator] === 'function' ||
      typeof body.getReader === 'function' ||
      typeof body.on === 'function'
    )
  )
}

async function writeResponseBody (res, body) {
  if (typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body) {
      await writeResponseChunk(res, chunk)
    }
    res.end()
    return
  }

  if (typeof body.getReader === 'function') {
    const reader = body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await writeResponseChunk(res, value)
      }
    } finally {
      if (reader.releaseLock) reader.releaseLock()
    }
    res.end()
    return
  }

  await writeEventedBody(res, body)
}

function writeResponseChunk (res, chunk) {
  const bytes = chunkToUint8Array(chunk)
  if (bytes.byteLength < 1) return Promise.resolve()

  return new Promise((resolve, reject) => {
    try {
      res.write(bytes, (error) => {
        if (error) reject(error)
        else resolve()
      })
    } catch (error) {
      reject(error)
    }
  })
}

function writeEventedBody (res, body) {
  return new Promise((resolve, reject) => {
    body.on('data', (chunk) => {
      res.write(chunkToUint8Array(chunk))
    })
    body.on('end', () => {
      res.end()
      resolve()
    })
    body.on('error', reject)
  })
}

function sendAssetText (res, statusCode, message) {
  const body = String(message || '')
  setAssetCorsHeaders(res)
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Length', String(b4a.byteLength(body)))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Connection', 'close')
  res.end(body)
}

function sendAssetError (res, error) {
  if (res.headersSent) {
    res.destroy(error)
    return
  }

  sendAssetText(res, error.statusCode || 502, error.message)
}

function sendAssetEmpty (res, statusCode) {
  setAssetCorsHeaders(res)
  res.statusCode = statusCode
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Connection', 'close')
  res.end()
}

function setAssetCorsHeaders (res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Range')
  res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range')
}

function createHttpError (statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function chunkToUint8Array (chunk) {
  if (chunk instanceof Uint8Array) return chunk
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk)
  return b4a.from(String(chunk))
}
