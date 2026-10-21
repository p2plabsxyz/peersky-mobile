import b4a from 'b4a'
import { createLoopbackToken, isLoopbackToken, isOwnLoopbackRequest } from '../loopback-request.mjs'
import { streamHyperAsset } from '../hyper/asset-server-core.mjs'
import { isPeerDiscoveryError } from '../hyper/fetch-retry.mjs'
import { headersToObject } from '../hyper/assets.mjs'
import { parseHyperUrl } from '../hyper/url.mjs'
import { PEERTUNES_LOOPBACK_HOST, PEERTUNES_LOOPBACK_PORT } from './constants.mjs'
import peertunesAssets from './peertunes-runtime.mjs'
import { MAX_KEEP_SONGS_PER_REQUEST, createSongKeeper, within } from './song-keeper.mjs'

// A folder listing or playlist manifest is a small document. Anything larger is
// either the wrong branch or an attempt to exhaust the worklet's heap, so it is
// refused rather than buffered.
const MAX_JSON_BODY_BYTES = 4 * 1024 * 1024

// Enough of an upstream failure to name the cause, not enough to be a payload.
const MAX_UPSTREAM_ERROR_BYTES = 8 * 1024

// A folder listing reads one block per entry, so a cold folder of tracks needs
// far more reads than a drive root and is the one that trips the 5s per-read
// timeout. Each attempt keeps the blocks it did manage to fetch, so retrying
// makes real progress rather than just rolling the dice again.
const LISTING_ATTEMPTS = 3
const LISTING_RETRY_DELAY_MS = 400
// A drive this phone has never read answers 404 "Peers Not Found" until a peer
// connects. The browser waits that out, and this did not, so the first add of
// a new drive failed and the second one worked.
const DISCOVERY_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 2000]

// Content types the proxy will hand back as-is. Everything else is forced to
// application/octet-stream, because a hyper drive is untrusted input and the
// PeerTunes origin is fixed and holds the user's library.
const PROXYABLE_CONTENT_TYPES = /^(?:audio|video)\/|^image\/(?!svg\b)|^text\/plain\b|^application\/json\b/i

const STATIC_CONTENT_TYPES = {
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  svg: 'image/svg+xml',
  webmanifest: 'application/manifest+json'
}

// A drive this phone has not opened yet can take a moment. Checking a kept
// song does not wait longer than this for it.
const KEEP_DRIVE_OPEN_TIMEOUT_MS = 4000
// Songs asked about in one request, so its address stays short.
const KEEP_SONGS_BATCH = 10

// Asking starts downloads, so only the PeerTunes page may ask: it sends this
// header. A tab or an image another page points here cannot send one, and the
// loopback check lets those through when the app opened the tab, or when an
// older WebView says nothing about where a request came from. A fetch from
// another origin that adds it is refused at the preflight.
export const KEEP_SONGS_HEADER = 'X-PeerTunes-Keep'

// Reading a drive and keeping songs both need this run's token. Another app on
// the phone can reach this port and send any header, so the loopback check
// alone left it the person's private drives, decrypted.
const TOKEN_ROUTES = new Set(['/hyper/asset', '/hyper/keep'])

// The app gives the token to its own WebView before this page loads, as
// window.peerskyServerToken. It is read on each call and never sent from here:
// any app on the phone can fetch this page.
const TOKEN_SCRIPT = 'function token(){var value=window.peerskyServerToken;' +
  'return typeof value==="string"&&value?"&token="+encodeURIComponent(value):""}'

// PeerTunes asks which songs of a kept playlist are on the device, and the
// server fetches the ones that are not. A few at a time, then one answer.
const KEEP_SONGS_SCRIPT = 'window.peerskyKeepSongs=function(urls){' +
  'var list=Array.isArray(urls)?urls.map(String):[],batches=[];' +
  `for(var i=0;i<list.length;i+=${KEEP_SONGS_BATCH})batches.push(list.slice(i,i+${KEEP_SONGS_BATCH}));` +
  'return Promise.all(batches.map(function(batch){' +
  `return fetch("/hyper/keep?"+batch.map(function(url){return"url="+encodeURIComponent(url)}).join("&")+token(),{headers:{"${KEEP_SONGS_HEADER}":"1"}})` +
  '.then(function(res){if(!res.ok)throw new Error("keep "+res.status);return res.json()})' +
  '})).then(function(parts){' +
  'var out={ok:true,saved:[],saving:[],waiting:[]};' +
  'parts.forEach(function(part){["saved","saving","waiting"].forEach(function(key){' +
  'if(part&&Array.isArray(part[key]))out[key]=out[key].concat(part[key])})});' +
  'return out' +
  '}).catch(function(){return null})}'

