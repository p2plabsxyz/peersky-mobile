import b4a from 'b4a'
import MarkdownIt from 'markdown-it'
import { getHyperRuntime } from './runtime.mjs'
import { parseHyperUrl } from './url.mjs'

const MAX_HYPER_FILE_BYTES = 10 * 1024 * 1024
const MAX_HYPER_IMAGE_BYTES = 5 * 1024 * 1024
const HYPER_READ_TIMEOUT_MS = 15000
const P2PMD_DRIVE_NAME = 'p2pmd'
const IMAGE_UPLOAD_WINDOW_MS = 60 * 1000
const MAX_IMAGE_UPLOADS_PER_WINDOW = 5
const MAX_IMAGE_UPLOAD_BYTES_PER_WINDOW = 10 * 1024 * 1024
const IMAGE_EXTENSIONS = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
}
const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})
let nextAssetId = 0
let publishTransition = Promise.resolve()
let imageUploadWindowStartedAt = 0
let imageUploadCount = 0
let imageUploadBytes = 0

export async function createDrive ({ name } = {}) {
  const runtime = await getHyperRuntime()
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  const isValidName = /^[A-Za-z0-9_-]+$/.test(trimmedName)
  const driveName = isValidName ? trimmedName : `drive-${Date.now()}`

  const drive = await runtime.getDrive(driveName)
  const indexPath = '/index.html'
  const hasIndex = await drive.exists(indexPath)

  if (!hasIndex) {
    const html = `<!doctype html>
<meta charset="utf-8" />
<title>PeerSky Mobile Hyperdrive</title>
<h1>PeerSky Mobile Hyperdrive</h1>
<p>This drive was created from the mobile Bare worklet.</p>
`
    await drive.put(indexPath, b4a.from(html))
  }

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url: `hyper://${drive.id}/`
  }
}

export async function uploadHyperFile ({
  name,
  contentBase64
} = {}) {
  if (typeof contentBase64 !== 'string' || !contentBase64) {
    return {
      ok: false,
      error: 'Missing file content.'
    }
  }

  const content = decodeBase64Content(contentBase64)
  if (!content.ok) return content

  const contentType = detectImageContentType(content.bytes)
  if (!contentType) {
    return {
      ok: false,
      error: 'Unsupported image format. Use PNG, JPEG, WebP, or GIF.'
    }
  }

  const budget = reserveImageUploadBudget(content.bytes.byteLength)
  if (!budget.ok) return budget

  const filename = normalizeImageFilename(name, contentType)
  const runtime = await getHyperRuntime()
  const drive = await runtime.getDrive(P2PMD_DRIVE_NAME)
  const pathname = createAssetPath(filename)

  await drive.put(pathname, content.bytes)

  return {
    ok: true,
    url: `hyper://${drive.id}${pathname}`,
    name: filename
  }
}

export async function publishMarkdownDocument ({ content } = {}) {
  if (typeof content !== 'string') {
    return {
      ok: false,
      error: 'Invalid Markdown content. Expected a string.'
    }
  }

  const markdown = b4a.from(content)
  if (markdown.byteLength > MAX_HYPER_FILE_BYTES) {
    return {
      ok: false,
      error: 'Markdown is too large. Maximum size is 10 MB.'
    }
  }

  return withPublishTransition(async () => {
    const runtime = await getHyperRuntime()
    const drive = await runtime.getDrive(P2PMD_DRIVE_NAME)

    await drive.put('/index.html', b4a.from(createPublishedNoteHtml(content)))

    return {
      ok: true,
      url: `hyper://${drive.id}/`
    }
  })
}

