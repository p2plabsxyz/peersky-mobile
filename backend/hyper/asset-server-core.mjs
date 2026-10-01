import b4a from 'b4a'
import {
  createDownloadContentDisposition,
  getContentTypeFromUrl,
  headersToObject,
  isMalformedRangeHeader,
  normalizeDownloadFilename,
  signHyperAssetUrl
} from './assets.mjs'
import { parseHyperUrl } from './url.mjs'

const HYPER_ASSET_HOST = '127.0.0.1'
const HYPER_MEDIA_WINDOW_BYTES = 4 * 1024 * 1024

export function createHyperAssetServer ({
  fetch,
  fetchRange,
  httpImpl,
  authToken
}) {
  if (!httpImpl || typeof httpImpl.createServer !== 'function') {
    throw new Error('Missing HTTP implementation for Hyper asset server')
  }
  if (typeof authToken !== 'string' || authToken.length < 32) {
    throw new Error('Missing auth token for Hyper asset server')
  }

  return httpImpl.createServer((req, res) => {
    handleHyperAssetRequest(req, res, fetch, fetchRange, authToken)
  })
}

function handleHyperAssetRequest (req, res, fetch, fetchRange, authToken) {
  const requestUrl = new URL(String(req.url || '/'), `http://${HYPER_ASSET_HOST}`)
  if (requestUrl.pathname !== '/asset') {
    sendAssetText(res, 404, 'Not found')
    return
  }
  if (!requestUrl.searchParams.get('url')) {
    sendAssetText(res, 400, 'Missing asset url')
    return
  }
  if (!hasValidAssetSignature(requestUrl, authToken)) {
    sendAssetText(res, 401, 'Unauthorized')
    return
  }

  if (req.method === 'OPTIONS') {
    sendAssetEmpty(res, 204)
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendAssetText(res, 405, 'Method not allowed')
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

  const downloadName = requestUrl.searchParams.has('download')
    ? normalizeDownloadFilename(requestUrl.searchParams.get('name'), assetUrl)
    : null
  streamHyperAsset(fetch, fetchRange, assetUrl, req, res, downloadName)
    .catch((error) => {
      if (req.aborted || res.destroyed) return
      sendAssetError(res, error)
    })
}

function hasValidAssetSignature (requestUrl, secret) {
  const token = requestUrl.searchParams.get('token') || ''
  const expected = signHyperAssetUrl(secret, requestUrl.searchParams.get('url') || '')
  if (token.length !== expected.length) return false
  let difference = 0
  for (let index = 0; index < token.length; index++) {
    difference |= token.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return difference === 0
}

export async function streamHyperAsset (fetch, fetchRange, assetUrl, req, res, downloadName) {
  const rangeHeader = getRequestHeader(req, 'range')
  if (isMalformedRangeHeader(rangeHeader)) {
    sendAssetEmpty(res, 416)
    return
  }

  let response = await fetch(assetUrl, rangeHeader
    ? { headers: new Headers([['Range', String(rangeHeader)]]) }
    : undefined)

  if (req.aborted || res.destroyed) {
    await cancelResponseBody(response.body)
    return
  }

  assertSuccessfulAssetResponse(response)

  let headers = headersToObject(response.headers)
  const inferredContentType = getContentTypeFromUrl(assetUrl)
  let contentType = getProxyContentType(headers, inferredContentType)

  const mediaWindowRange = getMediaWindowRange({
    contentType,
    downloadName,
    method: req.method,
    rangeHeader,
    headers
  })
  if (mediaWindowRange) {
    await cancelResponseBody(response.body)
    response = typeof fetchRange === 'function'
      ? await fetchRange(assetUrl, mediaWindowRange)
      : await fetch(assetUrl, {
        headers: new Headers([['Range', mediaWindowRange]])
      })
    if (req.aborted || res.destroyed) {
      await cancelResponseBody(response.body)
      return
    }
    assertSuccessfulAssetResponse(response)
    headers = headersToObject(response.headers)
    contentType = getProxyContentType(headers, inferredContentType)
    if (isOversizedMediaResponse(headers)) {
      await cancelResponseBody(response.body)
      throw createHttpError(502, 'Hyper media server ignored the bounded range request')
    }
  }

  const status = headers['content-range'] ? 206 : response.status
  if (isStreamableBody(response.body)) {
    sendProxyAssetHeaders(res, {
      status,
      headers,
      contentType,
      downloadName
    })

    if (req.method === 'HEAD') {
      await cancelResponseBody(response.body)
      res.end()
      return
    }

    await writeResponseBody(req, res, response.body)
    return
  }

  throw createHttpError(502, 'Hyper asset response is not streamable')
}

function assertSuccessfulAssetResponse (response) {
  if (!response.ok) {
    throw createHttpError(response.status || 502, response.statusText || 'Unable to fetch Hyper asset')
  }
}

function getProxyContentType (headers, inferredContentType) {
  const upstreamContentType = String(headers['content-type'] || '')
  const inferredIsMedia = /^(?:audio|image|video)\//i.test(inferredContentType)
  const upstreamIsMedia = /^(?:audio|image|video)\//i.test(upstreamContentType)
  return !upstreamContentType ||
    /^application\/octet-stream(?:\s*;|$)/i.test(upstreamContentType) ||
    (inferredIsMedia && !upstreamIsMedia)
    ? inferredContentType
    : upstreamContentType
}

function getMediaWindowRange ({
  contentType,
  downloadName,
  method,
  rangeHeader,
  headers
}) {
  if (method !== 'GET' || downloadName) return null
  if (!/^(?:audio|video)\//i.test(contentType)) return null

  // Only narrow a request the client actually ranged. Answering a plain GET
  // with 206 and a windowed Content-Length is an unsolicited partial response:
  // WebKit opens media with a bare GET, so it never learned the real length and
  // duration, the progress bar and seeking were all dead on iOS. Chromium opens
  // with "Range: bytes=0-", which is why Android looked fine.
  if (!rangeHeader) return null

  const contentLength = Number(headers['content-length'])
  const responseIsBounded = Number.isSafeInteger(contentLength) &&
    contentLength <= HYPER_MEDIA_WINDOW_BYTES
  const requestedRange = parseMediaRange(rangeHeader)
  if (responseIsBounded) return null

  if (requestedRange?.suffixLength) {
    return `bytes=-${Math.min(requestedRange.suffixLength, HYPER_MEDIA_WINDOW_BYTES)}`
  }

  const start = requestedRange?.start || 0
  const totalLength = getAssetTotalLength(headers, rangeHeader)
  const limits = [start + HYPER_MEDIA_WINDOW_BYTES - 1]
  if (Number.isSafeInteger(totalLength)) limits.push(totalLength - 1)
  // A client asking for bytes=0-1000 must not be handed the whole window back.
  if (Number.isSafeInteger(requestedRange?.end)) limits.push(requestedRange.end)
  const end = Math.min(...limits)
  return end >= start ? `bytes=${start}-${end}` : null
}

function parseMediaRange (rangeHeader) {
  if (!rangeHeader) return null

  const range = String(rangeHeader).match(/^bytes=(?:(\d+)-(\d*)|-(\d+))$/i)
  if (!range) return null
  if (range[3]) {
    const suffixLength = Number(range[3])
    return Number.isSafeInteger(suffixLength) ? { suffixLength } : null
  }

  const start = Number(range[1])
  if (!Number.isSafeInteger(start)) return null
  const end = range[2] ? Number(range[2]) : null
  return Number.isSafeInteger(end) ? { start, end } : { start }
}

function getAssetTotalLength (headers, rangeHeader) {
  const contentRange = String(headers['content-range'] || '')
  const totalMatch = contentRange.match(/\/(\d+)$/)
  if (totalMatch) return Number(totalMatch[1])

  const contentLength = Number(headers['content-length'])
  return !rangeHeader && Number.isSafeInteger(contentLength) ? contentLength : null
}

function isOversizedMediaResponse (headers) {
  const contentLength = Number(headers['content-length'])
  return Number.isSafeInteger(contentLength) && contentLength > HYPER_MEDIA_WINDOW_BYTES
}

async function cancelResponseBody (body) {
  if (!body) return

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
}

function getRequestHeader (req, name) {
  const headers = req.headers || {}
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || null
}

function sendProxyAssetHeaders (res, {
  status,
  headers,
  contentType,
  downloadName
}) {
  setAssetCorsHeaders(res)
  res.statusCode = status
  res.setHeader('Accept-Ranges', headers['accept-ranges'] || 'bytes')
  res.setHeader('Cache-Control', headers['cache-control'] || 'public, max-age=300')
  res.setHeader('Content-Type', contentType)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Connection', 'close')
  if (downloadName) {
    res.setHeader(
      'Content-Disposition',
      createDownloadContentDisposition(downloadName)
    )
  }

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

async function writeResponseBody (req, res, body) {
  let disconnected = false
  let cancelBody = () => cancelResponseBody(body)
  let cancellation = null
  const onDisconnect = () => {
    if (disconnected) return
    disconnected = true
    cancellation = Promise.resolve(cancelBody()).catch(() => {})
  }

  req.once('aborted', onDisconnect)
  res.once('close', onDisconnect)

  try {
    await streamResponseBody()
  } catch (error) {
    if (!disconnected && !res.destroyed) throw error
  } finally {
    req.off('aborted', onDisconnect)
    res.off('close', onDisconnect)
    if (cancellation) await cancellation
  }

  async function streamResponseBody () {
    if (typeof body[Symbol.asyncIterator] === 'function') {
      const iterator = body[Symbol.asyncIterator]()
      cancelBody = async () => {
        if (typeof iterator.return === 'function') await iterator.return()
        else await cancelResponseBody(body)
      }

      while (true) {
        if (disconnected) break
        const { done, value } = await iterator.next()
        if (done || disconnected) break
        await writeResponseChunk(res, value)
      }
      if (!disconnected && !res.destroyed) res.end()
      return
    }

    if (typeof body.getReader === 'function') {
      const reader = body.getReader()
      cancelBody = () => reader.cancel()
      try {
        while (true) {
          if (disconnected) break
          const { done, value } = await reader.read()
          if (done || disconnected) break
          await writeResponseChunk(res, value)
        }
      } finally {
        if (reader.releaseLock) reader.releaseLock()
      }
      if (!disconnected && !res.destroyed) res.end()
      return
    }

    await writeEventedBody(res, body)
  }
}

function writeResponseChunk (res, chunk) {
  const bytes = chunkToUint8Array(chunk)
  if (bytes.byteLength < 1) return Promise.resolve()

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      res.off('drain', onDrain)
      res.off('error', onError)
      res.off('close', onClose)
      if (error) reject(error)
      else resolve()
    }
    const onDrain = () => finish()
    const onError = (error) => finish(error)
    const onClose = () => finish(new Error('Media client disconnected'))

    res.once('drain', onDrain)
    res.once('error', onError)
    res.once('close', onClose)

    try {
      if (res.write(bytes)) finish()
    } catch (error) {
      finish(error)
    }
  })
}

function writeEventedBody (res, body) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      body.off('data', onData)
      body.off('end', onEnd)
      body.off('error', onError)
      res.off('drain', onDrain)
      res.off('close', onClose)
      if (error) reject(error)
      else resolve()
    }
    const onData = (chunk) => {
      try {
        if (!res.write(chunkToUint8Array(chunk)) && typeof body.pause === 'function') body.pause()
      } catch (error) {
        finish(error)
      }
    }
    const onDrain = () => {
      if (typeof body.resume === 'function') body.resume()
    }
    const onEnd = () => {
      if (!res.destroyed) res.end()
      finish()
    }
    const onError = (error) => finish(error)
    const onClose = () => finish()

    body.on('data', onData)
    body.on('end', onEnd)
    body.on('error', onError)
    res.on('drain', onDrain)
    res.on('close', onClose)
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
    // Passing a late stream error through Bare's native HTTP callback can abort
    // the JS worklet. Closing the incomplete response is enough for the client.
    res.destroy()
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