// PeerTunes looks for this global and sends its hyper:// reads through it,
// because the WebView cannot fetch hyper:// on its own. The path is relative,
// and the token is added when the page asks, so the page as served holds none.
// peerskyProtocols: the phone reads hyper:// only, so PeerTunes offers no other
// p2p link.
export const HYPER_BRIDGE_SCRIPT = `<script>(function(){${TOKEN_SCRIPT}window.peerskyProtocols=["hyper"];window.peerskyHyperAsset=function(url){return"/hyper/asset?url="+encodeURIComponent(String(url))+token()};${KEEP_SONGS_SCRIPT}})()</script>`

let server = null
let serverInfo = null
let serverTransition = Promise.resolve()
let bareHttp = null
let hyperFetchModule = null
let hyperRuntimeModule = null

// The app passes nothing. Tests pass Node's http, port 0 and stand-ins for
// the Hyper calls, since Bare's HTTP and the Hyper fetch do not load under
// Node.
export async function startPeerTunesServer ({ httpImpl: testHttp = null, port = PEERTUNES_LOOPBACK_PORT, hyper: testHyper = null } = {}) {
  return withServerTransition(async () => {
    if (server && serverInfo) {
      return {
        ok: true,
        running: true,
        ...serverInfo
      }
    }

    const httpImpl = testHttp || await getBareHttp()
    const { ensureFetchGlobals, refreshHyperNetworkFor, routedHyperFetch, routedHyperRangeFetch } = testHyper || await getHyperFetchModule()
    const { withHyperRuntimeForAddress } = testHyper || await getHyperRuntimeModule()
    const { hyperOfflineNetworkAllowed } = testHyper || await import('../hyper/offline-manager.mjs')
    const keeper = createSongKeeper({
      openDrive: (address, task) => withHyperRuntimeForAddress(address, async (runtime) => {
        const drive = await within(runtime.getDrive(address), KEEP_DRIVE_OPEN_TIMEOUT_MS)
        if (!drive) throw new Error('The drive did not open in time.')
        return task(drive)
      }),
      refreshNetwork: refreshHyperNetworkFor,
      // Download only on Wi-Fi holds for kept songs as for kept folders.
      mayDownload: hyperOfflineNetworkAllowed
    })
    // A new token each run. The app hands it to the page, and reloads the
    // page when a restart brings a new one.
    const token = createLoopbackToken()
    const options = {
      httpImpl,
      fetch: routedHyperFetch,
      fetchRange: routedHyperRangeFetch,
      ensureGlobals: ensureFetchGlobals,
      refreshNetwork: refreshHyperNetworkFor,
      keepSongs: keeper.keep,
      token
    }

    let bound
    let usingFallbackPort = false
    try {
      bound = await bindServer(options, port)
    } catch (error) {
      // Something else holds the fixed port. The app still works, but the
      // library lives in the origin's IndexedDB, so a different port means the
      // user opens an empty library. Say so rather than letting it look like
      // their music vanished.
      console.warn('[peertunes] Fixed loopback port unavailable, using a random port:', error?.message || error)
      bound = await bindServer(options, 0)
      usingFallbackPort = true
    }

    server = bound.instance
    serverInfo = {
      host: PEERTUNES_LOOPBACK_HOST,
      port: bound.port,
      localUrl: `http://${PEERTUNES_LOOPBACK_HOST}:${bound.port}`,
      usingFallbackPort,
      token
    }

    return {
      ok: true,
      running: true,
      ...serverInfo
    }
  })
}

