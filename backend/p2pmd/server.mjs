import http from 'bare-http1'
import MarkdownIt from 'markdown-it'
import {
  applyDocumentUpdate,
  getEncodedDocumentState,
  getDocumentState,
  getMaxDocumentLength,
  subscribeToDocumentUpdates,
  updateDocumentState
} from './document.mjs'
import { P2PMD_LOOPBACK_HOST } from './network.mjs'

let server = null
let serverInfo = null
let serverTransition = Promise.resolve()
const eventClients = new Set()
let keepaliveInterval = null
const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

subscribeToDocumentUpdates(({ document, update }) => {
  broadcastEvent('yjsupdate', update)
  broadcastEvent('update', JSON.stringify(document))
})

export async function startP2pmdServer () {
  return withServerTransition(async () => {
    if (server && serverInfo) {
      return {
        ok: true,
        running: true,
        ...serverInfo
      }
    }

    const instance = http.createServer(handleRequest)

    try {
      const address = await listen(instance)
      const port = typeof address === 'object' && address ? address.port : null

      if (!Number.isInteger(port) || port < 1) {
        throw new Error('P2PMD server started without a valid port')
      }

      server = instance
      serverInfo = {
        host: P2PMD_LOOPBACK_HOST,
        port,
        localUrl: `http://${P2PMD_LOOPBACK_HOST}:${port}`
      }

      return {
        ok: true,
        running: true,
        ...serverInfo
      }
    } catch (error) {
      try {
        instance.close()
      } catch {}

      throw error
    }
  })
}

export function getP2pmdServerStatus () {
  if (!server || !serverInfo) {
    return {
      ok: true,
      running: false
    }
  }

  return {
    ok: true,
    running: true,
    ...serverInfo
  }
}

export async function stopP2pmdServer () {
  return withServerTransition(stopServerInternal)
}

async function stopServerInternal () {
  if (!server) {
    serverInfo = null
    closeEventClients()
    return {
      ok: true,
      running: false
    }
  }

  const existing = server
  server = null
  serverInfo = null
  closeEventClients()

  await new Promise((resolve, reject) => {
    existing.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })

  return {
    ok: true,
    running: false
  }
}

function handleRequest (req, res) {
  const pathname = String(req.url || '/').split('?')[0]

  if (req.method === 'OPTIONS') {
    sendEmpty(res, 204)
    return
  }

  if (req.method === 'GET' && pathname === '/status') {
    sendJson(res, 200, {
      ok: true,
      service: 'p2pmd',
      running: true,
      peers: eventClients.size
    })
    return
  }

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    sendHtml(res, 200, getFoundationPage())
    return
  }

  if (req.method === 'GET' && pathname === '/doc') {
    sendJson(res, 200, getDocumentState())
    return
  }

  if (req.method === 'GET' && pathname === '/doc/yjsstate') {
    sendJson(res, 200, {
      yjsState: getEncodedDocumentState()
    })
    return
  }

  if (req.method === 'POST' && pathname === '/doc/update') {
    readJsonBody(req)
      .then((body) => {
        const result = applyDocumentUpdate(body.update)
        sendJson(res, result.ok ? 200 : 400, result)
      })
      .catch((error) => {
        sendJson(res, error.statusCode || 400, {
          ok: false,
          error: error.message
        })
      })
    return
  }

  if (req.method === 'POST' && pathname === '/doc') {
    readJsonBody(req)
      .then((body) => {
        const result = updateDocumentState(body.content)
        sendJson(res, result.ok ? 200 : 400, result)
      })
      .catch((error) => {
        sendJson(res, error.statusCode || 400, {
          ok: false,
          error: error.message
        })
      })
    return
  }

  if (req.method === 'POST' && pathname === '/preview') {
    readJsonBody(req)
      .then((body) => {
        if (typeof body.content !== 'string') {
          sendJson(res, 400, {
            ok: false,
            error: 'Invalid Markdown content. Expected a string.'
          })
          return
        }

        if (body.content.length > getMaxDocumentLength()) {
          sendJson(res, 413, {
            ok: false,
            error: 'Markdown is too large. Maximum size is 10 MB.'
          })
          return
        }

        sendJson(res, 200, {
          ok: true,
          html: markdownRenderer.render(body.content)
        })
      })
      .catch((error) => {
        sendJson(res, error.statusCode || 400, {
          ok: false,
          error: error.message
        })
      })
    return
  }

  if (req.method === 'GET' && pathname === '/events') {
    openEventStream(res)
    return
  }

  sendJson(res, 404, {
    ok: false,
    error: 'Not found'
  })
}

