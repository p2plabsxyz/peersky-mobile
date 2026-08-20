import b4a from 'b4a'
import { withHyperRuntimeOperation } from './runtime.mjs'
import { parseHyperUrl } from './url.mjs'
import { splitMarkdownSlides } from '../p2pmd/preview.mjs'
import ieeeBrowserScript from '../p2pmd/ieee-runtime.mjs'
import katexCss from '../p2pmd/katex-runtime.mjs'
import {
  createP2pmdMarkdownRenderer,
  P2PMD_SCIENTIFIC_STYLES,
  renderP2pmdMarkdown
} from '../p2pmd/scientific.mjs'
import { hasIeeeMarker } from '../p2pmd/templates.mjs'
import { resolveHyperdriveAppDriveName } from './storage-core.mjs'

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
const markdownRenderer = createP2pmdMarkdownRenderer()
let nextAssetId = 0
let publishTransition = Promise.resolve()
let imageUploadWindowStartedAt = 0
let imageUploadCount = 0
let imageUploadBytes = 0

export async function createDrive ({ name } = {}) {
  return withHyperRuntimeOperation(async (runtime) => {
    const driveName = resolveHyperdriveAppDriveName(name)

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
  })
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
  return withHyperRuntimeOperation(async (runtime) => {
    const drive = await runtime.getDrive(P2PMD_DRIVE_NAME)
    const pathname = createAssetPath(filename)

    await drive.put(pathname, content.bytes)

    return {
      ok: true,
      url: `hyper://${drive.id}${pathname}`,
      name: filename
    }
  })
}

