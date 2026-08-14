import b4a from 'b4a'

export const MAX_INLINE_ASSETS = 32
export const MAX_INLINE_ASSET_BYTES = 2 * 1024 * 1024
export const MAX_INLINE_STYLESHEET_BYTES = 4 * 1024 * 1024
export const MAX_INLINE_ASSET_TOTAL_BYTES = 8 * 1024 * 1024
const INLINE_ASSET_CONCURRENCY = 4
const MAX_DOWNLOAD_FILENAME_BYTES = 255

export function headersToObject (headers) {
  const result = {}

  if (!headers) return result

  if (typeof headers[Symbol.iterator] === 'function') {
    for (const [key, value] of headers) {
      result[String(key).toLowerCase()] = String(value)
    }
    return result
  }

  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      result[key.toLowerCase()] = value
    })
    return result
  }

  return result
}

export function resolveHyperAssetUrl (source, baseUrl) {
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

export function shouldInlineAsset (source, assetUrl) {
  const value = `${source} ${assetUrl}`.toLowerCase()
  return /\.(?:avif|bmp|gif|ico|jpeg|jpg|js|mjs|png|svg|webp|css)(?:[?#].*)?$/.test(value)
}

export function shouldProxyMediaAsset (source, assetUrl) {
  const value = `${source} ${assetUrl}`.toLowerCase()
  return /\.(?:m4a|mov|mp3|mp4|oga|ogg|ogv|opus|wav|webm)(?:[?#].*)?$/.test(value)
}

export function getInlineAssetByteLimit (assetUrl, contentType) {
  if (isStylesheetAsset(assetUrl, contentType)) return MAX_INLINE_STYLESHEET_BYTES
  return MAX_INLINE_ASSET_BYTES
}

export function isStylesheetAsset (assetUrl, contentType) {
  if (String(contentType || '').toLowerCase().includes('text/css')) return true

  try {
    return new URL(assetUrl).pathname.toLowerCase().endsWith('.css')
  } catch {
    return String(assetUrl || '').toLowerCase().split(/[?#]/, 1)[0].endsWith('.css')
  }
}

export async function inlineHyperAssets ({
  html,
  baseUrl,
  fetch,
  assetBaseUrl,
  assetAuthToken,
  maxTotalBytes = MAX_INLINE_ASSET_TOTAL_BYTES,
  concurrency = INLINE_ASSET_CONCURRENCY
}) {
  const rewrittenDownloads = rewriteHyperDownloadAttributes(html, baseUrl, assetBaseUrl, assetAuthToken)
  const replacements = new Map()
  let totalBytes = 0
  const assetRefs = [...findHyperAssetRefs(rewrittenDownloads, baseUrl)]
    .slice(0, MAX_INLINE_ASSETS)

  await runConcurrent(assetRefs, concurrency, async ([source, assetUrl]) => {
    const asset = await fetchAsDataUrl(fetch, assetUrl)
    if (!asset || totalBytes + asset.byteLength > maxTotalBytes) return

    totalBytes += asset.byteLength
    replacements.set(source, asset.dataUrl)
  })

  return rewriteHyperMediaAttributes(
    rewriteHyperAssetAttributes(rewrittenDownloads, baseUrl, replacements),
    baseUrl,
    assetBaseUrl,
    assetAuthToken
  )
}

export function rewriteHyperAssetAttributes (html, baseUrl, replacements) {
  return html.replace(
    /\b(src|href|poster)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
    (match, name, separator, doubleQuoted, singleQuoted, unquoted) => {
      const source = doubleQuoted ?? singleQuoted ?? unquoted
      const assetUrl = resolveHyperAssetUrl(source, baseUrl)
      const dataUrl = assetUrl ? replacements.get(source) : null
      if (!dataUrl) return match
      const quote = singleQuoted !== undefined ? "'" : '"'
      return `${name}${separator}${quote}${dataUrl}${quote}`
    }
  )
}

export function rewriteHyperMediaAttributes (html, baseUrl, assetBaseUrl, authToken) {
  return html.replace(
    /\b(src|href)(\s*=\s*)(["'])([^"']+)\3/gi,
    (match, name, separator, quote, source) => {
      const assetUrl = resolveHyperAssetUrl(source, baseUrl)
      if (!assetUrl || !shouldProxyMediaAsset(source, assetUrl)) return match
      return `${name}${separator}${quote}${createProxyAssetUrl(assetBaseUrl, assetUrl, authToken)}${quote}`
    }
  )
}

export function rewriteHyperDownloadAttributes (html, baseUrl, assetBaseUrl, authToken) {
  return html.replace(/<a\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi, (tag) => {
    const attributes = parseHtmlTagAttributes(tag)
    const download = attributes.find(({ name }) => name === 'download')
    if (!download) return tag

    const href = attributes.find(({ name }) => name === 'href')
    if (!href || href.valueStart === null || href.valueEnd === null) return tag

    const assetUrl = resolveHyperAssetUrl(href.value, baseUrl)
    if (!assetUrl) return tag

    const proxyUrl = createProxyAssetUrl(assetBaseUrl, assetUrl, authToken, download.value)
    return `${tag.slice(0, href.valueStart)}${proxyUrl}${tag.slice(href.valueEnd)}`
  })
}

export function createProxyAssetUrl (assetBaseUrl, assetUrl, authToken, downloadName) {
  if (!authToken) throw new Error('Missing Hyper asset proxy token')
  const params = [
    `token=${encodeURIComponent(authToken)}`,
    `url=${encodeURIComponent(assetUrl)}`
  ]
  if (downloadName !== undefined) {
    params.push('download=1')
    if (downloadName) params.push(`name=${encodeURIComponent(downloadName)}`)
  }
  return `${assetBaseUrl}/asset?${params.join('&')}`
}

export function normalizeDownloadFilename (name, assetUrl) {
  const fallback = (() => {
    try {
      return new URL(assetUrl).pathname.split('/').pop()
    } catch {
      return ''
    }
  })()
  const value = Array.from(String(name || fallback || 'download'))
    .map((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint < 32 ||
        codePoint === 127 ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069) ||
        '"\\/'.includes(character)
        ? '_'
        : character
    })
    .join('')
    .trim()

  return truncateUtf8(value || 'download', MAX_DOWNLOAD_FILENAME_BYTES)
}

export function createDownloadContentDisposition (name, assetUrl) {
  const normalized = normalizeDownloadFilename(name, assetUrl)
  const asciiFallback = Array.from(normalized)
    .map((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint >= 32 && codePoint <= 126 ? character : '_'
    })
    .join('')
    .trim() || 'download'
  const encoded = encodeURIComponent(normalized)
    .replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}

export function isMalformedRangeHeader (rangeHeader) {
  if (!rangeHeader) return false
  return !/^bytes=(?:\d+-\d*|\d*-\d+)$/.test(String(rangeHeader))
}

export function getContentTypeFromUrl (url) {
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
  if (pathname.endsWith('.m4a')) return 'audio/mp4'
  if (pathname.endsWith('.mov')) return 'video/quicktime'
  if (pathname.endsWith('.mp3')) return 'audio/mpeg'
  if (pathname.endsWith('.mp4')) return 'video/mp4'
  if (pathname.endsWith('.oga') || pathname.endsWith('.ogg') || pathname.endsWith('.opus')) return 'audio/ogg'
  if (pathname.endsWith('.ogv')) return 'video/ogg'
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.wav')) return 'audio/wav'
  if (pathname.endsWith('.webm')) return 'video/webm'
  if (pathname.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

function truncateUtf8 (value, limit) {
  let result = ''
  let byteLength = 0

  for (const character of Array.from(value)) {
    const characterBytes = b4a.byteLength(character)
    if (byteLength + characterBytes > limit) break
    result += character
    byteLength += characterBytes
  }

  return result || 'download'
}

function findHyperAssetRefs (html, baseUrl) {
  const refs = new Map()
  const attributes = /\b(?:src|href|poster)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/gi
  let match = attributes.exec(html)

  while (match) {
    const original = match[1] ?? match[2] ?? match[3]
    const assetUrl = resolveHyperAssetUrl(original, baseUrl)

    if (assetUrl && shouldInlineAsset(original, assetUrl)) {
      refs.set(original, assetUrl)
    }

    match = attributes.exec(html)
  }

  return refs
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

    const bytes = toAssetBytes(await response.arrayBuffer())
    if (bytes.byteLength > byteLimit) return null

    return {
      dataUrl: `data:${contentType};base64,${b4a.toString(bytes, 'base64')}`,
      byteLength: bytes.byteLength
    }
  } catch {
    return null
  }
}

async function runConcurrent (items, concurrency, task) {
  let nextIndex = 0
  const boundedConcurrency = Math.max(1, Math.floor(Number(concurrency) || 1))
  const workerCount = Math.min(boundedConcurrency, items.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await task(item)
    }
  })

  await Promise.all(workers)
}

function toAssetBytes (bytes) {
  if (bytes instanceof Uint8Array) return bytes
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
  return b4a.from(bytes)
}

function parseHtmlTagAttributes (tag) {
  const attributes = []
  let cursor = 2

  while (cursor < tag.length) {
    while (/\s/.test(tag[cursor])) cursor += 1
    if (tag[cursor] === '>' || tag[cursor] === '/') break

    const nameStart = cursor
    while (cursor < tag.length && !/[\s=/>]/.test(tag[cursor])) cursor += 1
    if (cursor === nameStart) {
      cursor += 1
      continue
    }

    const name = tag.slice(nameStart, cursor).toLowerCase()
    while (/\s/.test(tag[cursor])) cursor += 1

    let value = ''
    let valueStart = null
    let valueEnd = null

    if (tag[cursor] === '=') {
      cursor += 1
      while (/\s/.test(tag[cursor])) cursor += 1

      const quote = tag[cursor] === '"' || tag[cursor] === "'"
        ? tag[cursor++]
        : null
      valueStart = cursor

      if (quote) {
        while (cursor < tag.length && tag[cursor] !== quote) cursor += 1
      } else {
        while (cursor < tag.length && !/[\s>]/.test(tag[cursor])) cursor += 1
      }

      valueEnd = cursor
      value = tag.slice(valueStart, valueEnd)
      if (quote && tag[cursor] === quote) cursor += 1
    }

    attributes.push({ name, value, valueStart, valueEnd })
  }

  return attributes
}
