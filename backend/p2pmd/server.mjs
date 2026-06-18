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
    <title>P2PMD</title>
    <style>
      :root {
        --page: #1f2027;
        --panel-deep: #202128;
        --ink: #f1f2f7;
        --line: #3a3d49;
        --accent: #2f80ed;
        --local: #f2d35b;
        --remote: #59a6ff;
        --ui-font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --editor-font: "FontWithASyntaxHighlighter", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      body {
        box-sizing: border-box;
        margin: 0;
        width: 100vw;
        height: 100vh;
        padding: 0;
        background: var(--page);
        color: var(--ink);
        font-family: var(--ui-font);
        overflow: hidden;
        -webkit-touch-callout: none;
      }
      h1 { margin: 0; font-size: 19px; letter-spacing: 0.01em; }
      p { line-height: 1.5; }
      code { color: var(--accent); }
      .app-shell {
        display: flex;
        flex-direction: column;
        width: 100vw;
        height: 100vh;
      }
      .editor-card {
        display: flex;
        flex: 1;
        flex-direction: column;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: var(--panel-deep);
        box-shadow: none;
      }
      .editor-frame {
        display: grid;
        grid-template-columns: 56px minmax(0, 1fr);
        flex: 1;
        align-items: stretch;
        border: 0;
        border-radius: 0;
        background: var(--panel-deep);
        overflow: hidden;
      }
      #line-gutter-wrap {
        position: relative;
        min-height: 0;
        border-right: 1px solid #2d3039;
        background: #23252d;
        overflow: hidden;
      }
      #line-gutter {
        position: absolute;
        top: 14px;
        right: 0;
        left: 0;
        color: #6f7484;
        font: 15px/1.55 var(--editor-font);
        text-align: right;
      }
      .gutter-line {
        box-sizing: border-box;
        min-height: 23.25px;
        padding: 0 10px 0 4px;
        border-right: 3px solid transparent;
      }
      .gutter-line.local {
        border-right-color: var(--local);
        color: #b8a95a;
        font-weight: 700;
      }
      .gutter-line.remote {
        border-right-color: var(--remote);
        color: #6aa5ea;
        font-weight: 700;
      }
      textarea {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-height: 0;
        padding: 14px 12px;
        border: 0;
        border-radius: 0;
        background: var(--panel-deep);
        color: var(--ink);
        caret-color: var(--remote);
        font: 16px/1.55 var(--editor-font);
        resize: none;
        overflow: auto;
        -webkit-user-select: text;
        user-select: text;
      }
      textarea:focus {
        outline: none;
      }
      #preview {
        box-sizing: border-box;
        flex: 1;
        min-height: 0;
        padding: 18px;
        border: 0;
        border-radius: 0;
        background: var(--panel-deep);
        color: var(--ink);
        overflow: auto;
        overflow-wrap: anywhere;
        font: 16px/1.6 var(--ui-font);
      }
      #preview h1,
      #preview h2,
      #preview h3 {
        letter-spacing: -0.02em;
        line-height: 1.15;
      }
      #preview > :first-child { margin-top: 0; }
      #preview > :last-child { margin-bottom: 0; }
      #preview pre {
        padding: 12px;
        border-radius: 8px;
        background: #181a20;
        overflow-x: auto;
      }
      #preview code {
        color: #d8dcff;
        font-family: var(--editor-font);
      }
      #preview :not(pre) > code {
        padding: 0.12rem 0.34rem;
        border: 1px solid #3a3d49;
        border-radius: 6px;
        background: #2b2d38;
        color: #f1f2f7;
        font-size: 0.92em;
      }
      #preview pre code {
        padding: 0;
        border: 0;
        background: transparent;
      }
      #preview blockquote {
        margin-left: 0;
        padding-left: 14px;
        border-left: 3px solid var(--remote);
        color: #c4c8d8;
      }
      #preview img {
        max-width: 100%;
      }
      #formatting-toolbar {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 6px 8px;
        border-bottom: 1px solid var(--line);
        background: #24262f;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        touch-action: pan-x;
        -webkit-overflow-scrolling: touch;
        -webkit-user-select: none;
        user-select: none;
      }
      #formatting-toolbar button {
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        display: flex;
        width: 38px;
        height: 36px;
        padding: 8px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: rgba(255, 255, 255, 0.72);
        font: 700 14px/1 var(--ui-font);
        touch-action: manipulation;
        transition: background-color 0.15s ease, color 0.15s ease;
        -webkit-user-select: none;
        user-select: none;
      }
      #formatting-toolbar button:hover {
        color: #ffffff;
      }
      #formatting-toolbar button:active {
        background: #343744;
        color: #ffffff;
      }
      .toolbar-icon {
        display: block;
        width: 16px;
        height: 16px;
        fill: currentColor;
      }
      .toolbar-divider {
        flex: 0 0 auto;
        width: 1px;
        height: 24px;
        margin: 0 4px;
        background: var(--line);
      }
      [hidden] { display: none !important; }
    </style>
  </head>
  <body>
    <div class="app-shell">
      <main class="editor-card">
        <div id="formatting-toolbar" role="toolbar" aria-label="Markdown formatting">
          <button type="button" data-format="bold" title="Bold" aria-label="Bold">
            <svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8.21 13c2.106 0 3.412-1.087 3.412-2.823 0-1.306-.984-2.283-2.324-2.386v-.055a2.176 2.176 0 0 0 1.852-2.14c0-1.51-1.162-2.46-3.014-2.46H3.843V13zM5.908 4.674h1.696c.963 0 1.517.451 1.517 1.244 0 .834-.629 1.32-1.73 1.32H5.908V4.673zm0 6.788V8.598h1.73c1.217 0 1.88.492 1.88 1.415 0 .943-.643 1.449-1.832 1.449H5.907z"/></svg>
          </button>
          <button type="button" data-format="italic" title="Italic" aria-label="Italic">
            <svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M7.991 11.674 9.53 4.455c.123-.595.246-.71 1.347-.807l.11-.52H7.211l-.11.52c1.06.096 1.128.212 1.005.807L6.57 11.674c-.123.595-.246.71-1.346.806l-.11.52h3.774l.11-.52c-1.06-.095-1.129-.211-1.006-.806z"/></svg>
          </button>
          <div class="toolbar-divider" aria-hidden="true"></div>
          <button type="button" data-format="h1" title="Heading 1" aria-label="Heading 1">
            <svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8.637 13V3.669H7.379V7.62H2.758V3.67H1.5V13h1.258V8.728h4.62V13h1.259zm5.329 0V3.669h-1.244L10.5 5.316v1.265l2.16-1.565h.062V13h1.244z"/></svg>
          </button>
          <button type="button" data-format="h2" title="Heading 2" aria-label="Heading 2">
            <svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M7.638 13V3.669H6.38V7.62H1.759V3.67H.5V13h1.258V8.728h4.62V13zm3.022-6.733v-.048c0-.889.63-1.668 1.716-1.668.957 0 1.675.608 1.675 1.572 0 .855-.554 1.504-1.067 2.085l-3.513 3.999V13H15.5v-1.094h-4.245v-.075l2.481-2.844c.875-.998 1.586-1.784 1.586-2.953 0-1.463-1.155-2.556-2.919-2.556-1.941 0-2.966 1.326-2.966 2.74v.049z"/></svg>
          </button>
          <div class="toolbar-divider" aria-hidden="true"></div>
          <button type="button" data-format="ul" title="Bullet list" aria-label="Bullet list">
            <svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m-3 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2m0 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2m0 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2"/></svg>
          </button>
          <button type="button" data-format="ol" title="Numbered list" aria-label="Numbered list">
            <svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5"/><path d="M1.713 11.865v-.474H2c.217 0 .363-.137.363-.317 0-.185-.158-.31-.361-.31-.223 0-.367.152-.373.31h-.59c.016-.467.373-.787.986-.787.588-.002.954.291.957.703a.595.595 0 0 1-.492.594v.033a.615.615 0 0 1 .569.631c.003.533-.502.8-1.051.8-.656 0-1-.37-1.008-.794h.582c.008.178.186.306.422.309.254 0 .424-.145.422-.35-.002-.195-.155-.348-.414-.348h-.3zm-.004-4.699h-.604v-.035c0-.408.295-.844.958-.844.583 0 .96.326.96.756 0 .389-.257.617-.476.848l-.537.572v.03h1.054V9H1.143v-.395l.957-.99c.138-.142.293-.304.293-.508 0-.18-.147-.32-.342-.32a.33.33 0 0 0-.342.338zM2.564 5h-.635V2.924h-.031l-.598.42v-.567l.629-.443h.635z"/></svg>
          </button>
          <div class="toolbar-divider" aria-hidden="true"></div>
          <button type="button" data-format="link" title="Insert link" aria-label="Insert link">
            <svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287z"/><path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z"/></svg>
          </button>
          <button type="button" data-format="image" title="Insert image" aria-label="Insert image">
            <svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/><path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1z"/></svg>
          </button>
          <div class="toolbar-divider" aria-hidden="true"></div>
          <button type="button" data-format="inline-code" title="Inline code" aria-label="Inline code">
            <svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.478 1.647a.5.5 0 1 0-.956-.294l-4 13a.5.5 0 0 0 .956.294zM4.854 4.146a.5.5 0 0 1 0 .708L1.707 8l3.147 3.146a.5.5 0 0 1-.708.708l-3.5-3.5a.5.5 0 0 1 0-.708l3.5-3.5a.5.5 0 0 1 .708 0m6.292 0a.5.5 0 0 0 0 .708L14.293 8l-3.147 3.146a.5.5 0 0 0 .708.708l3.5-3.5a.5.5 0 0 0 0-.708l-3.5-3.5a.5.5 0 0 0-.708 0"/></svg>
          </button>
          <button type="button" data-format="code-block" title="Code block" aria-label="Code block">
            <svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/><path d="M6.854 4.646a.5.5 0 0 1 0 .708L4.207 8l2.647 2.646a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 0 1 .708 0m2.292 0a.5.5 0 0 0 0 .708L11.793 8l-2.647 2.646a.5.5 0 0 0 .708.708l3-3a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708 0"/></svg>
          </button>
          <button type="button" data-format="quote" title="Quote" aria-label="Quote">
            <svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M12 12a1 1 0 0 0 1-1V8.558a1 1 0 0 0-1-1h-1.388q0-.527.062-1.054.093-.558.31-.992t.559-.683q.34-.279.868-.279V3q-.868 0-1.52.372a3.3 3.3 0 0 0-1.085.992 4.9 4.9 0 0 0-.62 1.458A7.7 7.7 0 0 0 9 7.558V11a1 1 0 0 0 1 1zm-6 0a1 1 0 0 0 1-1V8.558a1 1 0 0 0-1-1H4.612q0-.527.062-1.054.094-.558.31-.992.217-.434.559-.683.34-.279.868-.279V3q-.868 0-1.52.372a3.3 3.3 0 0 0-1.085.992 4.9 4.9 0 0 0-.62 1.458A7.7 7.7 0 0 0 3 7.558V11a1 1 0 0 0 1 1z"/></svg>
          </button>
        </div>
        <div class="editor-frame">
          <div id="line-gutter-wrap" aria-hidden="true">
            <div id="line-gutter"></div>
          </div>
          <textarea id="document-input" aria-label="Markdown document" placeholder="Write Markdown here..."></textarea>
        </div>
        <article id="preview" aria-label="Markdown preview" hidden></article>
      </main>
    </div>
    <script>
      const input = document.getElementById('document-input')
      const preview = document.getElementById('preview')
      const formattingToolbar = document.getElementById('formatting-toolbar')
      const lineGutter = document.getElementById('line-gutter')
      const TOOLBAR_TAP_MOVEMENT_LIMIT = 8
      let isPreviewMode = false
      let previewRequestId = 0
      let saveTimer = null
      let pendingContent = null
      let saveInFlight = false
      let lastSyncedContent = ''
      let lineOrigins = []
      let toolbarPointerState = null
      let suppressToolbarClick = false
      const newline = String.fromCharCode(10)

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
          renderLineGutter('loaded')
          notifyNative('p2pmd-document-loaded', {
            updatedAt: result.updatedAt
          })
        } catch (error) {
          notifyNative('p2pmd-document-error', {
            error: error.message
          })
        }
      }

      function scheduleDocumentSave() {
        if (saveTimer) clearTimeout(saveTimer)
        renderLineGutter('local')

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

      function insertImage() {
        const start = input.selectionStart
        const end = input.selectionEnd
        const selected = input.value.slice(start, end)

        if (selected && /^(https?:[/][/]|www[.]|[a-z0-9-]+[.][a-z]{2,}|[.]?[/])/i.test(selected.trim())) {
          const replacement = '![](' + selected + ')'
          replaceDocumentRange(start, end, replacement, start + 3, start + 3)
          return
        }

        const altText = selected || 'image'
        const replacement = '![' + altText + ']()'
        replaceDocumentRange(start, end, replacement, start + replacement.length - 1, start + replacement.length - 1)
      }

      function applyFormatting(format) {
        const codeMarker = String.fromCharCode(96)

        if (format === 'bold') wrapSelection('**', '**')
        else if (format === 'italic') wrapSelection('*', '*')
        else if (format === 'h1') replaceCurrentLinePrefix('# ', /^#+[ \t]+/)
        else if (format === 'h2') replaceCurrentLinePrefix('## ', /^#+[ \t]+/)
        else if (format === 'ul' || format === 'ol') replaceSelectedLines(format)
        else if (format === 'link') insertLink()
        else if (format === 'image') insertImage()
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

      function restoreSelection(selection) {
        if (!selection) return
        input.focus()
        input.setSelectionRange(selection.start, selection.end)
      }

      function handleToolbarPointerDown(event) {
        const button = getToolbarButton(event)
        if (!button || isPreviewMode) {
          toolbarPointerState = null
          return
        }

        toolbarPointerState = {
          button,
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          selection: {
            start: input.selectionStart,
            end: input.selectionEnd
          }
        }
      }

      function handleToolbarPointerUp(event) {
        const state = toolbarPointerState
        toolbarPointerState = null
        if (!state || state.pointerId !== event.pointerId || isPreviewMode) return

        const movedX = Math.abs(event.clientX - state.x)
        const movedY = Math.abs(event.clientY - state.y)
        if (movedX > TOOLBAR_TAP_MOVEMENT_LIMIT || movedY > TOOLBAR_TAP_MOVEMENT_LIMIT) {
          suppressToolbarClick = true
          return
        }

        event.preventDefault()
        suppressToolbarClick = true
        restoreSelection(state.selection)
        applyFormatting(state.button.dataset.format)
      }

      function preventNativeContextMenu(event) {
        if (event.target !== input) return
        event.preventDefault()
      }

      function renderLineGutter(origin) {
        const lines = input.value.split(newline)
        const count = Math.max(lines.length, 1)

        if (origin) {
          lineOrigins = Array(count).fill(origin)
        } else {
          while (lineOrigins.length < count) lineOrigins.push('loaded')
          if (lineOrigins.length > count) lineOrigins = lineOrigins.slice(0, count)
        }

        lineGutter.replaceChildren()

        for (let index = 0; index < count; index++) {
          const line = document.createElement('div')
          const lineOrigin = lineOrigins[index] || 'loaded'
          line.className = 'gutter-line ' + lineOrigin
          line.title = lineOrigin === 'remote'
            ? 'Updated from remote peer'
            : lineOrigin === 'local'
              ? 'Edited on this device'
              : 'Loaded document line'
          line.textContent = String(index + 1)
          lineGutter.appendChild(line)
        }

        syncLineGutterScroll()
      }

      function syncLineGutterScroll() {
        lineGutter.style.transform = 'translateY(-' + input.scrollTop + 'px)'
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
            notifyNative('p2pmd-document-saved', {
              updatedAt: result.document.updatedAt,
              contentLength: result.document.content.length
            })
          }
        } catch (error) {
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
        } catch (error) {
          if (requestId !== previewRequestId || !isPreviewMode) return
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
        input.parentElement.hidden = isPreviewMode
        preview.hidden = !isPreviewMode
        formattingToolbar.hidden = isPreviewMode
        notifyNative('p2pmd-preview-mode', {
          preview: isPreviewMode
        })

        if (isPreviewMode) {
          renderPreview()
        } else {
          previewRequestId += 1
          input.focus()
        }
      }

      function connectEvents() {
        const source = new EventSource('/events')

        source.addEventListener('peers', (event) => {
          const count = Number(event.data)
          if (!Number.isInteger(count) || count < 0) return

          notifyNative('p2pmd-peers', {
            count
          })
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
            renderLineGutter('remote')
            if (isPreviewMode) renderPreview()
            notifyNative('p2pmd-document-updated', {
              updatedAt: documentState.updatedAt,
              contentLength: documentState.content.length
            })
          } catch {}
        })

      }

      input.addEventListener('input', scheduleDocumentSave)
      input.addEventListener('keydown', continueListOnEnter)
      input.addEventListener('scroll', syncLineGutterScroll)
      input.addEventListener('contextmenu', preventNativeContextMenu)
      document.addEventListener('contextmenu', preventNativeContextMenu)
      formattingToolbar.addEventListener('pointerdown', handleToolbarPointerDown)
      formattingToolbar.addEventListener('pointerup', handleToolbarPointerUp)
      formattingToolbar.addEventListener('pointercancel', () => {
        toolbarPointerState = null
      })
      formattingToolbar.addEventListener('click', (event) => {
        if (suppressToolbarClick) {
          suppressToolbarClick = false
          return
        }

        handleToolbarFormat(event)
      })
      window.__p2pmdTogglePreview = togglePreview
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