export async function publishMarkdownDocument ({ content, mode, latexModeEnabled } = {}) {
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
    let html
    try {
      html = mode === 'slides'
        ? createPublishedSlidesHtml(content)
        : createPublishedNoteHtml(content, latexModeEnabled === true)
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }

    const published = b4a.from(html)
    if (published.byteLength > MAX_HYPER_FILE_BYTES) {
      return {
        ok: false,
        error: 'Published document is too large. Maximum size is 10 MB.'
      }
    }

    return withHyperRuntimeOperation(async (runtime) => {
      const drive = await runtime.getDrive(P2PMD_DRIVE_NAME)

      await drive.put('/index.html', published)

      return {
        ok: true,
        url: `hyper://${drive.id}/`
      }
    })
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
    return await withHyperRuntimeOperation(async (runtime) => {
      const drive = await runtime.getDrive(P2PMD_DRIVE_NAME)
      const driveAddress = 'hyper://' + drive.id + '/'

    if (target.driveAddress !== driveAddress) {
      return {
        ok: false,
        status: 403,
        error: 'Only P2PMD drive images can be proxied.'
      }
    }

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
    })
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

export function createPublishedNoteHtml (content, latexModeEnabled) {
  const rendered = renderP2pmdMarkdown(markdownRenderer, content)
  const ieee = latexModeEnabled && hasIeeeMarker(content)
  const ieeeScript = ieee
    ? `<script>${ieeeBrowserScript}
const note = document.getElementById('note')
window.P2pmdIeee.render(note, note.innerHTML)
</script>`
    : ''
  const scriptPolicy = ieee ? " script-src 'unsafe-inline';" : ''

  return `<!doctype html>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src hyper: https: data:;${scriptPolicy}" />
<title>P2PMD Note</title>
<style>
  ${katexCss}
  ${P2PMD_SCIENTIFIC_STYLES}
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
<main id="note">${rendered}</main>
${ieeeScript}
`
}

export function createPublishedSlidesHtml (content) {
  const slideContents = splitMarkdownSlides(content)
  const slides = (slideContents.length > 0 ? slideContents : [''])
    .map((slide, index) => {
      const rendered = renderP2pmdMarkdown(markdownRenderer, slide)
      return `<section class="slide${index === 0 ? ' active' : ''}" aria-hidden="${index !== 0}">${rendered}</section>`
    })
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src hyper: data:; media-src hyper: data:;" />
  <title>P2PMD Slides</title>
  <style>
    ${katexCss}
    ${P2PMD_SCIENTIFIC_STYLES}
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { background: #f7f7f5; color: #202124; font-family: sans-serif; }
    #deck { width: 100%; height: 100%; touch-action: pan-y; }
    .slide {
      display: none;
      width: 100%;
      height: 100%;
      padding: clamp(28px, 7vw, 72px) clamp(56px, 11vw, 110px);
      overflow: auto;
      text-align: center;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      animation: enter 180ms ease-out;
    }
    .slide.active { display: flex; }
    .slide > * { max-width: min(100%, 1000px); }
    .slide > :first-child { margin-top: auto; }
    .slide > :last-child { margin-bottom: auto; }
    h1 { margin: 0 0 .65em; font-size: clamp(2rem, 8vw, 4.5rem); line-height: 1.08; }
    h2 { margin: 0 0 .65em; font-size: clamp(1.65rem, 6.5vw, 3.5rem); line-height: 1.12; }
    h3 { font-size: clamp(1.35rem, 5vw, 2.5rem); }
    p, ul, ol { font-size: clamp(1rem, 3.7vw, 1.6rem); line-height: 1.55; }
    ul, ol, blockquote, pre { text-align: left; }
    pre { width: min(100%, 920px); padding: 14px; border-radius: 9px; background: #202128; color: #f1f2f7; overflow: auto; }
    code { font-family: ui-monospace, monospace; }
    :not(pre) > code { padding: .12em .32em; border-radius: 5px; background: #e4e7ec; }
    blockquote { padding-left: 14px; border-left: 4px solid #2f80ed; }
    img, video { display: block; max-width: 100%; max-height: 54vh; margin: .75rem auto; object-fit: contain; }
    .nav {
      position: fixed;
      top: 50%;
      z-index: 2;
      display: grid;
      width: 44px;
      height: 44px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: rgba(32, 33, 36, .12);
      color: #202124;
      font-size: 28px;
      place-items: center;
      transform: translateY(-50%);
    }
    .nav:disabled { opacity: .28; }
    #prev { left: 6px; }
    #next { right: 6px; }
    #counter { position: fixed; right: 10px; bottom: 12px; padding: 5px 9px; border-radius: 999px; background: rgba(32, 33, 36, .1); font-size: 12px; font-weight: 700; }
    #progress { position: fixed; right: 0; bottom: 0; left: 0; height: 4px; background: rgba(32, 33, 36, .12); }
    #progress-value { display: block; width: 0; height: 100%; background: #2f80ed; transition: width 180ms ease-out; }
    @keyframes enter { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
    @media (orientation: landscape) {
      .slide { overflow: visible; transform-origin: top center; animation: none; }
    }
    @media (orientation: landscape) and (max-height: 520px) {
      .slide { padding-top: 20px; padding-bottom: 24px; }
      img, video { max-height: 46vh; }
    }
    @media (prefers-reduced-motion: reduce) { .slide { animation: none; } #progress-value { transition: none; } }
  </style>
</head>
<body>
  <main id="deck">${slides}</main>
  <button id="prev" class="nav" type="button" aria-label="Previous slide">&#8249;</button>
  <button id="next" class="nav" type="button" aria-label="Next slide">&#8250;</button>
  <div id="counter" role="status" aria-live="polite"></div>
  <div id="progress" aria-hidden="true"><span id="progress-value"></span></div>
  <script>
    const slides = Array.from(document.querySelectorAll('.slide'))
    const previous = document.getElementById('prev')
    const next = document.getElementById('next')
    const counter = document.getElementById('counter')
    const progress = document.getElementById('progress-value')
    let current = 0
    let touchStart = null
    let fitFrame = null

    function show(index) {
      if (index < 0 || index >= slides.length) return
      current = index
      slides.forEach((slide, slideIndex) => {
        const active = slideIndex === current
        slide.classList.toggle('active', active)
        slide.setAttribute('aria-hidden', String(!active))
        slide.style.transform = ''
        if (active) slide.scrollTop = 0
      })
      previous.disabled = current === 0
      next.disabled = current === slides.length - 1
      counter.textContent = (current + 1) + ' / ' + slides.length
      progress.style.width = (((current + 1) / slides.length) * 100) + '%'
      scheduleFit()
    }

    function scheduleFit() {
      if (fitFrame) cancelAnimationFrame(fitFrame)
      fitFrame = requestAnimationFrame(() => {
        fitFrame = null
        fitActiveSlide()
      })
    }

    function fitActiveSlide() {
      const slide = slides[current]
      if (!slide) return

      slide.style.transform = ''
      if (!window.matchMedia('(orientation: landscape)').matches) return

      const availableWidth = document.documentElement.clientWidth
      const availableHeight = document.documentElement.clientHeight
      const contentWidth = Math.max(slide.clientWidth, slide.scrollWidth)
      const contentHeight = Math.max(slide.clientHeight, slide.scrollHeight)
      if (!availableWidth || !availableHeight || !contentWidth || !contentHeight) return

      const scale = Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight)
      if (scale < 1) slide.style.transform = 'scale(' + scale + ')'
    }

    previous.addEventListener('click', () => show(current - 1))
    next.addEventListener('click', () => show(current + 1))
    window.addEventListener('resize', scheduleFit)
    document.getElementById('deck').addEventListener('load', scheduleFit, true)
    document.getElementById('deck').addEventListener('loadedmetadata', scheduleFit, true)
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') show(current - 1)
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === ' ') {
        event.preventDefault()
        show(current + 1)
      } else if (event.key === 'Home') show(0)
      else if (event.key === 'End') show(slides.length - 1)
    })
    document.getElementById('deck').addEventListener('touchstart', (event) => {
      const touch = event.touches[0]
      if (touch) touchStart = { x: touch.clientX, y: touch.clientY }
    }, { passive: true })
    document.getElementById('deck').addEventListener('touchend', (event) => {
      const touch = event.changedTouches[0]
      const start = touchStart
      touchStart = null
      if (!touch || !start) return
      const deltaX = touch.clientX - start.x
      const deltaY = touch.clientY - start.y
      if (Math.abs(deltaX) >= 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
        show(current + (deltaX < 0 ? 1 : -1))
      }
    }, { passive: true })
    show(0)
  </script>
</body>
</html>`
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