export async function stopPeerTunesServer () {
  return withServerTransition(async () => {
    if (!server) {
      serverInfo = null
      return {
        ok: true,
        running: false
      }
    }

    const existing = server
    try {
      await closeServer(existing)
    } finally {
      server = null
      serverInfo = null
    }

    return {
      ok: true,
      running: false
    }
  })
}

export function createPeerTunesHttpServer ({
  httpImpl,
  fetch,
  fetchRange,
  ensureGlobals = () => {},
  refreshNetwork = async () => {},
  keepSongs = null,
  token
} = {}) {
  if (!httpImpl?.createServer) {
    throw new Error('PeerTunes HTTP server requires an HTTP implementation.')
  }
  if (typeof fetch !== 'function') {
    throw new Error('PeerTunes HTTP server requires a Hyper fetch implementation.')
  }
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('PeerTunes HTTP server requires a token.')
  }

  return httpImpl.createServer((req, res) => {
    handleRequest(req, res, { fetch, fetchRange, ensureGlobals, refreshNetwork, keepSongs, token })
  })
}

// Only paths that name a bundled file resolve. Dot segments, backslashes and
// broken encoding are refused before the lookup.
export function resolveStaticAsset (pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(String(pathname || '/'))
  } catch {
    return null
  }

  if (decoded.includes('\\') || decoded.includes('\0')) return null

  const key = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const segments = key.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  if (!Object.prototype.hasOwnProperty.call(peertunesAssets, key)) return null

  return { key, ...peertunesAssets[key] }
}

export function injectHyperBridge (html) {
  const source = String(html || '')
  const match = /<head[^>]*>/i.exec(source)
  if (!match) return `${HYPER_BRIDGE_SCRIPT}${source}`

  const insertAt = match.index + match[0].length
  return `${source.slice(0, insertAt)}${HYPER_BRIDGE_SCRIPT}${source.slice(insertAt)}`
}

function handleRequest (req, res, { fetch, fetchRange, ensureGlobals, refreshNetwork, keepSongs, token }) {
  const requestUrl = parseRequestUrl(req.url)
  if (!requestUrl) {
    sendText(res, 400, 'Bad request')
    return
  }

  if (!isOwnLoopbackRequest(req)) {
    sendText(res, 403, 'Forbidden')
    return
  }

  if (req.method === 'OPTIONS') {
    sendEmpty(res, 204)
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed')
    return
  }

  if (TOKEN_ROUTES.has(requestUrl.pathname) && !isLoopbackToken(requestUrl.searchParams.get('token'), token)) {
    sendText(res, 403, 'Forbidden')
    return
  }

  if (requestUrl.pathname === '/hyper/asset') {
    serveHyperAsset(req, res, { fetch, fetchRange, ensureGlobals, refreshNetwork }, requestUrl.searchParams.get('url'))
      .catch((error) => sendError(req, res, error))
    return
  }

  if (requestUrl.pathname === '/hyper/keep') {
    if (req.headers?.[KEEP_SONGS_HEADER.toLowerCase()] !== '1') {
      sendText(res, 403, 'Forbidden')
      return
    }
    serveKeptSongs(req, res, keepSongs, requestUrl.searchParams.getAll('url'))
      .catch((error) => sendError(req, res, error))
    return
  }

  const asset = resolveStaticAsset(requestUrl.pathname)
  if (!asset) {
    sendText(res, 404, 'Not found')
    return
  }

  sendStaticAsset(req, res, asset)
}

async function serveHyperAsset (req, res, { fetch, fetchRange, ensureGlobals, refreshNetwork }, assetUrl) {
  if (!assetUrl) {
    sendText(res, 400, 'Missing asset url')
    return
  }

  const parsed = parseHyperUrl(assetUrl)
  if (parsed.error) {
    sendText(res, 400, parsed.error)
    return
  }

  ensureGlobals()

  // Folder listings and playlist manifests are small documents. Forwarding
  // Accept lets hypercore-fetch answer a folder with its JSON listing.
  if (wantsJson(req)) {
    const response = await fetchListing(fetch, assetUrl, req, res, refreshNetwork)
    if (!response) return

    const headers = headersToObject(response.headers)
    const declaredLength = Number.parseInt(headers['content-length'] || '', 10)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
      throw createHttpError(413, 'Hyper listing is too large')
    }

    const body = await readTextWithLimit(response, MAX_JSON_BODY_BYTES)
    sendText(res, 200, body, headers['content-type'] || 'application/json; charset=utf-8')
    return
  }

  await streamHyperAsset(fetch, fetchRange, assetUrl, req, guardProxyResponse(res), null)
}

