import { readHyperFile } from '../hyper/drive.mjs'
import {
  applyDocumentUpdate,
  getEncodedDocumentState,
  getDocumentState,
  getMaxDocumentLength,
  subscribeToDocumentUpdates,
  updateDocumentState
} from './document.mjs'
import { P2PMD_LOOPBACK_HOST } from './constants.mjs'
import { createPeerActivityStore, createPeerPresenceStore } from './peers.mjs'
import { renderMarkdownPreview, renderMarkdownSlides } from './preview.mjs'
import ieeeBrowserScript from './ieee-runtime.mjs'
import katexCss from './katex-runtime.mjs'
import { P2PMD_SCIENTIFIC_STYLES } from './scientific.mjs'
import { P2PMD_TEMPLATES, hasIeeeMarker } from './templates.mjs'
import yjsBrowserScript from './yjs-runtime.mjs'

let server = null
let serverInfo = null
let serverTransition = Promise.resolve()
let bareHttp = null
const eventClients = new Set()
const peerPresence = createPeerPresenceStore()
const peerActivity = createPeerActivityStore()
const editActivityTimers = new Map()
let keepaliveInterval = null
const EDIT_ACTIVITY_DEBOUNCE_MS = 1200

subscribeToDocumentUpdates(({ document, origin, update }) => {
  if (origin !== 'line-attribution-update') {
    broadcastEvent('yjsupdate', update)
  }
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

    const instance = createP2pmdHttpServer({ httpImpl: await getBareHttp() })

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

export function createP2pmdHttpServer ({ httpImpl } = {}) {
  if (!httpImpl?.createServer) {
    throw new Error('P2PMD HTTP server requires an HTTP implementation.')
  }

  if (eventClients.size === 0) resetPeerState()
  return httpImpl.createServer(handleRequest)
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

async function getBareHttp () {
  if (!bareHttp) {
    const module = await import('bare-http1')
    bareHttp = module.default || module
  }

  return bareHttp
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
      peers: getPeerCount(),
      peerList: getPeerList(),
      activityCount: getPeerActivity().length
    })
    return
  }

  if (req.method === 'POST' && pathname === '/presence') {
    readJsonBody(req)
      .then((body) => {
        upsertPeerPresence(body)
        broadcastPeerState()
        sendJson(res, 200, {
          ok: true,
          peers: getPeerCount()
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

  if (req.method === 'GET' && pathname === '/activity') {
    sendJson(res, 200, {
      ok: true,
      activity: getPeerActivity(150)
    })
    return
  }

  if (req.method === 'GET' && pathname === '/lib/yjs.min.js') {
    sendScript(res, 200, yjsBrowserScript)
    return
  }

  if (req.method === 'GET' && pathname === '/hyper/file') {
    const url = getQueryParam(req.url, 'url')
    readHyperFile({ url })
      .then((result) => {
        if (!result.ok) {
          sendJson(res, result.status || 400, {
            ok: false,
            error: result.error || 'Unable to read Hyper file'
          })
          return
        }

        sendBinary(res, result.status || 200, result.bytes, result.contentType)
      })
      .catch((error) => {
        sendJson(res, 400, {
          ok: false,
          error: error.message
        })
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
        const result = applyDocumentUpdate(body.update, body.lineAttributions ?? body.lineAuthors)
        if (result.ok) {
          const peerKey = upsertPeerPresence(body)
          broadcastPeerState()
          scheduleEditActivity(peerKey, body)
        }
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
        const result = updateDocumentState(body.content, body.lineAttributions ?? body.lineAuthors)
        if (result.ok) {
          const peerKey = upsertPeerPresence(body)
          broadcastPeerState()
          scheduleEditActivity(peerKey, body)
        }
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

        const rendered = body.mode === 'slides'
          ? renderMarkdownSlides(body.content)
          : {
              html: renderMarkdownPreview(body.content),
              ieee: body.latexModeEnabled === true && hasIeeeMarker(body.content)
            }

        sendJson(res, 200, {
          ok: true,
          ...rendered
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
    openEventStream(req, res)
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

function sendScript (res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  setCorsHeaders(res)
  res.setHeader('Connection', 'close')
  res.end(body)
}

function sendBinary (res, statusCode, body, contentType = 'application/octet-stream') {
  res.statusCode = statusCode
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
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

function openEventStream (req, res) {
  const peerPayload = readPeerFromEventRequest(req)

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  setCorsHeaders(res)
  res.flushHeaders()

  const client = {
    res,
    peerKey: upsertPeerPresence(peerPayload)
  }

  eventClients.add(client)
  writeEvent(res, 'peers', String(getPeerCount()))
  writeEvent(res, 'yjsupdate', getEncodedDocumentState())
  writeEvent(res, 'update', JSON.stringify(getDocumentState()))
  writeEvent(res, 'peerlist', JSON.stringify(getPeerList()))
  writeEvent(res, 'activity', JSON.stringify(getPeerActivity(100)))
  const joinActivity = peerActivity.add({
    ...peerPayload,
    type: 'join'
  })
  broadcastPeerState()
  broadcastActivity(joinActivity)

  res.on('close', () => {
    removeEventClient(client)
  })

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
      client.res.write(payload)
    } catch (error) {
      console.error('[p2pmd] Removing SSE client after write failure:', error)
      if (removeEventClient(client, false)) removed = true
    }
  }

  if (removed && eventClients.size > 0) broadcastPeerState()

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

  for (const client of [...eventClients]) {
    removeEventClient(client, false)
  }
  resetPeerState()
}

function removeEventClient (client, shouldBroadcast = true) {
  const departingPeer = getPeerByKey(client.peerKey)
  const deleted = eventClients.delete(client)

  try {
    client.res.end()
  } catch {}

  const peerRemoved = deleted && prunePeerPresence(client.peerKey)

  if (peerRemoved) {
    const editTimer = editActivityTimers.get(client.peerKey)
    if (editTimer) clearTimeout(editTimer)
    editActivityTimers.delete(client.peerKey)
  }

  if (deleted && shouldBroadcast) {
    broadcastPeerState()
    if (peerRemoved && departingPeer) {
      broadcastActivity(peerActivity.add({
        ...departingPeer,
        type: 'leave'
      }))
    }
  }

  if (eventClients.size === 0 && keepaliveInterval) {
    clearInterval(keepaliveInterval)
    keepaliveInterval = null
  }

  return deleted
}

function prunePeerPresence (peerKey) {
  return peerPresence.prune(peerKey, getActivePeerKeys())
}

function broadcastPeerState () {
  broadcastEvent('peers', String(getPeerCount()))
  broadcastEvent('peerlist', JSON.stringify(getPeerList()))
}

function broadcastActivity (activity) {
  if (!activity) return
  broadcastEvent('activity', JSON.stringify(activity))
}

function getPeerList () {
  return peerPresence.getPeerList(getActivePeerKeys())
}

function getPeerByKey (peerKey) {
  if (!peerKey) return null
  return peerPresence.getPeerList(new Set([peerKey]))[0] || null
}

function getPeerActivity (limit) {
  return peerActivity.getActivity(limit)
}

function getPeerCount () {
  return peerPresence.getPeerCount(getActivePeerKeys())
}

function getActivePeerKeys () {
  const activePeerKeys = new Set()

  for (const client of eventClients) {
    if (client.peerKey) activePeerKeys.add(client.peerKey)
  }

  return activePeerKeys
}

function readPeerFromEventRequest (req) {
  let params
  try {
    params = new URL(req.url || '/events', 'http://127.0.0.1').searchParams
  } catch {
    params = new URLSearchParams()
  }

  const latexMode = params.get('latexModeEnabled')

  return {
    clientId: params.get('clientId') || undefined,
    role: params.get('role') || undefined,
    name: params.get('name') || undefined,
    color: params.get('color') || undefined,
    latexModeEnabled: latexMode === 'true' ? true : latexMode === 'false' ? false : undefined
  }
}

function upsertPeerPresence (payload) {
  return peerPresence.upsert(payload)
}

function scheduleEditActivity (peerKey, payload = {}) {
  if (!peerKey) return
  const existing = editActivityTimers.get(peerKey)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    editActivityTimers.delete(peerKey)
    const activePeer = getPeerByKey(peerKey)
    const peer = activePeer || payload
    broadcastActivity(peerActivity.add({
      ...peer,
      cursorLine: payload.cursorLine ?? peer?.cursorLine,
      cursorColumn: payload.cursorColumn ?? peer?.cursorColumn,
      type: 'edit'
    }))
    if (activePeer) {
      upsertPeerPresence({ ...activePeer, isTyping: false })
      broadcastPeerState()
    }
  }, EDIT_ACTIVITY_DEBOUNCE_MS)
  editActivityTimers.set(peerKey, timer)
}

function resetPeerState () {
  for (const timer of editActivityTimers.values()) clearTimeout(timer)
  editActivityTimers.clear()
  peerPresence.clear()
  peerActivity.clear()
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

function getQueryParam (rawUrl, key) {
  try {
    const parsed = new URL(String(rawUrl || '/'), 'http://127.0.0.1')
    return parsed.searchParams.get(key) || ''
  } catch {
    return ''
  }
}

export function getP2pmdEditorPage () {
  const serializedTemplates = JSON.stringify(P2PMD_TEMPLATES).replace(/</g, '\\u003c')
  const embeddedIeeeBrowserScript = ieeeBrowserScript.replace(/<\/script/gi, '<\\/script')

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
        --editor-font-size: 16px;
        --editor-line-height: 24.8px;
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
      body.preview-mode {
        height: auto;
        min-height: 100vh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
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
      body.preview-mode .app-shell {
        height: auto;
        min-height: 100vh;
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
      body.preview-mode .editor-card {
        min-height: 100vh;
      }
      .editor-frame {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr);
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
        font: var(--editor-font-size)/var(--editor-line-height) var(--editor-font);
        text-align: right;
      }
      .gutter-line {
        box-sizing: border-box;
        min-height: var(--editor-line-height);
        padding: 0 6px 0 3px;
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
        padding: 14px 8px;
        border: 0;
        border-radius: 0;
        background: var(--panel-deep);
        color: var(--ink);
        caret-color: var(--remote);
        font: var(--editor-font-size)/var(--editor-line-height) var(--editor-font);
        white-space: pre;
        overflow-wrap: normal;
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
      body.preview-mode #preview {
        flex: none;
        min-height: 100vh;
        overflow: visible;
        touch-action: pan-y;
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
      #slides-preview {
        position: relative;
        box-sizing: border-box;
        flex: 1;
        min-height: 0;
        background: #f7f7f5;
        color: #202124;
        overflow: hidden;
        touch-action: pan-y;
        -webkit-user-select: text;
        user-select: text;
      }
      #slides-content {
        width: 100%;
        height: 100%;
      }
      #slides-preview .slide {
        box-sizing: border-box;
        display: none;
        width: 100%;
        height: 100%;
        padding: clamp(26px, 7vw, 68px) clamp(54px, 11vw, 100px);
        overflow: auto;
        color: #202124;
        text-align: center;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        animation: slide-enter 180ms ease-out;
        -webkit-overflow-scrolling: touch;
      }
      #slides-preview .slide.active { display: flex; }
      #slides-preview .slide > * { max-width: min(100%, 920px); }
      #slides-preview .slide > :first-child { margin-top: auto; }
      #slides-preview .slide > :last-child { margin-bottom: auto; }
      #slides-preview h1 {
        margin: 0 0 0.65em;
        font-size: clamp(2rem, 8vw, 4.25rem);
        line-height: 1.08;
        letter-spacing: -0.035em;
      }
      #slides-preview h2 {
        margin: 0 0 0.65em;
        font-size: clamp(1.65rem, 6.5vw, 3.35rem);
        line-height: 1.12;
      }
      #slides-preview h3 {
        font-size: clamp(1.35rem, 5vw, 2.5rem);
        line-height: 1.18;
      }
      #slides-preview p,
      #slides-preview ul,
      #slides-preview ol {
        margin-top: 0.55em;
        margin-bottom: 0.55em;
        font-size: clamp(1rem, 3.7vw, 1.55rem);
        line-height: 1.55;
      }
      #slides-preview ul,
      #slides-preview ol { text-align: left; }
      #slides-preview pre {
        box-sizing: border-box;
        width: min(100%, 920px);
        padding: 14px;
        border-radius: 9px;
        background: #202128;
        color: #f1f2f7;
        overflow: auto;
        text-align: left;
      }
      #slides-preview code { font-family: var(--editor-font); }
      #slides-preview :not(pre) > code {
        padding: 0.12em 0.32em;
        border-radius: 5px;
        background: #e4e7ec;
      }
      #slides-preview blockquote {
        margin-right: auto;
        margin-left: auto;
        padding-left: 14px;
        border-left: 4px solid var(--accent);
        text-align: left;
      }
      #slides-preview img,
      #slides-preview video {
        display: block;
        max-width: 100%;
        max-height: 54vh;
        margin: 0.75rem auto;
        object-fit: contain;
      }
      .slides-nav {
        position: absolute;
        top: 50%;
        z-index: 2;
        display: grid;
        width: 44px;
        height: 44px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: rgba(32, 33, 36, 0.12);
        color: #202124;
        font: 700 28px/1 var(--ui-font);
        place-items: center;
        transform: translateY(-50%);
        touch-action: manipulation;
      }
      .slides-nav:disabled { opacity: 0.28; }
      #slides-prev { left: 6px; }
      #slides-next { right: 6px; }
      #slides-progress {
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
        z-index: 2;
        height: 4px;
        background: rgba(32, 33, 36, 0.12);
      }
      #slides-progress-value {
        display: block;
        width: 0;
        height: 100%;
        background: var(--accent);
        transition: width 180ms ease-out;
      }
      #slides-counter {
        position: absolute;
        right: 10px;
        bottom: 12px;
        z-index: 2;
        padding: 5px 9px;
        border-radius: 999px;
        background: rgba(32, 33, 36, 0.1);
        color: #3c4043;
        font: 700 12px/1 var(--ui-font);
      }
      #slides-exit {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 3;
        display: none;
        width: 38px;
        height: 38px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: rgba(32, 33, 36, 0.12);
        color: #202124;
        font: 600 24px/1 var(--ui-font);
        place-items: center;
      }
      #peer-dashboard-backdrop {
        position: fixed;
        inset: 0;
        z-index: 20;
        display: flex;
        align-items: flex-end;
        background: rgba(8, 9, 13, .62);
      }
      #peer-dashboard-backdrop[hidden] { display: none; }
      #peer-dashboard {
        box-sizing: border-box;
        width: 100%;
        max-height: min(86dvh, 760px);
        border: 1px solid #444857;
        border-bottom: 0;
        border-radius: 20px 20px 0 0;
        background: #24262f;
        color: var(--ink);
        box-shadow: 0 -18px 48px rgba(0, 0, 0, .42);
        overflow: hidden;
      }
      .peer-dashboard-handle {
        width: 38px;
        height: 4px;
        margin: 8px auto 2px;
        border-radius: 999px;
        background: #626777;
      }
      .peer-dashboard-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px 12px;
        border-bottom: 1px solid var(--line);
      }
      .peer-dashboard-header h2 {
        margin: 0;
        font: 800 18px/1.25 var(--ui-font);
      }
      #peer-dashboard-close {
        width: 38px;
        height: 38px;
        margin-left: auto;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: #30333e;
        color: var(--ink);
        font: 500 26px/1 var(--ui-font);
      }
      .peer-dashboard-body {
        max-height: calc(min(86dvh, 760px) - 72px);
        padding: 14px;
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
      }
      .peer-dashboard-room {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        margin-bottom: 12px;
      }
      #peer-dashboard-room-key {
        min-width: 0;
        color: #aeb3c3;
        font: 12px/1.4 var(--editor-font);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .peer-role-badge {
        flex: 0 0 auto;
        padding: 3px 8px;
        border-radius: 999px;
        background: #454a58;
        color: #f4f5f8;
        font: 800 10px/1.2 var(--ui-font);
        letter-spacing: .04em;
        text-transform: uppercase;
      }
      .peer-role-badge.host { background: #1d6045; color: #d4f8e8; }
      .peer-role-badge.client { background: #5b421e; color: #ffe0a3; }
      .peer-profile-editor {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        margin-bottom: 12px;
      }
      #peer-display-name {
        min-width: 0;
        height: 42px;
        padding: 0 12px;
        border: 1px solid #464b5a;
        border-radius: 10px;
        background: #1f2027;
        color: var(--ink);
        font: 15px/1 var(--ui-font);
      }
      #peer-display-name-save {
        min-width: 72px;
        border: 0;
        border-radius: 10px;
        background: var(--accent);
        color: #ffffff;
        font: 800 13px/1 var(--ui-font);
      }
      #peer-profile-hint {
        grid-column: 1 / -1;
        min-height: 16px;
        color: #aeb3c3;
        font: 12px/1.3 var(--ui-font);
      }
      #peer-dashboard-stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
        margin-bottom: 18px;
      }
      .peer-stat {
        padding: 9px 4px;
        border-radius: 10px;
        background: #2d303a;
        text-align: center;
      }
      .peer-stat strong,
      .peer-stat span { display: block; }
      .peer-stat strong { font: 800 17px/1.1 var(--ui-font); }
      .peer-stat span { margin-top: 3px; color: #aeb3c3; font: 10px/1.2 var(--ui-font); }
      .peer-dashboard-section { margin-top: 18px; }
      .peer-dashboard-section h3 {
        margin: 0 0 9px;
        font: 800 14px/1.3 var(--ui-font);
      }
      .peer-dashboard-list {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 8px;
      }
      .peer-card {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr) auto;
        gap: 0 10px;
        align-items: center;
        padding: 10px;
        border: 1px solid #3e4250;
        border-radius: 12px;
        background: #292b34;
      }
      .peer-avatar {
        grid-row: 1 / 3;
        display: grid;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        color: #ffffff;
        font: 800 14px/1 var(--ui-font);
        place-items: center;
      }
      .peer-name {
        min-width: 0;
        font: 800 14px/1.3 var(--ui-font);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .peer-position,
      .peer-updated {
        color: #aeb3c3;
        font: 11px/1.35 var(--ui-font);
      }
      .peer-updated { grid-column: 3; grid-row: 2; text-align: right; }
      .peer-empty {
        padding: 14px;
        border: 1px dashed #454a58;
        border-radius: 12px;
        color: #aeb3c3;
        font: 13px/1.4 var(--ui-font);
        text-align: center;
      }
      #peer-activity-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .peer-activity-item {
        padding: 10px 11px;
        border-left: 3px solid #596174;
        border-radius: 0 10px 10px 0;
        background: #292b34;
      }
      .peer-activity-message { font: 600 13px/1.35 var(--ui-font); }
      .peer-activity-meta { margin-top: 4px; color: #aeb3c3; font: 11px/1.3 var(--ui-font); }
      @media (min-width: 680px) {
        #peer-dashboard { max-width: 680px; margin: 0 auto; border-radius: 20px 20px 0 0; }
        .peer-dashboard-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @keyframes slide-enter {
        from { opacity: 0; transform: translateX(12px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @media (orientation: landscape) {
        #slides-exit { display: grid; }
        #slides-preview .slide {
          overflow: visible;
          transform-origin: top center;
          animation: none;
        }
      }
      @media (orientation: landscape) and (max-height: 520px) {
        #slides-preview .slide {
          padding-top: 20px;
          padding-bottom: 24px;
        }
        #slides-preview img,
        #slides-preview video { max-height: 46vh; }
      }
      @media (prefers-reduced-motion: reduce) {
        #slides-preview .slide { animation: none; }
        #slides-progress-value { transition: none; }
      }
      #formatting-toolbar {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px 8px;
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
      #formatting-toolbar button[aria-pressed="true"] {
        border-color: rgba(89, 166, 255, .5);
        background: #263d5e;
        color: #8fc1ff;
      }
      #latex-toolbar-group { display: contents; }
      #latex-template-menu {
        position: absolute;
        z-index: 8;
        top: 46px;
        right: 8px;
        left: 8px;
        padding: 6px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: #292b35;
        box-shadow: 0 10px 28px rgba(0, 0, 0, .38);
      }
      #latex-template-menu button {
        display: block;
        width: 100%;
        padding: 10px 12px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--ink);
        text-align: left;
      }
      #latex-template-menu button:active { background: #353844; }
      .template-label { display: block; font: 700 14px/1.3 var(--ui-font); }
      .template-description { display: block; margin-top: 2px; color: #aeb3c3; font: 12px/1.35 var(--ui-font); }
      .latex-mode-symbol { font-size: 20px; font-weight: 500; }
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
      ${katexCss}
      ${P2PMD_SCIENTIFIC_STYLES}
    </style>
    <script>${embeddedIeeeBrowserScript}</script>
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
          <div class="toolbar-divider" aria-hidden="true"></div>
          <button type="button" data-format="latex" title="LaTeX mode" aria-label="LaTeX mode" aria-pressed="false">
            <span class="latex-mode-symbol" aria-hidden="true">&#8734;</span>
          </button>
          <span id="latex-toolbar-group" hidden>
            <button type="button" data-format="inline-math" title="Inline math" aria-label="Inline math">$x$</button>
            <button type="button" data-format="block-math" title="Block math" aria-label="Block math">$$</button>
            <button type="button" data-format="template" title="Scientific templates" aria-label="Scientific templates">T</button>
          </span>
          <div class="toolbar-divider" aria-hidden="true"></div>
          <button type="button" data-format="slides" title="View as slides" aria-label="View as slides">
            <svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zm0-1h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M2 6h12v1H2zm0 3h12v1H2z"/><circle cx="5" cy="4.5" r=".8"/><circle cx="8" cy="4.5" r=".8"/><circle cx="11" cy="4.5" r=".8"/></svg>
          </button>
        </div>
        <div id="latex-template-menu" role="menu" aria-label="Scientific templates" hidden></div>
        <input id="image-upload-input" type="file" accept="image/*" hidden />
        <div class="editor-frame">
          <div id="line-gutter-wrap" aria-hidden="true">
            <div id="line-gutter"></div>
          </div>
          <textarea id="document-input" aria-label="Markdown document" placeholder="Write Markdown here..." wrap="off"></textarea>
        </div>
        <article id="preview" aria-label="Markdown preview" hidden></article>
        <section id="slides-preview" aria-label="Presentation slides" hidden>
          <div id="slides-content"></div>
          <button id="slides-exit" type="button" aria-label="Exit presentation">&times;</button>
          <button id="slides-prev" class="slides-nav" type="button" aria-label="Previous slide">&#8249;</button>
          <button id="slides-next" class="slides-nav" type="button" aria-label="Next slide">&#8250;</button>
          <div id="slides-counter" role="status" aria-live="polite"></div>
          <div id="slides-progress" aria-hidden="true"><span id="slides-progress-value"></span></div>
        </section>
      </main>
    </div>
    <div id="peer-dashboard-backdrop" hidden>
      <section id="peer-dashboard" role="dialog" aria-modal="true" aria-labelledby="peer-dashboard-title">
        <div class="peer-dashboard-handle" aria-hidden="true"></div>
        <header class="peer-dashboard-header">
          <h2 id="peer-dashboard-title">Room peers</h2>
          <button id="peer-dashboard-close" type="button" aria-label="Close peer dashboard">&times;</button>
        </header>
        <div class="peer-dashboard-body">
          <div class="peer-dashboard-room">
            <span id="peer-dashboard-role" class="peer-role-badge"></span>
            <code id="peer-dashboard-room-key"></code>
          </div>
          <div class="peer-profile-editor">
            <input id="peer-display-name" type="text" maxlength="32" aria-label="Username" placeholder="Username" />
            <button id="peer-display-name-save" type="button">Update</button>
            <span id="peer-profile-hint" role="status" aria-live="polite"></span>
          </div>
          <div id="peer-dashboard-stats"></div>
          <section class="peer-dashboard-section">
            <h3>Connected peers</h3>
            <div id="peer-connected-list" class="peer-dashboard-list"></div>
          </section>
          <section class="peer-dashboard-section">
            <h3>Currently editing</h3>
            <div id="peer-editing-list" class="peer-dashboard-list"></div>
          </section>
          <section class="peer-dashboard-section">
            <h3>Edit history</h3>
            <ul id="peer-activity-list"></ul>
          </section>
        </div>
      </section>
    </div>
    <script>
      const input = document.getElementById('document-input')
      const preview = document.getElementById('preview')
      const slidesPreview = document.getElementById('slides-preview')
      const slidesContent = document.getElementById('slides-content')
      const slidesExit = document.getElementById('slides-exit')
      const slidesPrevious = document.getElementById('slides-prev')
      const slidesNext = document.getElementById('slides-next')
      const slidesCounter = document.getElementById('slides-counter')
      const slidesProgress = document.getElementById('slides-progress-value')
      const formattingToolbar = document.getElementById('formatting-toolbar')
      const latexModeButton = formattingToolbar.querySelector('[data-format="latex"]')
      const latexToolbarGroup = document.getElementById('latex-toolbar-group')
      const latexTemplateMenu = document.getElementById('latex-template-menu')
      const imageUploadInput = document.getElementById('image-upload-input')
      const lineGutter = document.getElementById('line-gutter')
      const peerDashboardBackdrop = document.getElementById('peer-dashboard-backdrop')
      const peerDashboardClose = document.getElementById('peer-dashboard-close')
      const peerDashboardRole = document.getElementById('peer-dashboard-role')
      const peerDashboardRoomKey = document.getElementById('peer-dashboard-room-key')
      const peerDisplayName = document.getElementById('peer-display-name')
      const peerDisplayNameSave = document.getElementById('peer-display-name-save')
      const peerProfileHint = document.getElementById('peer-profile-hint')
      const peerDashboardStats = document.getElementById('peer-dashboard-stats')
      const peerConnectedList = document.getElementById('peer-connected-list')
      const peerEditingList = document.getElementById('peer-editing-list')
      const peerActivityList = document.getElementById('peer-activity-list')
      const TOOLBAR_TAP_MOVEMENT_LIMIT = 8
      const REMOTE_UPDATE_BATCH_MS = 80
      const ACTIVE_VIEW_RENDER_DELAY_MS = 120
      const INITIAL_ROOM_RETRY_ATTEMPTS = 20
      const INITIAL_ROOM_RETRY_DELAY_MS = 750
      const MAX_PENDING_UPDATE_BYTES = 2 * 1024 * 1024
      const Y_ORIGIN_REMOTE = 'remote-sse'
      const Y_ORIGIN_LOCAL_INPUT = 'local-input'
      const Y_ORIGIN_LOCAL_SETTINGS = 'local-settings'
      const LATEX_MODE_STORAGE_KEY = 'p2pmd-latex-mode-enabled'
      const LATEX_MODE_YJS_KEY = 'latexModeEnabled'
      const PEER_DISPLAY_NAME_KEY = 'p2pmd-display-name'
      const MAX_PEER_ACTIVITY_ITEMS = 150
      const MAX_PEER_DASHBOARD_ITEMS = 100
      const PEER_TYPING_IDLE_MS = ${EDIT_ACTIVITY_DEBOUNCE_MS}
      const templates = ${serializedTemplates}
      let viewMode = 'edit'
      let previewRequestId = 0
      let currentSlideIndex = 0
      let slideTouchStart = null
      let slideFitFrame = null
      let activeViewRenderTimer = null
      let activeViewRenderInFlight = false
      let activeViewRenderPending = false
      let bridgeRequestId = 0
      const bridgeRequests = new Map()
      let saveTimer = null
      let pendingContent = null
      let saveInFlight = false
      let ydoc = null
      let ytext = null
      let ysettings = null
      let pendingUpdate = null
      let sendUpdateTimer = null
      let flushRetryTimer = null
      let eventSource = null
      let reconnectTimer = null
      let isApplyingRemote = false
      let pendingRemoteUpdate = null
      let remoteUpdateTimer = null
      let lastSyncedContent = ''
      let lastInputContent = ''
      let lineAttributions = {}
      let localLineAttributions = {}
      let latestPeerList = []
      let peerActivityLog = []
      let peerActivityLoadError = ''
      let peerDashboardDirty = true
      let localPeerIsTyping = false
      let localTypingResetTimer = null
      let toolbarPointerState = null
      let suppressToolbarClick = false
      let pendingImageSelection = null
      const newline = String.fromCharCode(10)
      const CLIENT_ID_KEY = 'p2pmd-mobile-client-id'
      const clientId = getClientId()
      const roomRole = getRoomRole()
      let latexModeEnabled = roomRole === 'host' && loadPersistedLatexMode()
      let hasSyncedHostLatexMode = false
      const localAuthor = {
        clientId,
        color: colorFromClientId(clientId),
        name: loadPeerDisplayName() || 'Mobile peer'
      }
      const roomBaseUrl = getRoomBaseUrl()

      function getRoomKey() {
        return typeof window.__P2PMD_ROOM_KEY__ === 'string'
          ? window.__P2PMD_ROOM_KEY__.trim()
          : ''
      }

      function getRoomBaseUrl() {
        try {
          const configured = typeof window.__P2PMD_ROOM_BASE_URL__ === 'string'
            ? window.__P2PMD_ROOM_BASE_URL__.trim()
            : ''
          if (configured) return configured.replace(/\\/$/, '')

          const current = new URL(window.location.href)
          if (current.origin && current.origin !== 'null') return current.origin
        } catch {}

        return ''
      }

      function roomUrl(path) {
        if (!roomBaseUrl) return path
        return roomBaseUrl + path
      }

      function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms))
      }

      async function withInitialRoomRetry(operation) {
        let lastError = null

        for (let attempt = 0; attempt < INITIAL_ROOM_RETRY_ATTEMPTS; attempt++) {
          try {
            return await operation()
          } catch (error) {
            lastError = error
            if (attempt === INITIAL_ROOM_RETRY_ATTEMPTS - 1) break
            await delay(INITIAL_ROOM_RETRY_DELAY_MS)
          }
        }

        throw lastError || new Error('Room request failed')
      }

      function loadScript(src) {
        return new Promise((resolve, reject) => {
          const script = document.createElement('script')
          script.src = src
          script.onload = resolve
          script.onerror = () => {
            script.remove()
            reject(new Error('Unable to load script: ' + src))
          }
          document.head.appendChild(script)
        })
      }

      function loadYjsRuntime() {
        if (window.Y) return Promise.resolve()

        return withInitialRoomRetry(() => loadScript(roomUrl('/lib/yjs.min.js')))
      }

      function getRoomRole() {
        try {
          const role = new URLSearchParams(window.location.search).get('role')
          return role === 'host' ? 'host' : 'client'
        } catch {
          return 'client'
        }
      }

      function getClientId() {
        try {
          const stored = window.localStorage.getItem(CLIENT_ID_KEY)
          if (stored) return stored

          const generated = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
          window.localStorage.setItem(CLIENT_ID_KEY, generated)
          return generated
        } catch {
          return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
        }
      }

      function normalizeDisplayName(value) {
        if (typeof value !== 'string') return ''
        return Array.from(value.trim().replace(/\\s+/g, ' ')).slice(0, 32).join('')
      }

      function loadPeerDisplayName() {
        const injectedName = normalizeDisplayName(window.__P2PMD_DISPLAY_NAME__)
        if (injectedName) return injectedName
        try {
          return normalizeDisplayName(window.localStorage.getItem(PEER_DISPLAY_NAME_KEY) || '')
        } catch {
          return ''
        }
      }

      function persistPeerDisplayName(value) {
        try {
          window.localStorage.setItem(PEER_DISPLAY_NAME_KEY, value)
        } catch {}
      }

      function loadPersistedLatexMode() {
        try {
          return window.localStorage.getItem(LATEX_MODE_STORAGE_KEY) === 'true'
        } catch {
          return false
        }
      }

      function persistLatexMode(enabled) {
        try {
          window.localStorage.setItem(LATEX_MODE_STORAGE_KEY, String(enabled))
        } catch {}
      }

      function updateLatexControls() {
        latexModeButton?.setAttribute('aria-pressed', String(latexModeEnabled))
        if (latexModeButton) {
          latexModeButton.disabled = roomRole !== 'host'
          latexModeButton.title = roomRole === 'host'
            ? 'LaTeX mode'
            : 'LaTeX mode is controlled by the host'
        }
        if (latexToolbarGroup) latexToolbarGroup.hidden = !latexModeEnabled
        if (!latexModeEnabled && latexTemplateMenu) latexTemplateMenu.hidden = true
      }

      function setLatexMode(enabled, { persist = true, sync = true, fromSharedState = false } = {}) {
        if (roomRole !== 'host' && !fromSharedState) return false

        const nextEnabled = enabled === true
        latexModeEnabled = nextEnabled
        updateLatexControls()
        if (persist && roomRole === 'host') persistLatexMode(nextEnabled)

        if (
          sync &&
          roomRole === 'host' &&
          ysettings &&
          ysettings.get(LATEX_MODE_YJS_KEY) !== nextEnabled
        ) {
          ydoc.transact(() => {
            ysettings.set(LATEX_MODE_YJS_KEY, nextEnabled)
          }, Y_ORIGIN_LOCAL_SETTINGS)
        }

        scheduleActiveViewRender()
        return true
      }

      function colorFromClientId(value) {
        let hash = 0
        for (let index = 0; index < value.length; index++) {
          hash = ((hash << 5) - hash) + value.charCodeAt(index)
          hash |= 0
        }

        const hue = Math.abs(hash) % 360
        return 'hsl(' + hue + ' 74% 58%)'
      }

      function normalizeDashboardPeer(peer) {
        if (!peer || typeof peer !== 'object') return null
        const role = peer.role === 'host' ? 'host' : peer.role === 'client' ? 'client' : 'viewer'
        const clientIdValue = typeof peer.clientId === 'string' ? peer.clientId.slice(0, 120) : ''
        const id = Number.isFinite(Number(peer.id)) ? Number(peer.id) : null
        const name = normalizeDisplayName(peer.name) || (id ? 'Peer #' + id : 'Peer')

        return {
          id,
          role,
          clientId: clientIdValue,
          name,
          color: typeof peer.color === 'string' && peer.color.length <= 64 ? peer.color : '#64748b',
          isTyping: peer.isTyping === true,
          cursorLine: Number.isFinite(Number(peer.cursorLine)) ? Number(peer.cursorLine) : null,
          cursorColumn: Number.isFinite(Number(peer.cursorColumn)) ? Number(peer.cursorColumn) : null,
          updatedAt: Number.isFinite(Number(peer.updatedAt)) ? Number(peer.updatedAt) : Date.now()
        }
      }

      function normalizeDashboardActivity(activity) {
        if (!activity || typeof activity !== 'object') return null
        return {
          id: Number.isFinite(Number(activity.id)) ? Number(activity.id) : null,
          type: typeof activity.type === 'string' ? activity.type.slice(0, 24) : 'event',
          name: normalizeDisplayName(activity.name) || 'Peer',
          clientId: typeof activity.clientId === 'string' ? activity.clientId.slice(0, 120) : '',
          message: typeof activity.message === 'string' && activity.message.trim()
            ? activity.message.trim().slice(0, 240)
            : 'Activity updated',
          timestamp: Number.isFinite(Number(activity.timestamp)) ? Number(activity.timestamp) : Date.now()
        }
      }

      function formatPeerTime(timestamp) {
        try {
          return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        } catch {
          return ''
        }
      }

      function clearPeerDashboardNode(node) {
        while (node?.firstChild) node.removeChild(node.firstChild)
      }

      function appendPeerDashboardEmpty(container, message) {
        const empty = document.createElement(container.tagName === 'UL' ? 'li' : 'div')
        empty.className = 'peer-empty'
        empty.textContent = message
        container.appendChild(empty)
      }

      function createPeerRoleBadge(role) {
        const badge = document.createElement('span')
        badge.className = 'peer-role-badge ' + role
        badge.textContent = role
        return badge
      }

      function createPeerCard(peer) {
        const card = document.createElement('article')
        card.className = 'peer-card'

        const avatar = document.createElement('span')
        avatar.className = 'peer-avatar'
        avatar.style.backgroundColor = peer.color
        avatar.textContent = peer.name.charAt(0).toUpperCase()

        const name = document.createElement('strong')
        name.className = 'peer-name'
        name.textContent = peer.clientId && peer.clientId === clientId
          ? peer.name + ' (You)'
          : peer.name

        const position = document.createElement('span')
        position.className = 'peer-position'
        if (peer.cursorLine && peer.cursorColumn) {
          position.textContent = peer.isTyping
            ? 'Editing line ' + peer.cursorLine + ', col ' + peer.cursorColumn
            : 'Cursor at line ' + peer.cursorLine + ', col ' + peer.cursorColumn
        } else {
          position.textContent = peer.isTyping ? 'Editing...' : 'Idle'
        }

        const updated = document.createElement('span')
        updated.className = 'peer-updated'
        updated.textContent = formatPeerTime(peer.updatedAt)

        card.appendChild(avatar)
        card.appendChild(name)
        card.appendChild(createPeerRoleBadge(peer.role))
        card.appendChild(position)
        card.appendChild(updated)
        return card
      }

      function renderPeerCards(container, peers, emptyMessage) {
        clearPeerDashboardNode(container)
        if (peers.length === 0) {
          appendPeerDashboardEmpty(container, emptyMessage)
          return
        }
        peers.forEach((peer) => container.appendChild(createPeerCard(peer)))
      }

      function renderPeerDashboard() {
        peerDashboardDirty = true
        if (peerDashboardBackdrop.hidden) return

        peerDashboardDirty = false
        const peers = []
        const editingPeers = []
        let totalPeers = 0
        let hostPeers = 0
        let clientPeers = 0
        let totalEditingPeers = 0
        latestPeerList.forEach((value) => {
          const peer = normalizeDashboardPeer(value)
          if (!peer) return
          totalPeers += 1
          if (peer.role === 'host') hostPeers += 1
          if (peer.role === 'client') clientPeers += 1
          if (peers.length < MAX_PEER_DASHBOARD_ITEMS) peers.push(peer)
          if (peer.isTyping) {
            totalEditingPeers += 1
            if (editingPeers.length < MAX_PEER_DASHBOARD_ITEMS) editingPeers.push(peer)
          }
        })
        const stats = [
          ['Total', totalPeers],
          ['Hosts', hostPeers],
          ['Clients', clientPeers],
          ['Editing', totalEditingPeers]
        ]

        peerDashboardRole.textContent = roomRole
        peerDashboardRole.className = 'peer-role-badge ' + roomRole
        peerDashboardRoomKey.textContent = getRoomKey() || roomBaseUrl || 'Room connected'
        clearPeerDashboardNode(peerDashboardStats)
        stats.forEach(([label, value]) => {
          const item = document.createElement('div')
          item.className = 'peer-stat'
          const count = document.createElement('strong')
          count.textContent = String(value)
          const caption = document.createElement('span')
          caption.textContent = label
          item.appendChild(count)
          item.appendChild(caption)
          peerDashboardStats.appendChild(item)
        })

        renderPeerCards(peerConnectedList, peers, 'No connected peers yet.')
        renderPeerCards(peerEditingList, editingPeers, 'Nobody is actively editing right now.')
        if (totalPeers > peers.length) {
          appendPeerDashboardEmpty(peerConnectedList, 'Showing the first ' + peers.length + ' connected peers.')
        }
        if (totalEditingPeers > editingPeers.length) {
          appendPeerDashboardEmpty(peerEditingList, 'Showing the first ' + editingPeers.length + ' active editors.')
        }
        clearPeerDashboardNode(peerActivityList)
        if (peerActivityLog.length === 0) {
          appendPeerDashboardEmpty(peerActivityList, peerActivityLoadError || 'No activity yet.')
          return
        }

        const peerNameByClientId = new Map(
          peers.filter((peer) => peer.clientId).map((peer) => [peer.clientId, peer.name])
        )
        peerActivityLog.slice(0, MAX_PEER_ACTIVITY_ITEMS).forEach((activity) => {
          const item = document.createElement('li')
          item.className = 'peer-activity-item'
          const message = document.createElement('div')
          message.className = 'peer-activity-message'
          const currentName = peerNameByClientId.get(activity.clientId) || activity.name
          message.textContent = activity.name !== currentName && activity.message.startsWith(activity.name + ' ')
            ? currentName + activity.message.slice(activity.name.length)
            : activity.message
          const meta = document.createElement('div')
          meta.className = 'peer-activity-meta'
          meta.textContent = currentName + ' | ' + activity.type + ' | ' + formatPeerTime(activity.timestamp)
          item.appendChild(message)
          item.appendChild(meta)
          peerActivityList.appendChild(item)
        })
        if (peerActivityLoadError) appendPeerDashboardEmpty(peerActivityList, peerActivityLoadError)
      }

      function mergePeerActivity(activity) {
        const isSnapshot = Array.isArray(activity)
        const incoming = (Array.isArray(activity) ? activity : [activity])
          .map(normalizeDashboardActivity)
          .filter(Boolean)
        if (isSnapshot) {
          peerActivityLog = incoming
            .sort((left, right) => right.timestamp - left.timestamp)
            .slice(0, MAX_PEER_ACTIVITY_ITEMS)
          peerActivityLoadError = ''
          renderPeerDashboard()
          return
        }
        if (incoming.length === 0) return

        const keys = new Set(incoming.map((item) => String(item.id) + ':' + item.timestamp))
        peerActivityLog = incoming.concat(
          peerActivityLog.filter((item) => !keys.has(String(item.id) + ':' + item.timestamp))
        )
          .sort((left, right) => right.timestamp - left.timestamp)
          .slice(0, MAX_PEER_ACTIVITY_ITEMS)
        renderPeerDashboard()
      }

      async function refreshPeerActivity() {
        try {
          const response = await fetch(roomUrl('/activity'))
          const body = await response.json()
          if (!response.ok || !Array.isArray(body.activity)) {
            throw new Error('Unable to refresh room activity')
          }
          peerActivityLog = body.activity
            .map(normalizeDashboardActivity)
            .filter(Boolean)
            .slice(0, MAX_PEER_ACTIVITY_ITEMS)
          peerActivityLoadError = ''
          renderPeerDashboard()
        } catch {
          peerActivityLoadError = 'Unable to refresh room activity.'
          renderPeerDashboard()
        }
      }

      function setPeerDashboardVisible(visible) {
        const shouldShow = visible === true
        peerDashboardBackdrop.hidden = !shouldShow
        peerDashboardBackdrop.setAttribute('aria-hidden', String(!shouldShow))
        if (!shouldShow) {
          peerProfileHint.textContent = ''
          return
        }

        input.blur()
        peerDisplayName.value = localAuthor.name
        if (peerDashboardDirty) renderPeerDashboard()
        refreshPeerActivity()
        peerDashboardClose.focus()
      }

      async function updatePeerDisplayName() {
        const nextName = normalizeDisplayName(peerDisplayName.value)
        if (!nextName) {
          peerProfileHint.textContent = 'Username cannot be empty.'
          return
        }

        peerDisplayNameSave.disabled = true
        peerProfileHint.textContent = 'Updating...'

        try {
          const response = await fetch(roomUrl('/presence'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getPeerPayload(), name: nextName })
          })
          if (!response.ok) throw new Error('Unable to update username')
          localAuthor.name = nextName
          persistPeerDisplayName(nextName)
          latestPeerList = latestPeerList.map((peer) => {
            return peer?.clientId === clientId ? { ...peer, name: nextName } : peer
          })
          renderPeerDashboard()

          try {
            await requestNativeBridge('peer-profile', { name: nextName })
            peerProfileHint.textContent = 'Saved'
          } catch {
            peerProfileHint.textContent = 'Updated for this room, but could not save for future rooms.'
          }
        } catch (error) {
          peerProfileHint.textContent = error?.message || 'Unable to update username'
        } finally {
          peerDisplayNameSave.disabled = false
        }
      }

      function notifyNative(type, details) {
        if (!window.ReactNativeWebView) return

        window.ReactNativeWebView.postMessage(JSON.stringify({
          type,
          source: 'bare-http1',
          ...details
        }))
      }

      function notifyDocumentError(error, phase) {
        notifyNative('p2pmd-document-error', {
          error: error && error.message ? error.message : String(error || 'Unknown document error'),
          phase,
          stack: error && error.stack ? String(error.stack).slice(0, 2000) : ''
        })
      }

      function callNativeBridge(action, payload) {
        if (!window.ReactNativeWebView) {
          return Promise.reject(new Error('Native bridge is unavailable'))
        }

        const requestId = 'bridge-' + (++bridgeRequestId)
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            bridgeRequests.delete(requestId)
            reject(new Error('Native bridge request timed out'))
          }, 30000)

          bridgeRequests.set(requestId, {
            resolve,
            reject,
            timeout
          })

          notifyNative('p2pmd-bridge-request', {
            requestId,
            action,
            payload
          })
        })
      }

      window.__p2pmdResolveBridgeRequest = function(requestId, result) {
        const request = bridgeRequests.get(requestId)
        if (!request) return

        bridgeRequests.delete(requestId)
        clearTimeout(request.timeout)

        if (!result || result.ok !== true) {
          request.reject(new Error(result && result.error ? result.error : 'Native bridge request failed'))
          return
        }

        request.resolve(result)
      }

      function getPeerPayload() {
        const cursor = getEditorCursorPosition()
        return {
          clientId,
          role: roomRole,
          name: localAuthor.name,
          color: localAuthor.color,
          latexModeEnabled,
          isTyping: localPeerIsTyping,
          cursorLine: cursor.line,
          cursorColumn: cursor.column
        }
      }

      function getEditorCursorPosition() {
        const offset = Number.isFinite(input.selectionStart) ? input.selectionStart : 0
        const beforeCursor = input.value.slice(0, offset)
        const lineStart = beforeCursor.lastIndexOf(newline) + 1
        return {
          line: beforeCursor.split(newline).length,
          column: offset - lineStart + 1
        }
      }

      function markLocalPeerTyping() {
        localPeerIsTyping = true
        if (localTypingResetTimer) clearTimeout(localTypingResetTimer)
        localTypingResetTimer = setTimeout(() => {
          localTypingResetTimer = null
          localPeerIsTyping = false
        }, PEER_TYPING_IDLE_MS)
      }

      function bytesToBase64(bytes) {
        let binary = ''
        for (let index = 0; index < bytes.byteLength; index++) {
          binary += String.fromCharCode(bytes[index])
        }
        return btoa(binary)
      }

      function base64ToBytes(value) {
        const binary = atob(value)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index++) {
          bytes[index] = binary.charCodeAt(index)
        }
        return bytes
      }

      function queueRemoteYjsUpdate(encodedUpdate) {
        if (!ydoc || !window.Y) return

        try {
          const update = base64ToBytes(encodedUpdate)
          pendingRemoteUpdate = pendingRemoteUpdate
            ? window.Y.mergeUpdates([pendingRemoteUpdate, update])
            : update
        } catch (error) {
          notifyDocumentError(error, 'editor-error')
          return
        }

        if (remoteUpdateTimer) return
        remoteUpdateTimer = setTimeout(() => {
          remoteUpdateTimer = null
          applyPendingRemoteYjsUpdate()
        }, REMOTE_UPDATE_BATCH_MS)
      }

      function applyPendingRemoteYjsUpdate() {
        if (!pendingRemoteUpdate || !ydoc || !window.Y) return

        const update = pendingRemoteUpdate
        pendingRemoteUpdate = null

        try {
          isApplyingRemote = true
          window.Y.applyUpdate(ydoc, update, Y_ORIGIN_REMOTE)
        } catch (error) {
          notifyDocumentError(error, 'editor-error')
        } finally {
          isApplyingRemote = false
        }
      }

      function applyTextDiff(ytextRef, oldText, newText, origin) {
        if (!ytextRef || oldText === newText) return

        let prefix = 0
        const minLength = Math.min(oldText.length, newText.length)
        while (prefix < minLength && oldText[prefix] === newText[prefix]) prefix += 1

        let oldSuffix = oldText.length
        let newSuffix = newText.length
        while (
          oldSuffix > prefix &&
          newSuffix > prefix &&
          oldText[oldSuffix - 1] === newText[newSuffix - 1]
        ) {
          oldSuffix -= 1
          newSuffix -= 1
        }

        const deleteLength = oldSuffix - prefix
        const insertedText = newText.slice(prefix, newSuffix)

        ytextRef.doc.transact(() => {
          if (deleteLength > 0) ytextRef.delete(prefix, deleteLength)
          if (insertedText) ytextRef.insert(prefix, insertedText)
        }, origin)
      }

      async function loadDocument() {
        try {
          const result = await withInitialRoomRetry(async () => {
            const response = await fetch(roomUrl('/doc'))
            const body = await response.json()

            if (!response.ok || typeof body.content !== 'string') {
              throw new Error(body.error || 'Unable to load document')
            }

            return body
          })

          input.value = result.content
          lastSyncedContent = result.content
          lastInputContent = result.content
          applyLineAttributionsFromDocument(result)
          notifyNative('p2pmd-document-loaded', {
            updatedAt: result.updatedAt
          })
        } catch (error) {
          notifyDocumentError(error, 'editor-error')
        }
      }

      function scheduleDocumentSave() {
        if (saveTimer) clearTimeout(saveTimer)
        markLocalPeerTyping()
        markEditedLines(lastInputContent, input.value)
        lastInputContent = input.value
        renderLineGutter()
        notifyNative('p2pmd-document-pending', {})

        if (ydoc && ytext) {
          const newText = input.value
          const oldText = ytext.toString()
          if (newText !== oldText) {
            applyTextDiff(ytext, oldText, newText, Y_ORIGIN_LOCAL_INPUT)
          }
          return
        }

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

        if (imageUploadInput) {
          pendingImageSelection = createPendingImageSelection(start, end, selected || '')
          imageUploadInput.value = ''
          imageUploadInput.click()
          return
        }

        if (selected && /^(https?:[/][/]|www[.]|[a-z0-9-]+[.][a-z]{2,}|[.]?[/])/i.test(selected.trim())) {
          const replacement = '![](' + selected + ')'
          replaceDocumentRange(start, end, replacement, start + 3, start + 3)
          return
        }

        const altText = selected || 'image'
        const replacement = '![' + altText + ']()'
        replaceDocumentRange(start, end, replacement, start + replacement.length - 1, start + replacement.length - 1)
      }

      async function handleImageUploadSelection(event) {
        const file = event.target.files && event.target.files[0]
        const selection = pendingImageSelection
        pendingImageSelection = null
        if (!file || !selection) return

        const insertion = resolvePendingImageSelection(selection)
        const placeholder = createImageUploadPlaceholder()
        const placeholderStart = Math.min(insertion.start, input.value.length)
        const placeholderBlock = createMarkdownBlock(input.value, insertion.start, insertion.end, placeholder)
        replaceDocumentRange(insertion.start, insertion.end, placeholderBlock.text, placeholderBlock.cursor, placeholderBlock.cursor)

        try {
          const contentBase64 = await readFileAsBase64(file)

          const result = await callNativeBridge('hyper-image', {
            name: file.name || 'image',
            contentBase64
          })

          if (typeof result.url !== 'string') {
            throw new Error(result.error || 'Unable to upload image')
          }

          const altText = normalizeImageAltText(insertion.altText || result.name || file.name || 'image')
          const replacement = createImageMarkdown(altText, result.url)
          replaceUploadPlaceholder(placeholderStart, placeholder, replacement)
          notifyNative('p2pmd-image-uploaded', {
            url: result.url,
            name: result.name || file.name || 'image'
          })
        } catch (error) {
          replaceUploadPlaceholder(placeholderStart, placeholder, '![upload failed]')
          notifyDocumentError(error, 'editor-error')
        }
      }

      function createImageUploadPlaceholder() {
        return '![uploading..](#p2pmd-upload-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + ')'
      }

      function createPendingImageSelection(start, end, altText) {
        if (ydoc && ytext && window.Y?.createRelativePositionFromTypeIndex) {
          return {
            altText,
            start,
            end,
            relativeStart: window.Y.createRelativePositionFromTypeIndex(ytext, start),
            relativeEnd: window.Y.createRelativePositionFromTypeIndex(ytext, end)
          }
        }

        return {
          altText,
          start,
          end
        }
      }

      function resolvePendingImageSelection(selection) {
        if (
          selection.relativeStart &&
          selection.relativeEnd &&
          ydoc &&
          ytext &&
          window.Y?.createAbsolutePositionFromRelativePosition
        ) {
          const start = window.Y.createAbsolutePositionFromRelativePosition(selection.relativeStart, ydoc)
          const end = window.Y.createAbsolutePositionFromRelativePosition(selection.relativeEnd, ydoc)

          if (start && end && start.type === ytext && end.type === ytext) {
            return {
              start: Math.max(0, Math.min(start.index, input.value.length)),
              end: Math.max(0, Math.min(end.index, input.value.length)),
              altText: selection.altText
            }
          }
        }

        return {
          start: Math.max(0, Math.min(selection.start, input.value.length)),
          end: Math.max(0, Math.min(selection.end, input.value.length)),
          altText: selection.altText
        }
      }

      function createImageMarkdown(altText, url) {
        return '![' + altText + '](' + url + ')'
      }

      function createMarkdownBlock(content, start, end, markdown) {
        const prefix = start > 0 && content[start - 1] !== newline ? newline : ''
        const suffix = end < content.length && content[end] !== newline ? newline : ''
        const text = prefix + markdown + suffix
        const cursor = start + text.length

        return {
          text,
          cursor
        }
      }

      function replaceUploadPlaceholder(start, placeholder, replacement) {
        if (input.value.slice(start, start + placeholder.length) === placeholder) {
          replaceDocumentRange(start, start + placeholder.length, replacement, start + replacement.length, start + replacement.length)
          return
        }

        const index = input.value.indexOf(placeholder)
        if (index !== -1) {
          replaceDocumentRange(index, index + placeholder.length, replacement, index + replacement.length, index + replacement.length)
        }
      }

      function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader()

          reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : ''
            const commaIndex = result.indexOf(',')

            if (commaIndex === -1) {
              reject(new Error('Unable to read selected image.'))
              return
            }

            resolve(result.slice(commaIndex + 1))
          }

          reader.onerror = () => {
            reject(reader.error || new Error('Unable to read selected image.'))
          }

          reader.readAsDataURL(file)
        })
      }

      function normalizeImageAltText(value) {
        let text = String(value || 'image')
        const extensionIndex = text.lastIndexOf('.')
        if (extensionIndex > 0) text = text.slice(0, extensionIndex)

        text = text
          .split('[').join(' ')
          .split(']').join(' ')
          .split('(').join(' ')
          .split(')').join(' ')
          .split(' ')
          .filter(Boolean)
          .join(' ')
          .trim()

        return text || 'image'
      }

      function toggleTemplateMenu() {
        if (!latexModeEnabled || !latexTemplateMenu) return
        latexTemplateMenu.hidden = !latexTemplateMenu.hidden
      }

      function closeTemplateMenuOnOutsideClick(event) {
        if (!latexTemplateMenu || latexTemplateMenu.hidden) return
        const target = event.target
        if (latexTemplateMenu.contains(target) || target?.closest?.('[data-format="template"]')) return
        latexTemplateMenu.hidden = true
      }

      function renderTemplateMenu() {
        if (!latexTemplateMenu) return

        for (const template of templates) {
          const button = document.createElement('button')
          button.type = 'button'
          button.dataset.templateId = template.id
          button.setAttribute('role', 'menuitem')

          const label = document.createElement('span')
          label.className = 'template-label'
          label.textContent = template.label

          const description = document.createElement('span')
          description.className = 'template-description'
          description.textContent = template.description

          button.append(label, description)
          latexTemplateMenu.append(button)
        }
      }

      function applyTemplate(templateId) {
        const template = templates.find((entry) => entry.id === templateId)
        if (!template) return
        if (roomRole !== 'host' && !latexModeEnabled) return

        if (input.value.trim() && !window.confirm('Replace the current document with this template?')) {
          return
        }

        if (roomRole === 'host') setLatexMode(true)
        latexTemplateMenu.hidden = true
        replaceDocumentRange(0, input.value.length, template.content, 0, 0)
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
        else if (format === 'latex') setLatexMode(!latexModeEnabled)
        else if (format === 'inline-math') wrapSelection('$', '$')
        else if (format === 'block-math') wrapSelection('$$' + newline, newline + '$$')
        else if (format === 'template') toggleTemplateMenu()
        else if (format === 'slides') setViewMode('slides')
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
        if (!button || viewMode !== 'edit') return false

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
        if (!button || viewMode !== 'edit') {
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
        if (!state || state.pointerId !== event.pointerId || viewMode !== 'edit') return

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

      function applyLineAttributionsFromDocument(documentState) {
        lineAttributions = normalizeLineAttributions(
          documentState.lineAttributions || documentState.lineAuthors,
          documentState.content || ''
        )
        localLineAttributions = getLocalLineAttributions(lineAttributions)
        mergeLineAttributionsFromPeerList(latestPeerList, false)
        renderLineGutter()
      }

      function getSyncedDocumentFromResponse(result, fallbackContent) {
        if (result?.document && typeof result.document.content === 'string') {
          return result.document
        }

        return {
          content: typeof fallbackContent === 'string' ? fallbackContent : input.value,
          updatedAt: Date.now(),
          lineAttributions
        }
      }

      function mergeLineAttributionsFromPeerList(peerList, shouldRender = true) {
        if (!Array.isArray(peerList) || peerList.length === 0) return

        let changed = false
        for (const peer of peerList) {
          if (!peer || typeof peer !== 'object' || !peer.lineAttributions) continue

          const peerClientId = typeof peer.clientId === 'string' ? peer.clientId : ''
          const peerAttributions = normalizeLineAttributions(peer.lineAttributions, input.value)
          for (const [line, attribution] of Object.entries(peerAttributions)) {
            const nextAttribution = {
              ...attribution,
              clientId: attribution.clientId || peerClientId
            }
            const existing = lineAttributions[line]
            if (
              existing?.clientId === nextAttribution.clientId &&
              existing?.color === nextAttribution.color &&
              existing?.name === nextAttribution.name
            ) {
              continue
            }

            lineAttributions[line] = nextAttribution
            changed = true
          }
        }

        if (!changed) return
        localLineAttributions = getLocalLineAttributions(lineAttributions)
        if (shouldRender) renderLineGutter()
      }

      function getLocalLineAttributions(attributions) {
        const localAttributions = {}

        Object.keys(attributions || {}).forEach((line) => {
          const attribution = attributions[line]
          if (attribution?.clientId === clientId) {
            localAttributions[line] = attribution
          }
        })

        return localAttributions
      }

      function normalizeLineAttributions(attributions, content) {
        const count = getLineCount(content)
        const normalized = {}

        if (Array.isArray(attributions)) {
          attributions.forEach((value, index) => {
            const attribution = normalizeLineAttribution(value)
            if (attribution && index < count) normalized[String(index + 1)] = attribution
          })
          return normalized
        }

        if (attributions && typeof attributions === 'object') {
          Object.keys(attributions).forEach((line) => {
            const lineNumber = Number(line)
            const attribution = normalizeLineAttribution(attributions[line])
            if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > count || !attribution) return

            normalized[String(lineNumber)] = attribution
          })
        }

        return normalized
      }

      function normalizeLineAttribution(attribution) {
        if (!attribution || typeof attribution !== 'object') return null

        const color = typeof attribution.color === 'string' ? attribution.color.trim() : ''
        if (!color) return null

        const normalized = {
          clientId: typeof attribution.clientId === 'string' ? attribution.clientId : '',
          color,
          name: typeof attribution.name === 'string' ? attribution.name : ''
        }
        const updatedAt = Number(attribution.updatedAt)
        if (Number.isFinite(updatedAt) && updatedAt >= 0) normalized.updatedAt = updatedAt
        return normalized
      }

      function getLineCount(content) {
        return Math.max(String(content || '').split(newline).length, 1)
      }

      function markEditedLines(previousContent, nextContent) {
        const previousLines = String(previousContent || '').split(newline)
        const nextLines = String(nextContent || '').split(newline)
        const nextAttributions = {}
        const nextLocalAttributions = {}
        let prefix = 0

        function carryLineAttribution(previousLine, nextLine) {
          const existing = lineAttributions[String(previousLine)]
          if (!existing) return

          nextAttributions[String(nextLine)] = existing
          if (existing.clientId === clientId) {
            nextLocalAttributions[String(nextLine)] = existing
          }
        }

        while (
          prefix < previousLines.length &&
          prefix < nextLines.length &&
          previousLines[prefix] === nextLines[prefix]
        ) {
          carryLineAttribution(prefix + 1, prefix + 1)
          prefix += 1
        }

        let previousSuffix = previousLines.length - 1
        let nextSuffix = nextLines.length - 1
        while (
          previousSuffix >= prefix &&
          nextSuffix >= prefix &&
          previousLines[previousSuffix] === nextLines[nextSuffix]
        ) {
          carryLineAttribution(previousSuffix + 1, nextSuffix + 1)
          previousSuffix -= 1
          nextSuffix -= 1
        }

        const editedAttribution = { ...localAuthor, updatedAt: Date.now() }
        for (let index = prefix; index <= nextSuffix; index++) {
          nextAttributions[String(index + 1)] = editedAttribution
          nextLocalAttributions[String(index + 1)] = editedAttribution
        }

        lineAttributions = nextAttributions
        localLineAttributions = nextLocalAttributions
      }

      function renderLineGutter() {
        const lines = input.value.split(newline)
        const count = Math.max(lines.length, 1)

        lineGutter.replaceChildren()

        for (let index = 0; index < count; index++) {
          const line = document.createElement('div')
          const attribution = lineAttributions[String(index + 1)] || null
          const isLocal = attribution && attribution.clientId === clientId
          const lineOrigin = attribution ? (isLocal ? 'local' : 'remote') : 'loaded'
          line.className = 'gutter-line ' + lineOrigin
          if (attribution) {
            line.style.borderRightColor = attribution.color
          }
          line.title = lineOrigin === 'remote'
            ? 'Edited by ' + (attribution.name || 'remote peer')
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

            notifyNative('p2pmd-document-syncing', {})

            const response = await fetch(roomUrl('/doc'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                content,
                ...getPeerPayload(),
                lineAttributions,
                peerLineAttributions: localLineAttributions
              })
            })
            const result = await response.json()

            if (!response.ok || !result.ok) {
              throw new Error(result.error || 'Unable to save document')
            }

            const syncedDocument = getSyncedDocumentFromResponse(result, content)
            lastSyncedContent = syncedDocument.content
            applyLineAttributionsFromDocument(syncedDocument)
            notifyNative('p2pmd-document-saved', {
              updatedAt: syncedDocument.updatedAt,
              contentLength: syncedDocument.content.length
            })
          }
        } catch (error) {
          notifyDocumentError(error, 'editor-error')
        } finally {
          saveInFlight = false
          if (pendingContent !== null) flushDocumentSave()
        }
      }

      async function flushYjsUpdate() {
        if (!pendingUpdate) return

        const updateToSend = pendingUpdate
        pendingUpdate = null

        try {
          notifyNative('p2pmd-document-syncing', {})

          const response = await fetch(roomUrl('/doc/update'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              update: bytesToBase64(updateToSend),
              ...getPeerPayload(),
              lineAttributions,
              peerLineAttributions: localLineAttributions
            })
          })
          const result = await response.json()

          if (!response.ok || !result.ok) {
            throw new Error(result.error || 'Unable to sync document update')
          }

          const syncedDocument = getSyncedDocumentFromResponse(result, ytext ? ytext.toString() : input.value)
          notifyNative('p2pmd-document-saved', {
            updatedAt: syncedDocument.updatedAt,
            contentLength: syncedDocument.content.length
          })
          if (flushRetryTimer) {
            clearTimeout(flushRetryTimer)
            flushRetryTimer = null
          }
        } catch (error) {
          let mergedUpdate = pendingUpdate
            ? window.Y.mergeUpdates([updateToSend, pendingUpdate])
            : updateToSend

          if (mergedUpdate.byteLength > MAX_PENDING_UPDATE_BYTES && ydoc) {
            try {
              mergedUpdate = window.Y.encodeStateAsUpdate(ydoc)
            } catch {}
          }

          if (mergedUpdate.byteLength > MAX_PENDING_UPDATE_BYTES) {
            pendingUpdate = null
            notifyNative('p2pmd-document-error', {
              error: 'Pending document update is too large to retry'
            })
            return
          }

          pendingUpdate = mergedUpdate
          notifyDocumentError(error, 'editor-error')

          if (!flushRetryTimer) {
            flushRetryTimer = setTimeout(() => {
              flushRetryTimer = null
              flushYjsUpdate()
            }, 1200)
          }
        }
      }

      async function initializeYjs() {
        if (!window.Y) return

        ydoc = new window.Y.Doc()
        ytext = ydoc.getText('content')
        ysettings = ydoc.getMap('settings')

        try {
          const result = await withInitialRoomRetry(async () => {
            const response = await fetch(roomUrl('/doc/yjsstate'))
            const body = await response.json()
            if (!response.ok || typeof body.yjsState !== 'string') {
              throw new Error(body.error || 'Unable to load Yjs state')
            }

            return body
          })

          if (typeof result.yjsState === 'string') {
            window.Y.applyUpdate(ydoc, base64ToBytes(result.yjsState), Y_ORIGIN_REMOTE)
            const yjsContent = ytext.toString()
            if (yjsContent || !input.value) {
              input.value = yjsContent
              lastSyncedContent = yjsContent
              lastInputContent = yjsContent
              mergeLineAttributionsFromPeerList(latestPeerList)
            }
          }
        } catch {}

        if (!ytext.toString() && input.value) {
          ydoc.transact(() => {
            ytext.insert(0, input.value)
          }, Y_ORIGIN_REMOTE)
        }

        ydoc.on('update', (update, origin) => {
          if (origin === Y_ORIGIN_REMOTE || isApplyingRemote) return

          pendingUpdate = pendingUpdate
            ? window.Y.mergeUpdates([pendingUpdate, update])
            : update

          if (sendUpdateTimer) clearTimeout(sendUpdateTimer)
          sendUpdateTimer = setTimeout(() => {
            sendUpdateTimer = null
            flushYjsUpdate()
          }, 100)
        })

        const sharedLatexMode = ysettings.get(LATEX_MODE_YJS_KEY)
        if (typeof sharedLatexMode === 'boolean') {
          hasSyncedHostLatexMode = true
          setLatexMode(sharedLatexMode, { persist: false, sync: false, fromSharedState: true })
        } else if (roomRole === 'host') {
          setLatexMode(latexModeEnabled)
        }

        ysettings.observe((event) => {
          if (!event.keysChanged.has(LATEX_MODE_YJS_KEY)) return
          const enabled = ysettings.get(LATEX_MODE_YJS_KEY)
          if (typeof enabled !== 'boolean') return

          hasSyncedHostLatexMode = true
          setLatexMode(enabled, { persist: false, sync: false, fromSharedState: true })
        })

        ytext.observe((event) => {
          const newContent = ytext.toString()
          lastSyncedContent = newContent
          lastInputContent = newContent

          if (newContent === input.value) return

          let selectionStart = Number.isFinite(input.selectionStart) ? input.selectionStart : 0
          let selectionEnd = Number.isFinite(input.selectionEnd) ? input.selectionEnd : selectionStart
          let position = 0

          for (const delta of event.changes.delta) {
            if (delta.retain) {
              position += delta.retain
            } else if (delta.insert) {
              const length = typeof delta.insert === 'string' ? delta.insert.length : 0
              if (position < selectionStart) selectionStart += length
              if (position < selectionEnd) selectionEnd += length
              position += length
            } else if (delta.delete) {
              const length = delta.delete
              if (position < selectionStart) selectionStart -= Math.min(length, selectionStart - position)
              if (position < selectionEnd) selectionEnd -= Math.min(length, selectionEnd - position)
            }
          }

          input.value = newContent
          input.setSelectionRange(
            Math.max(0, Math.min(selectionStart, newContent.length)),
            Math.max(0, Math.min(selectionEnd, newContent.length))
          )
          mergeLineAttributionsFromPeerList(latestPeerList, false)
          renderLineGutter()
          scheduleActiveViewRender()
          notifyNative('p2pmd-document-updated', {
            contentLength: newContent.length
          })
        })
      }

      async function renderPreview() {
        const requestId = ++previewRequestId
        preview.setAttribute('aria-busy', 'true')

        try {
          const result = await callNativeBridge('preview', {
            content: input.value,
            latexModeEnabled
          })

          if (typeof result.html !== 'string') {
            throw new Error(result.error || 'Unable to render Markdown preview')
          }

          if (requestId !== previewRequestId || viewMode !== 'preview') return

          window.P2pmdIeee?.clear(preview)
          preview.innerHTML = result.html
          if (result.ieee === true) {
            await window.P2pmdIeee.render(preview, result.html)
          }
        } catch (error) {
          if (requestId !== previewRequestId || viewMode !== 'preview') return
          notifyDocumentError(error, 'editor-error')
        } finally {
          if (requestId === previewRequestId) {
            preview.removeAttribute('aria-busy')
          }
        }
      }

      async function renderSlides() {
        const requestId = ++previewRequestId
        slidesPreview.setAttribute('aria-busy', 'true')

        try {
          const result = await callNativeBridge('preview', {
            content: input.value,
            mode: 'slides',
            latexModeEnabled
          })

          if (typeof result.html !== 'string' || !Number.isInteger(result.count) || result.count < 1) {
            throw new Error(result.error || 'Unable to render presentation slides')
          }

          if (requestId !== previewRequestId || viewMode !== 'slides') return

          const previousSlideIndex = currentSlideIndex
          const activeSlide = slidesContent.querySelector('.slide.active')
          const previousScrollTop = activeSlide ? activeSlide.scrollTop : 0
          slidesContent.innerHTML = result.html
          currentSlideIndex = clampSlideIndex(currentSlideIndex, result.count)
          showSlide(
            currentSlideIndex,
            currentSlideIndex === previousSlideIndex ? previousScrollTop : 0
          )
        } catch (error) {
          if (requestId !== previewRequestId || viewMode !== 'slides') return
          notifyDocumentError(error, 'editor-error')
        } finally {
          if (requestId === previewRequestId) {
            slidesPreview.removeAttribute('aria-busy')
          }
        }
      }

      function clampSlideIndex(index, totalSlides) {
        if (!Number.isFinite(index) || totalSlides < 1) return 0
        return Math.max(0, Math.min(Math.floor(index), totalSlides - 1))
      }

      function showSlide(index, scrollTop = 0) {
        const slides = Array.from(slidesContent.querySelectorAll('.slide'))
        if (slides.length === 0) return

        currentSlideIndex = clampSlideIndex(index, slides.length)
        slides.forEach((slide, slideIndex) => {
          const active = slideIndex === currentSlideIndex
          slide.classList.toggle('active', active)
          slide.setAttribute('aria-hidden', String(!active))
          slide.style.transform = ''
          if (active) slide.scrollTop = scrollTop
        })

        const atStart = currentSlideIndex === 0
        const atEnd = currentSlideIndex === slides.length - 1
        slidesPrevious.disabled = atStart
        slidesNext.disabled = atEnd
        slidesCounter.textContent = (currentSlideIndex + 1) + ' / ' + slides.length
        slidesProgress.style.width = (((currentSlideIndex + 1) / slides.length) * 100) + '%'
        scheduleSlideFit()
      }

      function scheduleSlideFit() {
        if (slideFitFrame) cancelAnimationFrame(slideFitFrame)
        slideFitFrame = requestAnimationFrame(() => {
          slideFitFrame = null
          fitActiveSlide()
        })
      }

      function fitActiveSlide() {
        const slide = slidesContent.querySelector('.slide.active')
        if (!slide) return

        slide.style.transform = ''
        if (!window.matchMedia('(orientation: landscape)').matches) return

        const availableWidth = slidesPreview.clientWidth
        const availableHeight = slidesPreview.clientHeight
        const contentWidth = Math.max(slide.clientWidth, slide.scrollWidth)
        const contentHeight = Math.max(slide.clientHeight, slide.scrollHeight)
        if (!availableWidth || !availableHeight || !contentWidth || !contentHeight) return

        const scale = Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight)
        if (scale < 1) slide.style.transform = 'scale(' + scale + ')'
      }

      function moveSlide(direction) {
        const nextSlideIndex = currentSlideIndex + direction
        const slideCount = slidesContent.querySelectorAll('.slide').length
        if (nextSlideIndex < 0 || nextSlideIndex >= slideCount) return
        showSlide(nextSlideIndex)
      }

      async function renderActiveView() {
        if (activeViewRenderInFlight) {
          activeViewRenderPending = true
          return
        }

        activeViewRenderInFlight = true
        try {
          if (viewMode === 'preview') await renderPreview()
          else if (viewMode === 'slides') await renderSlides()
        } finally {
          activeViewRenderInFlight = false
          if (activeViewRenderPending) {
            activeViewRenderPending = false
            if (viewMode !== 'edit') renderActiveView()
          }
        }
      }

      function scheduleActiveViewRender() {
        if (viewMode === 'edit') return
        if (activeViewRenderTimer) clearTimeout(activeViewRenderTimer)
        activeViewRenderTimer = setTimeout(() => {
          activeViewRenderTimer = null
          renderActiveView()
        }, ACTIVE_VIEW_RENDER_DELAY_MS)
      }

      function setViewMode(nextMode) {
        if (!['edit', 'preview', 'slides'].includes(nextMode)) return

        if (activeViewRenderTimer) {
          clearTimeout(activeViewRenderTimer)
          activeViewRenderTimer = null
        }
        viewMode = nextMode
        if (viewMode === 'edit') activeViewRenderPending = false
        previewRequestId += 1
        document.body.classList.toggle('preview-mode', viewMode === 'preview')
        document.body.classList.toggle('slide-mode', viewMode === 'slides')
        input.hidden = viewMode !== 'edit'
        input.parentElement.hidden = viewMode !== 'edit'
        preview.hidden = viewMode !== 'preview'
        slidesPreview.hidden = viewMode !== 'slides'
        formattingToolbar.hidden = viewMode !== 'edit'
        notifyNative('p2pmd-view-mode', { mode: viewMode })

        if (viewMode === 'edit') {
          input.focus()
        } else {
          renderActiveView()
        }
      }

      function togglePreview() {
        setViewMode(viewMode === 'edit' ? 'preview' : 'edit')
      }

      function publishToHyper() {
        notifyNative('p2pmd-publish-requested', {
          content: input.value,
          mode: viewMode,
          latexModeEnabled
        })
      }

      function connectEvents() {
        if (eventSource) {
          try {
            eventSource.close()
          } catch {}
        }

        const params = new URLSearchParams(getPeerPayload())
        const source = new EventSource(roomUrl('/events?' + params.toString()))
        eventSource = source

        source.onopen = () => {
          if (reconnectTimer) {
            clearTimeout(reconnectTimer)
            reconnectTimer = null
          }
          if (pendingUpdate) flushYjsUpdate()
        }

        source.addEventListener('peers', (event) => {
          const count = Number(event.data)
          if (!Number.isInteger(count) || count < 0) return

          notifyNative('p2pmd-peers', {
            count
          })
        })

        source.addEventListener('peerlist', (event) => {
          try {
            const peerList = JSON.parse(event.data || '[]')
            if (!Array.isArray(peerList)) return

            latestPeerList = peerList
            mergeLineAttributionsFromPeerList(peerList)
            renderPeerDashboard()

            if (roomRole === 'client' && !hasSyncedHostLatexMode) {
              const host = peerList.find((peer) => peer?.role === 'host')
              if (typeof host?.latexModeEnabled === 'boolean') {
                hasSyncedHostLatexMode = true
                setLatexMode(host.latexModeEnabled, { persist: false, sync: false, fromSharedState: true })
              }
            }
          } catch {}
        })

        source.addEventListener('activity', (event) => {
          try {
            mergePeerActivity(JSON.parse(event.data || 'null'))
          } catch {}
        })

        source.addEventListener('yjsupdate', (event) => {
          queueRemoteYjsUpdate(event.data)
        })

        source.addEventListener('update', (event) => {
          try {
            const documentState = JSON.parse(event.data)
            if (typeof documentState.content !== 'string') return

            if (ydoc && ytext) {
              lastSyncedContent = ytext.toString()
              lastInputContent = lastSyncedContent
              applyLineAttributionsFromDocument({
                ...documentState,
                content: lastSyncedContent
              })
              return
            }

            if (documentState.content === input.value) {
              lastSyncedContent = documentState.content
              lastInputContent = documentState.content
              applyLineAttributionsFromDocument(documentState)
              return
            }

            input.value = documentState.content
            lastSyncedContent = documentState.content
            lastInputContent = documentState.content
            applyLineAttributionsFromDocument(documentState)
            scheduleActiveViewRender()
            notifyNative('p2pmd-document-updated', {
              updatedAt: documentState.updatedAt,
              contentLength: documentState.content.length
            })
          } catch {}
        })

        source.onerror = () => {
          try {
            source.close()
          } catch {}

          if (eventSource === source) eventSource = null
          if (reconnectTimer) return

          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            connectEvents()
          }, 1200)
        }
      }

      async function initializeEditor() {
        renderTemplateMenu()
        updateLatexControls()
        peerDisplayName.value = localAuthor.name
        renderPeerDashboard()
        await loadDocument()
        try {
          await loadYjsRuntime()
        } catch (error) {
          notifyDocumentError(error, 'editor-error')
        }
        await initializeYjs()
        connectEvents()
      }

      input.addEventListener('input', scheduleDocumentSave)
      input.addEventListener('keydown', continueListOnEnter)
      input.addEventListener('scroll', syncLineGutterScroll)
      input.addEventListener('contextmenu', preventNativeContextMenu)
      imageUploadInput?.addEventListener('change', handleImageUploadSelection)
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
      latexTemplateMenu?.addEventListener('click', (event) => {
        const button = event.target?.closest?.('button[data-template-id]')
        if (button) applyTemplate(button.dataset.templateId)
      })
      document.addEventListener('click', closeTemplateMenuOnOutsideClick)
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && latexTemplateMenu) latexTemplateMenu.hidden = true
        if (event.key === 'Escape' && !peerDashboardBackdrop.hidden) {
          setPeerDashboardVisible(false)
        }
      })
      peerDashboardClose.addEventListener('click', () => setPeerDashboardVisible(false))
      peerDashboardBackdrop.addEventListener('click', (event) => {
        if (event.target === peerDashboardBackdrop) setPeerDashboardVisible(false)
      })
      peerDisplayNameSave.addEventListener('click', updatePeerDisplayName)
      peerDisplayName.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') updatePeerDisplayName()
      })
      slidesPrevious.addEventListener('click', () => moveSlide(-1))
      slidesNext.addEventListener('click', () => moveSlide(1))
      slidesExit.addEventListener('click', () => setViewMode('edit'))
      window.addEventListener('resize', () => {
        scheduleSlideFit()
        if (viewMode === 'preview') window.P2pmdIeee?.fitPages(preview)
      })
      slidesContent.addEventListener('load', scheduleSlideFit, true)
      slidesContent.addEventListener('loadedmetadata', scheduleSlideFit, true)
      slidesPreview.addEventListener('touchstart', (event) => {
        const touch = event.touches[0]
        if (!touch) return
        slideTouchStart = { x: touch.clientX, y: touch.clientY }
      }, { passive: true })
      slidesPreview.addEventListener('touchend', (event) => {
        const touch = event.changedTouches[0]
        const start = slideTouchStart
        slideTouchStart = null
        if (!touch || !start) return

        const deltaX = touch.clientX - start.x
        const deltaY = touch.clientY - start.y
        if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return
        moveSlide(deltaX < 0 ? 1 : -1)
      }, { passive: true })
      slidesPreview.addEventListener('touchcancel', () => {
        slideTouchStart = null
      }, { passive: true })
      window.addEventListener('keydown', (event) => {
        if (viewMode !== 'slides') return
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') moveSlide(-1)
        else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === ' ') {
          event.preventDefault()
          moveSlide(1)
        } else if (event.key === 'Home') showSlide(0)
        else if (event.key === 'End') {
          showSlide(slidesContent.querySelectorAll('.slide').length - 1)
        } else if (event.key === 'Escape') setViewMode('edit')
      })
      window.__p2pmdTogglePreview = togglePreview
      window.__p2pmdPublishToHyper = publishToHyper
      window.__p2pmdTogglePeerDashboard = (force) => {
        setPeerDashboardVisible(typeof force === 'boolean' ? force : peerDashboardBackdrop.hidden)
      }
      initializeEditor()
    </script>
  </body>
</html>`
}

function getFoundationPage () {
  return getP2pmdEditorPage()
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
