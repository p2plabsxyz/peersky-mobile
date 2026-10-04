import { createHmac } from 'node:crypto'
import b4a from 'b4a'

export const MAX_INLINE_ASSETS = 32
export const MAX_INLINE_ASSET_BYTES = 2 * 1024 * 1024
export const MAX_INLINE_STYLESHEET_BYTES = 4 * 1024 * 1024
export const MAX_INLINE_ASSET_TOTAL_BYTES = 8 * 1024 * 1024
export const MAX_INLINE_CSS_IMPORT_DEPTH = 4
const INLINE_ASSET_CONCURRENCY = 4
const MAX_DOWNLOAD_FILENAME_BYTES = 255
const HYPER_DOWNLOAD_EXTENSION = /[.](?:7z|aab|apk|bin|bz2|deb|dmg|docx?|exe|gz|iso|jar|msi|pdf|rar|rpm|tar|tgz|xlsx?|zip)(?:$|[?#])/i
const HYPER_DOWNLOAD_CONTENT_TYPE = /^(?:application\/(?:epub[+]zip|gzip|java-archive|msword|octet-stream|pdf|vnd[.]android[.]package-archive|vnd[.]ms-excel|vnd[.]openxmlformats-officedocument(?:[.][a-z0-9+_-]+)+|x-7z-compressed|x-bzip2|x-rar-compressed|x-tar|x-zip-compressed|zip)|application\/x-msdownload)$/i
const HYPER_MEDIA_EXTENSION = {
  image: /[.](?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:$|[?#])/i,
  audio: /[.](?:aac|amr|flac|m4a|mp3|oga|ogg|opus|wav|weba)(?:$|[?#])/i,
  video: /[.](?:3g2|3gp|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm)(?:$|[?#])/i
}

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
  const context = createInlineAssetContext(fetch, maxTotalBytes)
  const assetRefs = [...findHyperAssetRefs(rewrittenDownloads, baseUrl)]
    .slice(0, MAX_INLINE_ASSETS)

  await runConcurrent(assetRefs, concurrency, async ([source, assetUrl]) => {
    const dataUrl = isStylesheetAsset(assetUrl)
      ? await context.fetchStylesheet(assetUrl)
      : await context.fetchAsset(assetUrl)
    if (dataUrl) replacements.set(source, dataUrl)
  })

  const rewrittenStyles = await rewriteInlineStyleBlocks(
    rewriteHyperAssetAttributes(rewrittenDownloads, baseUrl, replacements),
    baseUrl,
    context
  )

  return rewriteHyperMediaAttributes(
    rewrittenStyles,
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

/**
 * The asset server's secret never reaches a page. Each link carries a
 * signature over its own address instead, so a page can fetch what it was
 * handed and nothing else: not another drive, and not a private one.
 */
export function signHyperAssetUrl (secret, assetUrl) {
  return createHmac('sha256', String(secret)).update(String(assetUrl)).digest('hex')
}

export function createProxyAssetUrl (assetBaseUrl, assetUrl, authToken, downloadName) {
  if (!authToken) throw new Error('Missing Hyper asset proxy token')
  const params = [
    `token=${signHyperAssetUrl(authToken, assetUrl)}`,
    `url=${encodeURIComponent(assetUrl)}`
  ]
  if (downloadName !== undefined) {
    params.push('download=1')
    if (downloadName) params.push(`name=${encodeURIComponent(downloadName)}`)
  }
  return `${assetBaseUrl}/asset?${params.join('&')}`
}

export function getHyperNavigationDownloadName (assetUrl, headers = {}) {
  const contentDisposition = String(headers['content-disposition'] || '')
  const contentType = String(headers['content-type'] || '')
    .split(';', 1)[0]
    .trim()

  if (/\battachment\b/i.test(contentDisposition)) {
    return normalizeDownloadFilename(
      getContentDispositionFilename(contentDisposition),
      assetUrl
    )
  }

  if (
    !HYPER_DOWNLOAD_EXTENSION.test(assetUrl) &&
    !HYPER_DOWNLOAD_CONTENT_TYPE.test(contentType)
  ) {
    return null
  }

  return normalizeDownloadFilename(null, assetUrl)
}

export function getHyperNavigationMediaType (assetUrl, headers = {}) {
  const contentDisposition = String(headers['content-disposition'] || '')
  if (/\battachment\b/i.test(contentDisposition)) return null

  const contentType = String(headers['content-type'] || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()

  for (const [mediaType, pattern] of Object.entries(HYPER_MEDIA_EXTENSION)) {
    if (pattern.test(assetUrl) || contentType.startsWith(`${mediaType}/`)) {
      return mediaType
    }
  }

  return null
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

function getContentDispositionFilename (contentDisposition) {
  const encoded = contentDisposition.match(/filename[*]\s*=\s*(?:UTF-8'')?([^;]+)/i)
  if (encoded) {
    const value = encoded[1].trim().replace(/^['"]|['"]$/g, '')
    try {
      return decodeURIComponent(value)
    } catch {}
  }

  const plain = contentDisposition.match(/filename\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;]+))/i)
  return plain ? (plain[1] ?? plain[2] ?? plain[3]).trim() : ''
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
  if (pathname.endsWith('.aac')) return 'audio/aac'
  if (pathname.endsWith('.amr')) return 'audio/amr'
  if (pathname.endsWith('.bmp')) return 'image/bmp'
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8'
  if (pathname.endsWith('.gif')) return 'image/gif'
  if (pathname.endsWith('.flac')) return 'audio/flac'
  if (pathname.endsWith('.ico')) return 'image/x-icon'
  if (pathname.endsWith('.jpeg') || pathname.endsWith('.jpg')) return 'image/jpeg'
  if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) return 'text/javascript; charset=utf-8'
  if (pathname.endsWith('.m4a')) return 'audio/mp4'
  if (pathname.endsWith('.m4v')) return 'video/mp4'
  if (pathname.endsWith('.mov')) return 'video/quicktime'
  if (pathname.endsWith('.mkv')) return 'video/x-matroska'
  if (pathname.endsWith('.mp3')) return 'audio/mpeg'
  if (pathname.endsWith('.mp4')) return 'video/mp4'
  if (pathname.endsWith('.mpeg') || pathname.endsWith('.mpg')) return 'video/mpeg'
  if (pathname.endsWith('.oga') || pathname.endsWith('.ogg') || pathname.endsWith('.opus')) return 'audio/ogg'
  if (pathname.endsWith('.ogv')) return 'video/ogg'
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.wav')) return 'audio/wav'
  if (pathname.endsWith('.webm')) return 'video/webm'
  if (pathname.endsWith('.weba')) return 'audio/webm'
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

function createInlineAssetContext (fetch, maxTotalBytes) {
  const cache = new Map()
  let totalBytes = 0
  let requestCount = 0

  const fetchOnce = (assetUrl, stylesheet, depth = 0, ancestors = new Set()) => {
    if (stylesheet && ancestors.has(assetUrl)) return Promise.resolve(emptyStylesheetDataUrl())

    const cacheKey = `${stylesheet ? 'css' : 'asset'}:${assetUrl}`
    const cached = cache.get(cacheKey)
    if (cached) return cached
    if (requestCount >= MAX_INLINE_ASSETS) return Promise.resolve(null)
    requestCount += 1

    const pending = (async () => {
      const asset = await fetchAsset(fetch, assetUrl, stylesheet)
      if (!asset || totalBytes + asset.byteLength > maxTotalBytes) return null
      totalBytes += asset.byteLength

      if (!stylesheet) return asset.dataUrl
      const nextAncestors = new Set(ancestors)
      nextAncestors.add(assetUrl)
      const css = await rewriteHyperCss(asset.text, assetUrl, {
        depth,
        ancestors: nextAncestors,
        fetchAsset: (url) => fetchOnce(url, false),
        fetchStylesheet: (url) => fetchOnce(url, true, depth + 1, nextAncestors)
      })
      return stylesheetDataUrl(css)
    })()

    cache.set(cacheKey, pending)
    return pending
  }

  return {
    fetchAsset: (assetUrl) => fetchOnce(assetUrl, false),
    fetchStylesheet: (assetUrl) => fetchOnce(assetUrl, true),
    rewriteCss: (css, cssBaseUrl) => rewriteHyperCss(css, cssBaseUrl, {
      depth: 0,
      ancestors: new Set(),
      fetchAsset: (url) => fetchOnce(url, false),
      fetchStylesheet: (url) => fetchOnce(url, true, 1, new Set())
    })
  }
}

async function fetchAsset (fetch, assetUrl, stylesheet = false) {
  try {
    const response = await fetch(assetUrl)
    if (!response.ok) return null

    const headers = headersToObject(response.headers)
    const contentType = normalizeInlineContentType(headers['content-type'], assetUrl)
    const byteLimit = stylesheet
      ? MAX_INLINE_STYLESHEET_BYTES
      : getInlineAssetByteLimit(assetUrl, contentType)
    const contentLength = Number(headers['content-length'])
    if (Number.isFinite(contentLength) && contentLength > byteLimit) return null

    const bytes = toAssetBytes(await response.arrayBuffer())
    if (bytes.byteLength > byteLimit) return null

    return {
      dataUrl: `data:${contentType};base64,${b4a.toString(bytes, 'base64')}`,
      text: stylesheet ? b4a.toString(bytes) : null,
      byteLength: bytes.byteLength
    }
  } catch {
    return null
  }
}

function normalizeInlineContentType (contentType, assetUrl) {
  const value = String(contentType || '').split(';', 1)[0].trim().toLowerCase()
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(value)
    ? value
    : getContentTypeFromUrl(assetUrl).split(';', 1)[0]
}

async function rewriteInlineStyleBlocks (html, baseUrl, context) {
  return asyncReplace(
    html,
    /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    async (match, open, css, close) => `${open}${await context.rewriteCss(css, baseUrl)}${close}`
  )
}

async function rewriteHyperCss (css, baseUrl, context) {
  const comments = []
  let commentMarker = '__PEERSKY_CSS_COMMENT_'
  while (String(css || '').includes(commentMarker)) commentMarker += '_'
  let rewritten = String(css || '').replace(/\/\*[\s\S]*?\*\//g, (comment) => {
    const marker = `${commentMarker}${comments.length}__`
    comments.push(comment)
    return marker
  })

  if (context.depth < MAX_INLINE_CSS_IMPORT_DEPTH) {
    rewritten = await asyncReplace(
      rewritten,
      /(@import\s+url\(\s*)(["']?)([^"')\s]+)\2(\s*\))/gi,
      async (match, prefix, quote, source, suffix) => {
        const assetUrl = resolveHyperAssetUrl(source, baseUrl)
        if (!assetUrl) return match
        const dataUrl = await context.fetchStylesheet(assetUrl)
        return dataUrl ? `${prefix}"${dataUrl}"${suffix}` : match
      }
    )
    rewritten = await asyncReplace(
      rewritten,
      /(@import\s+)(["'])([^"']+)\2/gi,
      async (match, prefix, quote, source) => {
        const assetUrl = resolveHyperAssetUrl(source, baseUrl)
        if (!assetUrl) return match
        const dataUrl = await context.fetchStylesheet(assetUrl)
        return dataUrl ? `${prefix}"${dataUrl}"` : match
      }
    )
  }

  const imports = []
  let importMarker = '__PEERSKY_CSS_IMPORT_'
  while (rewritten.includes(importMarker)) importMarker += '_'
  rewritten = rewritten.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/gi, (statement) => {
    const marker = `${importMarker}${imports.length}__`
    imports.push(statement)
    return marker
  })

  rewritten = await asyncReplace(
    rewritten,
    /(url\(\s*)(["']?)([^"')]+?)\2(\s*\))/gi,
    async (match, prefix, quote, source, suffix) => {
      const assetUrl = resolveHyperAssetUrl(source, baseUrl)
      if (!assetUrl) return match
      const dataUrl = await context.fetchAsset(assetUrl)
      return dataUrl ? `${prefix}"${dataUrl}"${suffix}` : match
    }
  )

  for (let index = 0; index < imports.length; index++) {
    rewritten = rewritten.split(`${importMarker}${index}__`).join(imports[index])
  }
  for (let index = 0; index < comments.length; index++) {
    rewritten = rewritten.split(`${commentMarker}${index}__`).join(comments[index])
  }
  return rewritten
}

function stylesheetDataUrl (css) {
  return `data:text/css;charset=utf-8;base64,${b4a.toString(b4a.from(css), 'base64')}`
}

function emptyStylesheetDataUrl () {
  return 'data:text/css;charset=utf-8;base64,'
}

async function asyncReplace (value, pattern, replacer) {
  const matches = []
  for (const match of value.matchAll(pattern)) {
    matches.push(match)
    if (matches.length >= MAX_INLINE_ASSETS) break
  }
  if (matches.length === 0) return value

  const replacements = await Promise.all(matches.map((match) => replacer(...match)))
  let result = ''
  let cursor = 0
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index]
    result += value.slice(cursor, match.index) + replacements[index]
    cursor = match.index + match[0].length
  }
  return result + value.slice(cursor)
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
