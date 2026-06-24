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
  // Security-critical: preview output is injected with innerHTML in the WebView.
  // Keep raw HTML disabled unless the preview path is sanitized first.
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
      body {
        box-sizing: border-box;
        margin: 0;
        min-height: 100vh;
        padding: 20px;
        background: #f6f7f2;
        color: #14231c;
        font-family: sans-serif;
      }
      h1 { margin: 0 0 12px; font-size: 28px; }
      p { line-height: 1.5; }
      code { color: #076c50; }
      textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: 180px;
        padding: 12px;
        border: 1px solid #9aa79f;
        border-radius: 6px;
        background: #fff;
        color: #14231c;
        font: 15px/1.5 monospace;
        resize: vertical;
      }
      #preview {
        box-sizing: border-box;
        min-height: 180px;
        padding: 12px 14px;
        border: 1px solid #d4dbd6;
        border-radius: 6px;
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
      #editor-controls {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 12px;
      }
      button {
        padding: 10px 16px;
        border: 0;
        border-radius: 6px;
        background: #076c50;
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
        color: #526158;
        font-size: 14px;
      }
      #peer-status {
        display: inline-flex;
        align-items: center;
        margin: 0 0 12px;
        padding: 5px 9px;
        border-radius: 999px;
        background: #dcebe5;
        color: #285444;
        font-size: 13px;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <h1>P2PMD Local Document</h1>
    <p>Edit the document stored in the Bare worklet.</p>
    <p id="peer-status" role="status">Participants: connecting...</p>
    <textarea id="document-input" aria-label="Markdown document" placeholder="Write Markdown here..."></textarea>
    <article id="preview" aria-label="Markdown preview" hidden></article>
    <div id="editor-controls">
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
    <p id="document-status" role="status">Loading document...</p>
    <script>
      const input = document.getElementById('document-input')
      const preview = document.getElementById('preview')
      const toggleButton = document.getElementById('toggle-preview')
      const previewIcon = document.getElementById('preview-icon')
      const editIcon = document.getElementById('edit-icon')
      const status = document.getElementById('document-status')
      const peerStatus = document.getElementById('peer-status')
      let isPreviewMode = false
      let previewRequestId = 0
      let saveTimer = null
      let pendingContent = null
      let saveInFlight = false
      let lastSyncedContent = ''

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
        status.textContent = 'Changes pending...'

        saveTimer = setTimeout(() => {
          saveTimer = null
          pendingContent = input.value
          flushDocumentSave()
        }, 200)
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