function listen (instance) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      instance.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      instance.off('error', onError)
      resolve(instance.address())
    }

    instance.once('error', onError)
    instance.once('listening', onListening)
    instance.listen(0, P2PMD_LOOPBACK_HOST)
  })
}

function sendJson (res, statusCode, body) {
  const payload = JSON.stringify(body)
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  setCorsHeaders(res)
  res.setHeader('Connection', 'close')
  res.end(payload)
}

function sendHtml (res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  setCorsHeaders(res)
  res.setHeader('Connection', 'close')
  res.end(body)
}

function sendEmpty (res, statusCode) {
  res.statusCode = statusCode
  setCorsHeaders(res)
  res.setHeader('Connection', 'close')
  res.end()
}

function setCorsHeaders (res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function openEventStream (res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  setCorsHeaders(res)
  res.flushHeaders()

  eventClients.add(res)
  writeEvent(res, 'peers', String(eventClients.size))
  writeEvent(res, 'yjsupdate', getEncodedDocumentState())
  broadcastEvent('peers', String(eventClients.size))

  if (!keepaliveInterval) {
    keepaliveInterval = setInterval(() => {
      broadcastRaw(':keepalive\n\n')
    }, 20000)
  }
}

function broadcastEvent (event, data) {
  broadcastRaw(`event: ${event}\ndata: ${data}\n\n`)
}

function broadcastRaw (payload) {
  let removed = false

  for (const client of [...eventClients]) {
    try {
      client.write(payload)
    } catch (error) {
      console.error('[p2pmd] Removing SSE client after write failure:', error)
      eventClients.delete(client)
      removed = true
    }
  }

  if (removed && eventClients.size > 0) {
    broadcastEvent('peers', String(eventClients.size))
  }

  if (eventClients.size === 0 && keepaliveInterval) {
    clearInterval(keepaliveInterval)
    keepaliveInterval = null
  }
}

function writeEvent (res, event, data) {
  res.write(`event: ${event}\ndata: ${data}\n\n`)
}

function closeEventClients () {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval)
    keepaliveInterval = null
  }

  for (const client of eventClients) {
    try {
      client.end()
    } catch {}
  }
  eventClients.clear()
}

function readJsonBody (req) {
  const maxBodyLength = getMaxDocumentLength() * 2

  return new Promise((resolve, reject) => {
    let body = ''
    let settled = false

    req.on('data', (chunk) => {
      if (settled) return

      body += chunk.toString()
      if (body.length > maxBodyLength) {
        settled = true
        reject(createHttpError(413, 'Request body is too large.'))
      }
    })

    req.on('end', () => {
      if (settled) return
      settled = true

      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        reject(createHttpError(400, 'Invalid JSON request body.'))
      }
    })

    req.on('error', (error) => {
      if (settled) return
      settled = true
      reject(createHttpError(400, error.message || 'Unable to read request body.'))
    })
  })
}