// Which songs of a kept playlist are on the device. Asking also fetches the
// ones that are not, so a song that could not be saved before, because the
// person sharing it was offline, is tried again each time.
async function serveKeptSongs (req, res, keepSongs, urls) {
  if (typeof keepSongs !== 'function') {
    sendText(res, 404, 'Not found')
    return
  }
  if (req.method !== 'GET') {
    sendText(res, 405, 'Method not allowed')
    return
  }
  if (!urls.length || urls.length > MAX_KEEP_SONGS_PER_REQUEST) {
    sendText(res, 400, `Ask about 1 to ${MAX_KEEP_SONGS_PER_REQUEST} songs`)
    return
  }

  const answer = await keepSongs(urls)
  sendText(res, 200, JSON.stringify(answer), 'application/json; charset=utf-8')
}

function sendStaticAsset (req, res, asset) {
  const extension = asset.key.slice(asset.key.lastIndexOf('.') + 1).toLowerCase()
  const content = asset.key === 'index.html' ? injectHyperBridge(asset.content) : asset.content
  const body = asset.encoding === 'base64' ? b4a.from(content, 'base64') : b4a.from(content)

  res.statusCode = 200
  res.setHeader('Content-Type', STATIC_CONTENT_TYPES[extension] || 'application/octet-stream')
  res.setHeader('Content-Length', String(body.byteLength))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Connection', 'close')

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  res.end(body)
}

async function bindServer (options, port) {
  const instance = createPeerTunesHttpServer(options)

  try {
    const address = await listen(instance, port)
    const boundPort = typeof address === 'object' && address ? address.port : null

    if (!Number.isInteger(boundPort) || boundPort < 1) {
      throw new Error('PeerTunes server started without a valid port')
    }

    return { instance, port: boundPort }
  } catch (error) {
    try {
      instance.close()
    } catch {}

    throw error
  }
}

function listen (instance, port) {
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
    instance.listen(port, PEERTUNES_LOOPBACK_HOST)
  })
}

