import http from 'bare-http1'
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
      button {
        margin-top: 12px;
        padding: 10px 16px;
        border: 0;
        border-radius: 6px;
        background: #076c50;
        color: #fff;
        font-size: 15px;
        font-weight: 700;
      }
      button:disabled { opacity: 0.55; }
      #document-status {
        min-height: 22px;
        margin: 10px 0 0;
        color: #526158;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <h1>P2PMD Local Document</h1>
    <p>Edit the document stored in the Bare worklet.</p>
    <textarea id="document-input" aria-label="Markdown document" placeholder="Write Markdown here..."></textarea>
    <button id="save-document" type="button">Save Document</button>
    <p id="document-status" role="status">Loading document...</p>
    <script>
      const input = document.getElementById('document-input')
      const saveButton = document.getElementById('save-document')
      const status = document.getElementById('document-status')

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

      async function saveDocument() {
        saveButton.disabled = true
        status.textContent = 'Saving document...'

        try {
          const response = await fetch('/doc', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              content: input.value
            })
          })
          const result = await response.json()

          if (!response.ok || !result.ok) {
            throw new Error(result.error || 'Unable to save document')
          }

          status.textContent = 'Document saved'
          notifyNative('p2pmd-document-saved', {
            updatedAt: result.document.updatedAt,
            contentLength: result.document.content.length
          })
        } catch (error) {
          status.textContent = error.message
          notifyNative('p2pmd-document-error', {
            error: error.message
          })
        } finally {
          saveButton.disabled = false
        }
      }

      function connectEvents() {
        const source = new EventSource('/events')

        source.addEventListener('update', (event) => {
          try {
            const documentState = JSON.parse(event.data)
            if (typeof documentState.content !== 'string') return
            if (documentState.content === input.value) return

            input.value = documentState.content
            status.textContent = 'Remote document update received'
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

      saveButton.addEventListener('click', saveDocument)
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