function createHttpError (statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function getFoundationPage () {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>P2PMD Foundation</title>
    <style>
      :root {
        --page: #f4f1e8;
        --panel: #fffdf7;
        --ink: #14231c;
        --muted: #617267;
        --line: #d7ded8;
        --accent: #076c50;
        --accent-soft: #dcebe5;
      }
      body {
        box-sizing: border-box;
        margin: 0;
        min-height: 100vh;
        padding: 14px;
        background:
          radial-gradient(circle at 12% 0%, rgba(7, 108, 80, 0.12), transparent 34%),
          linear-gradient(180deg, #fbfaf4 0%, var(--page) 100%);
        color: var(--ink);
        font-family: "Georgia", "Times New Roman", serif;
      }
      h1 { margin: 0; font-size: 27px; letter-spacing: -0.03em; }
      p { line-height: 1.5; }
      code { color: var(--accent); }
      .app-shell {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .hero {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: flex-start;
      }
      .subtitle {
        margin: 5px 0 0;
        color: var(--muted);
        font-size: 14px;
      }
      .mode-pill {
        flex: 0 0 auto;
        padding: 6px 10px;
        border: 1px solid rgba(7, 108, 80, 0.18);
        border-radius: 999px;
        background: var(--accent-soft);
        color: #285444;
        font: 700 12px/1 sans-serif;
      }
      .editor-card {
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: rgba(255, 253, 247, 0.92);
        box-shadow: 0 12px 32px rgba(20, 35, 28, 0.08);
      }
      textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: min(58vh, 520px);
        padding: 12px;
        border: 1px solid #9aa79f;
        border-radius: 12px;
        background: #fff;
        color: var(--ink);
        font: 15px/1.5 monospace;
        resize: vertical;
      }
      #preview {
        box-sizing: border-box;
        min-height: min(58vh, 520px);
        padding: 12px 14px;
        border: 1px solid #d4dbd6;
        border-radius: 12px;
        background: #fff;
        overflow-wrap: anywhere;
      }
      #preview > :first-child { margin-top: 0; }
      #preview > :last-child { margin-bottom: 0; }
      #preview pre {
        padding: 12px;
        border-radius: 5px;
        background: #edf1ed;
        overflow-x: auto;
      }
      #preview code {
        font-family: monospace;
      }
      #preview blockquote {
        margin-left: 0;
        padding-left: 14px;
        border-left: 3px solid #8aa398;
        color: #526158;
      }
      #preview img {
        max-width: 100%;
      }
      #formatting-toolbar {
        display: flex;
        gap: 6px;
        margin-bottom: 10px;
        padding: 0 0 5px;
        overflow-x: auto;
      }
      #formatting-toolbar button {
        flex: 0 0 auto;
        min-width: 40px;
        padding: 8px 10px;
        border: 1px solid #b8c7bf;
        border-radius: 10px;
        background: #e7eee9;
        color: #234438;
        font: 700 13px/1 sans-serif;
      }
      #editor-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-top: 12px;
      }
      #editor-meta {
        color: var(--muted);
        font: 12px/1.3 monospace;
      }
      button {
        padding: 10px 16px;
        border: 0;
        border-radius: 10px;
        background: var(--accent);
        color: #fff;
        font-size: 15px;
        font-weight: 700;
      }
      #toggle-preview {
        display: inline-grid;
        width: 42px;
        height: 42px;
        padding: 0;
        place-items: center;
      }
      #toggle-preview svg {
        width: 21px;
        height: 21px;
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 2;
      }
      [hidden] { display: none !important; }
      #document-status {
        min-height: 22px;
        margin: 10px 0 0;
        color: var(--muted);
        font-size: 14px;
      }
      #peer-status {
        display: inline-flex;
        align-items: center;
        margin: 0;
        padding: 5px 9px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: #285444;
        font-size: 13px;
        font-weight: 700;
      }
      .status-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
    </style>
  </head>
  <body>
    <div class="app-shell">
      <header class="hero">
        <div>
          <h1>P2PMD</h1>
          <p class="subtitle">Collaborative Markdown over Holesail.</p>
        </div>
        <span class="mode-pill">Mobile editor</span>
      </header>
      <div class="status-row">
        <p id="peer-status" role="status">Participants: connecting...</p>
        <p id="document-status" role="status">Loading document...</p>
      </div>
      <main class="editor-card">
        <div id="formatting-toolbar" role="toolbar" aria-label="Markdown formatting">
          <button type="button" data-format="bold" title="Bold">B</button>
          <button type="button" data-format="italic" title="Italic">I</button>
          <button type="button" data-format="h1" title="Heading 1">H1</button>
          <button type="button" data-format="h2" title="Heading 2">H2</button>
          <button type="button" data-format="ul" title="Bullet list">UL</button>
          <button type="button" data-format="ol" title="Numbered list">OL</button>
          <button type="button" data-format="link" title="Insert link">Link</button>
          <button type="button" data-format="inline-code" title="Inline code">Code</button>
          <button type="button" data-format="code-block" title="Code block">Block</button>
          <button type="button" data-format="quote" title="Quote">Quote</button>
        </div>
        <textarea id="document-input" aria-label="Markdown document" placeholder="Write Markdown here..."></textarea>
        <article id="preview" aria-label="Markdown preview" hidden></article>
        <div id="editor-controls">
          <span id="editor-meta">0 chars</span>
          <button id="toggle-preview" type="button" title="Preview Markdown" aria-label="Preview Markdown" aria-pressed="false">
            <svg id="preview-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12"></path>
              <circle cx="12" cy="12" r="2.5"></circle>
            </svg>
            <svg id="edit-icon" viewBox="0 0 24 24" aria-hidden="true" hidden>
              <path d="M4 20h4l11-11-4-4L4 16v4"></path>
              <path d="m13.5 6.5 4 4"></path>
            </svg>
          </button>
        </div>
      </main>
    </div>
    <script>
      const input = document.getElementById('document-input')
      const preview = document.getElementById('preview')
      const toggleButton = document.getElementById('toggle-preview')
      const previewIcon = document.getElementById('preview-icon')
      const editIcon = document.getElementById('edit-icon')
      const status = document.getElementById('document-status')
      const peerStatus = document.getElementById('peer-status')
      const formattingToolbar = document.getElementById('formatting-toolbar')
      const editorMeta = document.getElementById('editor-meta')
      let isPreviewMode = false
      let previewRequestId = 0
      let saveTimer = null
      let pendingContent = null
      let saveInFlight = false
      let lastSyncedContent = ''
      let toolbarPointerHandled = false
      const newline = String.fromCharCode(10)
      const wordSeparator = new RegExp('[ ' + String.fromCharCode(9, 10, 13) + ']+')

      function notifyNative(type, details) {
        if (!window.ReactNativeWebView) return

        window.ReactNativeWebView.postMessage(JSON.stringify({
          type,
          source: 'bare-http1',
          ...details
        }))
      }

      async function loadDocument() {
        try {
          const response = await fetch('/doc')
          const result = await response.json()

          if (!response.ok || typeof result.content !== 'string') {
            throw new Error(result.error || 'Unable to load document')
          }

          input.value = result.content
          lastSyncedContent = result.content
          updateEditorMeta()
          status.textContent = 'Document loaded'
          notifyNative('p2pmd-document-loaded', {
            updatedAt: result.updatedAt
          })
        } catch (error) {
          status.textContent = error.message
          notifyNative('p2pmd-document-error', {
            error: error.message
          })
        }
      }

      function scheduleDocumentSave() {
        if (saveTimer) clearTimeout(saveTimer)
        updateEditorMeta()
        status.textContent = 'Changes pending...'

        saveTimer = setTimeout(() => {
          saveTimer = null
          pendingContent = input.value
          flushDocumentSave()
        }, 200)
      }

      function replaceDocumentRange(start, end, replacement, selectionStart, selectionEnd) {
        input.value = input.value.slice(0, start) + replacement + input.value.slice(end)
        input.focus()
        input.setSelectionRange(selectionStart, selectionEnd)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }

      function wrapSelection(prefix, suffix) {
        const start = input.selectionStart
        const end = input.selectionEnd
        const selected = input.value.slice(start, end)
        const replacement = prefix + selected + suffix
        const nextStart = start + prefix.length
        const nextEnd = selected ? nextStart + selected.length : nextStart

        replaceDocumentRange(start, end, replacement, nextStart, nextEnd)
      }

      function replaceCurrentLinePrefix(prefix, removablePattern) {
        const cursor = input.selectionStart
        const lineStart = input.value.lastIndexOf(newline, cursor - 1) + 1
        const lineEndIndex = input.value.indexOf(newline, cursor)
        const lineEnd = lineEndIndex === -1 ? input.value.length : lineEndIndex
        const line = input.value.slice(lineStart, lineEnd)
        const existingPrefix = line.match(removablePattern)
        const cleanLine = existingPrefix ? line.slice(existingPrefix[0].length) : line
        const replacement = existingPrefix && existingPrefix[0] === prefix
          ? cleanLine
          : prefix + cleanLine
        const prefixDifference = replacement.length - line.length
        const nextCursor = Math.max(lineStart, cursor + prefixDifference)

        replaceDocumentRange(lineStart, lineEnd, replacement, nextCursor, nextCursor)
      }

      function replaceSelectedLines(type) {
        const start = input.selectionStart
        const end = input.selectionEnd
        const lineStart = input.value.lastIndexOf(newline, start - 1) + 1
        const lineEndIndex = input.value.indexOf(newline, end)
        const lineEnd = lineEndIndex === -1 ? input.value.length : lineEndIndex
        const lines = input.value.slice(lineStart, lineEnd).split(newline)
        const numbered = type === 'ol'
        const markerPattern = numbered ? /^[0-9]+[.][ \t]+/ : /^[-*+][ \t]+/
        const nonEmptyLines = lines.filter((line) => line.trim())
        const removeMarkers = nonEmptyLines.length > 0 &&
          nonEmptyLines.every((line) => markerPattern.test(line))
        let number = 1

        const replacement = lines.map((line) => {
          if (!line.trim()) return line
          const cleanLine = line.replace(/^([-*+]|[0-9]+[.])[ \t]+/, '')
          if (removeMarkers) return cleanLine
          if (!numbered) return '- ' + cleanLine
          return (number++) + '. ' + cleanLine
        }).join(newline)

        replaceDocumentRange(
          lineStart,
          lineEnd,
          replacement,
          lineStart,
          lineStart + replacement.length
        )
      }

      function insertLink() {
        const start = input.selectionStart
        const end = input.selectionEnd
        const selected = input.value.slice(start, end)

        if (selected && /^(https?:[/][/]|www[.]|[a-z0-9-]+[.][a-z]{2,})/i.test(selected.trim())) {
          const replacement = '[](' + selected + ')'
          replaceDocumentRange(start, end, replacement, start + 1, start + 1)
          return
        }

        const label = selected || 'text'
        const replacement = '[' + label + '](url)'
        const urlStart = start + label.length + 3
        replaceDocumentRange(start, end, replacement, urlStart, urlStart + 3)
      }

      function applyFormatting(format) {
        const codeMarker = String.fromCharCode(96)

        if (format === 'bold') wrapSelection('**', '**')
        else if (format === 'italic') wrapSelection('*', '*')
        else if (format === 'h1') replaceCurrentLinePrefix('# ', /^#+[ \t]+/)
        else if (format === 'h2') replaceCurrentLinePrefix('## ', /^#+[ \t]+/)
        else if (format === 'ul' || format === 'ol') replaceSelectedLines(format)
        else if (format === 'link') insertLink()
        else if (format === 'inline-code') wrapSelection(codeMarker, codeMarker)
        else if (format === 'code-block') {
          wrapSelection(codeMarker.repeat(3) + newline, newline + codeMarker.repeat(3))
        } else if (format === 'quote') {
          replaceCurrentLinePrefix('> ', /^>[ \t]+/)
        }
      }

      function getToolbarButton(event) {
        return event.target?.closest?.('button[data-format]') || null
      }

      function handleToolbarFormat(event) {
        const button = getToolbarButton(event)
        if (!button || isPreviewMode) return false

        applyFormatting(button.dataset.format)
        return true
      }

      function updateEditorMeta() {
        const chars = input.value.length
        const words = input.value.trim() ? input.value.trim().split(wordSeparator).length : 0
        editorMeta.textContent = chars + ' chars / ' + words + ' words'
      }

      function continueListOnEnter(event) {
        if (event.key !== 'Enter') return

        const cursor = input.selectionStart
        if (cursor !== input.selectionEnd) return

        const lineStart = input.value.lastIndexOf(newline, cursor - 1) + 1
        const line = input.value.slice(lineStart, cursor)
        const bullet = line.match(/^([-*+])[ \t]+/)
        const ordered = line.match(/^([0-9]+)[.][ \t]+/)
        let nextPrefix = null

        if (bullet) nextPrefix = bullet[1] + ' '
        else if (ordered) nextPrefix = (Number(ordered[1]) + 1) + '. '

        if (!nextPrefix) return

        event.preventDefault()
        replaceDocumentRange(cursor, cursor, newline + nextPrefix, cursor + newline.length + nextPrefix.length, cursor + newline.length + nextPrefix.length)
      }

      async function flushDocumentSave() {
        if (saveInFlight || pendingContent === null) return

        saveInFlight = true

        try {
          while (pendingContent !== null) {
            const content = pendingContent
            pendingContent = null

            if (content === lastSyncedContent) continue

            status.textContent = 'Syncing changes...'

            const response = await fetch('/doc', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                content
              })
            })
            const result = await response.json()

            if (!response.ok || !result.ok) {
              throw new Error(result.error || 'Unable to save document')
            }

            lastSyncedContent = result.document.content
            status.textContent = 'Changes synced'
            notifyNative('p2pmd-document-saved', {
              updatedAt: result.document.updatedAt,
              contentLength: result.document.content.length
            })
          }
        } catch (error) {
          status.textContent = error.message
          notifyNative('p2pmd-document-error', {
            error: error.message
          })
        } finally {
          saveInFlight = false
          if (pendingContent !== null) flushDocumentSave()
        }
      }

      async function renderPreview() {
        const requestId = ++previewRequestId
        preview.setAttribute('aria-busy', 'true')
        status.textContent = 'Rendering Markdown preview...'

        try {
          const response = await fetch('/preview', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              content: input.value
            })
          })
          const result = await response.json()

          if (!response.ok || !result.ok || typeof result.html !== 'string') {
            throw new Error(result.error || 'Unable to render Markdown preview')
          }

          if (requestId !== previewRequestId || !isPreviewMode) return

          preview.innerHTML = result.html
          status.textContent = 'Markdown preview'
        } catch (error) {
          if (requestId !== previewRequestId || !isPreviewMode) return
          status.textContent = error.message
          notifyNative('p2pmd-document-error', {
            error: error.message
          })
        } finally {
          if (requestId === previewRequestId) {
            preview.removeAttribute('aria-busy')
          }
        }
      }

      function togglePreview() {
        isPreviewMode = !isPreviewMode
        input.hidden = isPreviewMode
        preview.hidden = !isPreviewMode
        formattingToolbar.hidden = isPreviewMode
        previewIcon.hidden = isPreviewMode
        editIcon.hidden = !isPreviewMode
        toggleButton.title = isPreviewMode ? 'Edit Markdown' : 'Preview Markdown'
        toggleButton.setAttribute('aria-label', toggleButton.title)
        toggleButton.setAttribute('aria-pressed', String(isPreviewMode))

        if (isPreviewMode) {
          renderPreview()
        } else {
          previewRequestId += 1
          status.textContent = 'Edit mode'
          input.focus()
        }
      }

      function connectEvents() {
        const source = new EventSource('/events')

        source.addEventListener('peers', (event) => {
          const count = Number(event.data)
          if (!Number.isInteger(count) || count < 0) return

          peerStatus.textContent = 'Participants: ' + count
        })

        source.addEventListener('update', (event) => {
          try {
            const documentState = JSON.parse(event.data)
            if (typeof documentState.content !== 'string') return
            if (documentState.content === input.value) {
              lastSyncedContent = documentState.content
              return
            }

            input.value = documentState.content
            lastSyncedContent = documentState.content
            updateEditorMeta()
            status.textContent = 'Remote document update received'
            if (isPreviewMode) renderPreview()
            notifyNative('p2pmd-document-updated', {
              updatedAt: documentState.updatedAt,
              contentLength: documentState.content.length
            })
          } catch {}
        })

        source.onerror = () => {
          status.textContent = 'Reconnecting to room updates...'
        }
      }

      input.addEventListener('input', scheduleDocumentSave)
      input.addEventListener('keydown', continueListOnEnter)
      formattingToolbar.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        toolbarPointerHandled = handleToolbarFormat(event)
      })
      formattingToolbar.addEventListener('click', (event) => {
        if (toolbarPointerHandled) {
          toolbarPointerHandled = false
          return
        }

        handleToolbarFormat(event)
      })
      toggleButton.addEventListener('click', togglePreview)
      loadDocument()
      connectEvents()
    </script>
  </body>
</html>`
}

async function withServerTransition (operation) {
  const previousTransition = serverTransition
  let release

  serverTransition = new Promise((resolve) => {
    release = resolve
  })

  await previousTransition

  try {
    return await operation()
  } finally {
    release()
  }
}