export async function readHyperFile ({ url } = {}) {
  const target = parseHyperUrl(url)
  if (target.error) return { ok: false, status: 400, error: target.error }

  if (target.pathname === '/' || target.pathname.endsWith('/')) {
    return {
      ok: false,
      status: 400,
      error: 'Expected a file path.'
    }
  }

  try {
    const runtime = await getHyperRuntime()
    const drive = await runtime.getDrive(target.driveAddress)
    const entry = await drive.entry(target.pathname, { timeout: HYPER_READ_TIMEOUT_MS })

    if (!entry?.value.blob) {
      return {
        ok: false,
        status: 404,
        error: `No file found at ${target.pathname}`
      }
    }

    if (entry.value.blob.byteLength < 1 || entry.value.blob.byteLength > MAX_HYPER_FILE_BYTES) {
      return {
        ok: false,
        status: 413,
        error: 'Invalid image size. Maximum size is 10 MB.'
      }
    }

    const file = await drive.get(target.pathname, { timeout: HYPER_READ_TIMEOUT_MS })
    if (!file) {
      return {
        ok: false,
        status: 404,
        error: `No file found at ${target.pathname}`
      }
    }

    const contentType = detectImageContentType(file)
    if (!contentType) {
      return {
        ok: false,
        status: 415,
        error: 'Unsupported image format.'
      }
    }

    return {
      ok: true,
      status: 200,
      bytes: file,
      contentType
    }
  } catch (error) {
    return {
      ok: false,
      status: 504,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function decodeBase64Content (contentBase64) {
  let bytes

  try {
    bytes = b4a.from(contentBase64, 'base64')
  } catch {
    return {
      ok: false,
      error: 'Invalid file content encoding.'
    }
  }

  if (bytes.byteLength < 1 || bytes.byteLength > MAX_HYPER_IMAGE_BYTES) {
    return {
      ok: false,
      error: 'Invalid image size. Maximum size is 5 MB.'
    }
  }

  return {
    ok: true,
    bytes
  }
}

function reserveImageUploadBudget (byteLength) {
  const now = Date.now()

  if (now - imageUploadWindowStartedAt > IMAGE_UPLOAD_WINDOW_MS) {
    imageUploadWindowStartedAt = now
    imageUploadCount = 0
    imageUploadBytes = 0
  }

  if (
    imageUploadCount + 1 > MAX_IMAGE_UPLOADS_PER_WINDOW ||
    imageUploadBytes + byteLength > MAX_IMAGE_UPLOAD_BYTES_PER_WINDOW
  ) {
    return {
      ok: false,
      error: 'Image upload rate limit exceeded. Try again later.'
    }
  }

  imageUploadCount += 1
  imageUploadBytes += byteLength

  return { ok: true }
}

function normalizeFilename (name, fallback) {
  const value = typeof name === 'string' ? name.trim() : ''
  const normalized = value
    .replace(/[/\\]/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 120)

  return normalized || fallback
}

function normalizeImageFilename (name, contentType) {
  const extension = IMAGE_EXTENSIONS[contentType]
  const filename = normalizeFilename(name, `image${extension}`)
  const basename = filename.replace(/[.][A-Za-z0-9]+$/, '') || 'image'
  return `${basename}${extension}`
}

function createAssetPath (filename) {
  nextAssetId = (nextAssetId + 1) % Number.MAX_SAFE_INTEGER
  return `/assets/${Date.now()}-${nextAssetId}-${filename}`
}

function detectImageContentType (bytes) {
  if (hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (hasBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (hasAscii(bytes, 0, 'GIF87a') || hasAscii(bytes, 0, 'GIF89a')) return 'image/gif'
  if (hasAscii(bytes, 0, 'RIFF') && hasAscii(bytes, 8, 'WEBP')) return 'image/webp'
  return null
}

function hasBytes (bytes, expected) {
  if (bytes.byteLength < expected.length) return false
  return expected.every((value, index) => bytes[index] === value)
}

function hasAscii (bytes, offset, expected) {
  if (bytes.byteLength < offset + expected.length) return false

  for (let index = 0; index < expected.length; index++) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) return false
  }

  return true
}

function createPublishedNoteHtml (content) {
  const rendered = markdownRenderer.render(content)

  return `<!doctype html>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>P2PMD Note</title>
<style>
  body {
    background: #ffffff;
    color: #111111;
    font-family: sans-serif;
    line-height: 1.5;
    margin: 0;
    padding: 32px 38px;
  }
  img {
    display: block;
    height: auto;
    margin: 16px 0;
    max-width: 100%;
  }
  code {
    background: #f2f2f2;
    border-radius: 4px;
    padding: 2px 4px;
  }
  pre {
    background: #f7f7f7;
    border-radius: 8px;
    overflow: auto;
    padding: 14px;
  }
  pre code {
    background: transparent;
    padding: 0;
  }
</style>
${rendered}
`
}

async function withPublishTransition (operation) {
  const previousTransition = publishTransition
  let release

  publishTransition = new Promise((resolve) => {
    release = resolve
  })

  await previousTransition

  try {
    return await operation()
  } finally {
    release()
  }
}