function closeServer (instance) {
  return new Promise((resolve, reject) => {
    instance.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function withServerTransition (task) {
  const run = serverTransition.then(task, task)
  serverTransition = run.catch(() => {})
  return run
}

async function getBareHttp () {
  if (!bareHttp) {
    const module = await import('bare-http1')
    bareHttp = module.default || module
  }

  return bareHttp
}

// Loaded lazily so tests can drive the server with a fake fetch and Node's
// http module without pulling the Hyper SDK into the process.
// Importing a playlist means reading its folder listing, so that is when the
// tracks get pinned for offline. Fire and forget: a failure here must not break
// the import, and the download runs in the background.
async function getHyperFetchModule () {
  if (!hyperFetchModule) {
    hyperFetchModule = await import('../hyper/fetch.mjs')
  }

  return hyperFetchModule
}

// The drives behind kept songs, opened the same way the reads above open them.
async function getHyperRuntimeModule () {
  if (!hyperRuntimeModule) {
    hyperRuntimeModule = await import('../hyper/runtime.mjs')
  }

  return hyperRuntimeModule
}

function wantsJson (req) {
  return /\bapplication\/json\b/i.test(getRequestHeader(req, 'accept') || '')
}

function getRequestHeader (req, name) {
  const headers = req.headers || {}
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || null
}

// The proxy carries bytes from an untrusted hyper drive. Two things must not
// escape: the wildcard CORS the shared asset streamer sets, which would let any
// website read the response, and a renderable content type, which would let a
// drive run scripts on the PeerTunes origin.
function guardProxyResponse (res) {
  return new Proxy(res, {
    get (target, property) {
      if (property === 'setHeader') {
        return (name, value) => {
          const header = String(name).toLowerCase()
          if (header.startsWith('access-control-')) return target
          if (header === 'content-type') {
            return target.setHeader(name, safeProxyContentType(value))
          }
          return target.setHeader(name, value)
        }
      }

      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

function safeProxyContentType (value) {
  const contentType = String(value || '')
  return PROXYABLE_CONTENT_TYPES.test(contentType) ? contentType : 'application/octet-stream'
}

async function fetchListing (fetch, assetUrl, req, res, refreshNetwork) {
  let failure = null
  let slowReads = 0
  let discoveries = 0

  while (true) {
    if (req.aborted || res.destroyed) return null

    const response = await fetch(assetUrl, { headers: { accept: 'application/json' } })
    if (response.ok) return response

    // hypercore-fetch puts the real reason in the body: a read timeout, a
    // missing block, an empty folder. Throwing that away left every failure
    // looking like "can't reach that URL", which is unusable when a folder
    // fails on one device and works on another.
    const detail = await describeUpstreamFailure(response)
    failure = createHttpError(response.status || 502, detail)

    // A 404 is an answer, unless it means nobody has been found to ask yet.
    if (response.status === 404) {
      if (!isPeerDiscoveryError(detail) || discoveries >= DISCOVERY_RETRY_DELAYS_MS.length) break
      await refreshNetwork(assetUrl).catch(() => {})
      await delay(DISCOVERY_RETRY_DELAYS_MS[discoveries++])
      continue
    }

    // Slow or incomplete reads keep the blocks they did fetch, so another go
    // makes progress.
    if (++slowReads >= LISTING_ATTEMPTS) break
    await delay(LISTING_RETRY_DELAY_MS)
  }

  throw failure
}

function delay (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function describeUpstreamFailure (response) {
  const status = response.status || 502
  const label = response.statusText || 'Unable to fetch Hyper listing'
  let detail = ''
  try {
    detail = (await readTextWithLimit(response, MAX_UPSTREAM_ERROR_BYTES)).trim()
  } catch {}

  if (!detail) return `${label} (${status})`
  return `${label} (${status}): ${detail.split('\n')[0].slice(0, 300)}`
}

async function readTextWithLimit (response, limit) {
  const body = response.body
  const chunks = []
  let seen = 0

  // Collect bytes and decode once at the end. Bare has no TextDecoder, and
  // decoding per chunk would split multi-byte characters across boundaries
  // anyway. The cap keeps the buffer bounded.
  const push = (chunk) => {
    if (!chunk || !chunk.byteLength) return
    seen += chunk.byteLength
    if (seen > limit) throw createHttpError(413, 'Hyper listing is too large')
    chunks.push(b4a.from(chunk))
  }

  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        push(value)
      }
    } finally {
      if (reader.releaseLock) reader.releaseLock()
    }
    return b4a.toString(b4a.concat(chunks), 'utf8')
  }

  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body) push(chunk)
    return b4a.toString(b4a.concat(chunks), 'utf8')
  }

  const whole = await response.text()
  if (b4a.byteLength(whole) > limit) throw createHttpError(413, 'Hyper listing is too large')
  return whole
}

function parseRequestUrl (rawUrl) {
  try {
    return new URL(String(rawUrl || '/'), `http://${PEERTUNES_LOOPBACK_HOST}`)
  } catch {
    return null
  }
}

function sendText (res, statusCode, message, contentType = 'text/plain; charset=utf-8') {
  const body = String(message || '')
  res.statusCode = statusCode
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Length', String(b4a.byteLength(body)))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Connection', 'close')
  res.end(body)
}

function sendEmpty (res, statusCode) {
  res.statusCode = statusCode
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Connection', 'close')
  res.end()
}

export function sendError (req, res, error) {
  // A client that walked away is not an error worth reporting. Skipping a track
  // disconnects mid-stream, and without this guard that lands below.
  if (req?.aborted || res.destroyed) return

  if (res.headersSent) {
    // Passing a late stream error through Bare's native HTTP callback can abort
    // the JS worklet, taking hyper and PeerChat down with it. Closing the
    // incomplete response is enough for the client.
    res.destroy()
    return
  }

  sendText(res, error?.statusCode || 502, error?.message || 'PeerTunes request failed')
}

function createHttpError (statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}
