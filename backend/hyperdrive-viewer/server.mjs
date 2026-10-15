import b4a from 'b4a'
import { createLoopbackToken, isLoopbackToken, isOwnLoopbackRequest } from '../loopback-request.mjs'
import { streamHyperAsset } from '../hyper/asset-server-core.mjs'
import { normalizeDownloadFilename, signHyperAssetUrl } from '../hyper/assets.mjs'
import { parseHyperUrl } from '../hyper/url.mjs'
import { HYPERDRIVE_VIEWER_LOOPBACK_HOST, HYPERDRIVE_VIEWER_LOOPBACK_PORT } from './constants.mjs'
import { createListSignal, listHyperdriveFolder } from './drive-list.mjs'
import { knownDriveName, readPrivateDriveRecords } from './drive-names.mjs'
import viewerAssets from './viewer-runtime.mjs'

// The Hyperdrive viewer's own server: the viewer's page for each view, its
// files, a drive's files read through the worklet, and a folder's listing.
// The page is the app's own, so it reads drives the way the app does,
// private ones included (drive-list.mjs).
//
// The origin checks keep websites out, but another app on the phone can call
// 127.0.0.1 too, and sends no Origin at all. So a drive's files and listings
// also need the secret the server makes each time it starts: the app hands it
// to the viewer's page alone (window.peerskyViewer.token), and the page puts
// it on every /api/list and /hyper/asset address it makes. A download the app
// asks for carries a signature for its one file instead (signViewerDownload),
// so the address a download record keeps opens nothing else. The page and
// the viewer's own files need neither.

// One page for every view. It reads the view, the drive and the folder from
// its own address.
const VIEWER_PAGE = /^\/hyperdrive\/(?:files|photos|videos)(?:\/|$)/
const VIEWER_ASSET_PREFIX = '/hyperdrive/viewer/'

// Content types the proxy hands back as they are. Everything else, HTML, SVG
// and XML among it, is application/octet-stream: a drive is untrusted, and
// this origin keeps what the viewer made of other drives. Subtitles stay
// text/vtt, which a <track> needs.
const PROXYABLE_CONTENT_TYPES = /^(?:audio|video)\/|^image\/(?!svg\b)|^text\/(?:plain|vtt)\b|^application\/json\b/i

const STATIC_CONTENT_TYPES = {
  css: 'text/css; charset=utf-8',
  gif: 'image/gif',
  html: 'text/html; charset=utf-8',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  otf: 'font/otf',
  png: 'image/png',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  txt: 'text/plain; charset=utf-8',
  webmanifest: 'application/manifest+json',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2'
}

let server = null
let serverInfo = null
let serverTransition = Promise.resolve()
let bareHttp = null
let hyperFetchModule = null
let hyperRuntimeModule = null

export async function startHyperdriveViewerServer () {
  return withServerTransition(async () => {
    if (server && serverInfo) {
      return {
        ok: true,
        running: true,
        ...serverInfo
      }
    }

    const httpImpl = await getBareHttp()
    const options = {
      httpImpl,
      // New with every start, so one from an earlier run is worth nothing.
      token: createLoopbackToken(),
      ...await hyperdriveViewerDriveAccess()
    }

    let bound
    let usingFallbackPort = false
    try {
      bound = await bindServer(options, HYPERDRIVE_VIEWER_LOOPBACK_PORT)
    } catch (error) {
      // Something else holds the fixed port. The viewer still works; it only
      // makes its small pictures again, in an origin of its own.
      console.warn('[hyperdrive viewer] Fixed loopback port unavailable, using a random port:', error?.message || error)
      bound = await bindServer(options, 0)
      usingFallbackPort = true
    }

    server = bound.instance
    serverInfo = {
      host: HYPERDRIVE_VIEWER_LOOPBACK_HOST,
      port: bound.port,
      localUrl: `http://${HYPERDRIVE_VIEWER_LOOPBACK_HOST}:${bound.port}`,
      usingFallbackPort,
      // For the app, which hands it to the viewer's page. Never logged.
      token: options.token
    }

    return {
      ok: true,
      running: true,
      ...serverInfo
    }
  })
}

export async function stopHyperdriveViewerServer () {
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

/**
 * How the server reads drives in the app: the routed reads the browser's
 * media and PeerTunes use, so this phone's private drives and its linked
 * devices' open with their keys, ranges included, and the listing over the
 * same routing. A drive's name comes from the private drive list Link Device
 * keeps beside this phone's identity, read again for each drive's top.
 */
export async function hyperdriveViewerDriveAccess () {
  const { ensureFetchGlobals, routedHyperFetch, routedHyperRangeFetch } = await getHyperFetchModule()
  const {
    adoptLinkedPrivateDriveIfReadable,
    isPrivateHyperAddress,
    withHyperRuntimeForAddress
  } = await getHyperRuntimeModule()
  const { refreshHyperRuntimeNetwork } = await import('../hyper/network-refresh.mjs')
  const { getDefaultIdentityStoragePath } = await import('../backup/device-keys.mjs')

  return {
    fetch: routedHyperFetch,
    fetchRange: routedHyperRangeFetch,
    ensureGlobals: ensureFetchGlobals,
    listFolder: (url, listOptions) => listHyperdriveFolder(url, {
      ...listOptions,
      withRuntime: withHyperRuntimeForAddress,
      isPrivate: isPrivateHyperAddress,
      opensAsPrivate: async (address) => await isPrivateHyperAddress(address) ||
        await adoptLinkedPrivateDriveIfReadable(address),
      refreshNetwork: refreshHyperRuntimeNetwork,
      driveName: (id) => knownDriveName(readPrivateDriveRecords(getDefaultIdentityStoragePath()), id)
    })
  }
}

/**
 * @param {object} options
 * @param {string} options.token The secret this run's reads of drives need.
 * @param {(url: string, options: { recursive: boolean, signal: object }) => Promise<object>} options.listFolder
 * @param {Record<string, { encoding: string, content: string }>} [options.assets]
 *   The viewer's files, by path under viewer/. Tests hand in their own.
 */
export function createHyperdriveViewerHttpServer ({
  httpImpl,
  fetch,
  fetchRange,
  ensureGlobals = () => {},
  listFolder,
  token,
  assets = viewerAssets
} = {}) {
  if (!httpImpl?.createServer) {
    throw new Error('The Hyperdrive viewer server requires an HTTP implementation.')
  }
  if (typeof fetch !== 'function') {
    throw new Error('The Hyperdrive viewer server requires a Hyper fetch implementation.')
  }
  if (typeof listFolder !== 'function') {
    throw new Error('The Hyperdrive viewer server requires a way to list drives.')
  }
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('The Hyperdrive viewer server requires a secret for this run.')
  }

  return httpImpl.createServer((req, res) => {
    handleRequest(req, res, { fetch, fetchRange, ensureGlobals, listFolder, token, assets })
  })
}

/**
 * A file of the viewer by its address, /hyperdrive/viewer/<path>. Only a path
 * that names a bundled file resolves: dot segments, backslashes and broken
 * encoding are refused before the lookup.
 */
export function resolveViewerAsset (pathname, assets = viewerAssets) {
  const value = String(pathname || '')
  if (!value.startsWith(VIEWER_ASSET_PREFIX)) return null

  let decoded
  try {
    decoded = decodeURIComponent(value.slice(VIEWER_ASSET_PREFIX.length))
  } catch {
    return null
  }

  if (!decoded || decoded.includes('\\') || decoded.includes('\0')) return null
  const segments = decoded.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  if (!Object.prototype.hasOwnProperty.call(assets, decoded)) return null

  return { key: decoded, ...assets[decoded] }
}

/** Whether an address is one of the viewer's pages: /hyperdrive/<view>/... */
export function isViewerPagePath (pathname) {
  return VIEWER_PAGE.test(String(pathname || ''))
}

function handleRequest (req, res, { fetch, fetchRange, ensureGlobals, listFolder, token, assets }) {
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

  if (requestUrl.pathname === '/hyper/asset') {
    if (!hasRunToken(requestUrl, token) && !hasDownloadSignature(requestUrl, token)) {
      sendText(res, 403, 'Forbidden')
      return
    }
    serveHyperAsset(req, res, { fetch, fetchRange, ensureGlobals }, requestUrl)
      .catch((error) => sendError(req, res, error))
    return
  }

  if (requestUrl.pathname === '/api/list') {
    if (req.method !== 'GET') {
      sendText(res, 405, 'Method not allowed')
      return
    }
    if (!hasRunToken(requestUrl, token)) {
      sendJson(res, 403, { code: 'unknown', message: 'Forbidden' })
      return
    }
    serveListing(req, res, listFolder, requestUrl)
      .catch((error) => sendError(req, res, error))
    return
  }

  if (isViewerPagePath(requestUrl.pathname)) {
    const page = Object.prototype.hasOwnProperty.call(assets, 'index.html')
      ? { key: 'index.html', ...assets['index.html'] }
      : null
    if (!page) {
      sendText(res, 404, 'The Hyperdrive viewer is not in this build')
      return
    }
    sendStaticAsset(req, res, page, { page: true })
    return
  }

  const asset = resolveViewerAsset(requestUrl.pathname, assets)
  if (!asset) {
    sendText(res, 404, 'Not found')
    return
  }

  sendStaticAsset(req, res, asset)
}

// Whether the address carries this run's secret. Both checks compare in
// constant time.
function hasRunToken (requestUrl, token) {
  return isLoopbackToken(requestUrl.searchParams.get('token'), token)
}

// Whether the address is a download signed for the one file it names.
function hasDownloadSignature (requestUrl, token) {
  const url = requestUrl.searchParams.get('url')
  if (!url || !requestUrl.searchParams.has('download')) return false
  return isLoopbackToken(requestUrl.searchParams.get('sig'), signHyperAssetUrl(token, url))
}

/**
 * A download of one file of a drive through the viewer's server, saved under
 * the name it had in the drive. It is signed for that file alone with this
 * run's secret, as backend/hyper/asset-server.mjs signs its links: the
 * address carries no secret, opens no other file, and opens nothing once the
 * server has started again. Null for an address that is not a drive's file.
 */
export function signViewerDownload ({ localUrl, token, url, name = '' }) {
  const target = parseHyperUrl(url)
  if (target.error || target.driveAddress === 'default' || target.pathname.endsWith('/')) return null
  const params = [`url=${encodeURIComponent(url)}`, 'download=1']
  const fileName = typeof name === 'string' ? name.slice(0, 255) : ''
  if (fileName) params.push(`name=${encodeURIComponent(fileName)}`)
  params.push(`sig=${signHyperAssetUrl(token, url)}`)
  return `${String(localUrl).replace(/\/+$/, '')}/hyper/asset?${params.join('&')}`
}

/** The signed address for a download the app was asked for. */
export async function createHyperdriveViewerDownload (request) {
  const { url, name } = request || {}
  const running = await startHyperdriveViewerServer()
  const downloadUrl = signViewerDownload({ localUrl: running.localUrl, token: running.token, url, name })
  return downloadUrl
    ? { ok: true, downloadUrl }
    : { ok: false, error: 'Only a file in a drive can be downloaded.' }
}

async function serveHyperAsset (req, res, { fetch, fetchRange, ensureGlobals }, requestUrl) {
  const assetUrl = requestUrl.searchParams.get('url')
  if (!assetUrl) {
    sendText(res, 400, 'Missing asset url')
    return
  }

  const parsed = parseHyperUrl(assetUrl)
  if (parsed.error || parsed.driveAddress === 'default') {
    sendText(res, 400, parsed.error || 'A hyper:// address is needed')
    return
  }

  ensureGlobals()

  // Download from the viewer: saved under the name it had in the drive.
  const downloadName = requestUrl.searchParams.has('download')
    ? normalizeDownloadFilename(requestUrl.searchParams.get('name'), assetUrl)
    : null
  await streamHyperAsset(fetch, fetchRange, assetUrl, req, guardProxyResponse(res), downloadName)
}

// Every file under a folder, for the viewer to sort into its views. A viewer
// that stops waiting stops the listing too.
async function serveListing (req, res, listFolder, requestUrl) {
  const url = requestUrl.searchParams.get('url')
  if (!url) {
    sendJson(res, 400, { code: 'unknown', message: 'Missing url' })
    return
  }

  const signal = createListSignal()
  const stop = () => signal.abort()
  req.once?.('aborted', stop)
  res.once?.('close', stop)

  let result
  try {
    result = await listFolder(url, {
      recursive: requestUrl.searchParams.get('recursive') === '1',
      signal
    })
  } finally {
    req.off?.('aborted', stop)
    res.off?.('close', stop)
  }

  if (signal.aborted || req.aborted || res.destroyed) return

  if (!result?.ok) {
    sendJson(res, result?.status || 500, {
      code: result?.code || 'unknown',
      message: result?.message || 'The folder could not be listed.'
    })
    return
  }

  sendJson(res, 200, {
    entries: result.entries,
    truncated: result.truncated === true,
    private: result.private === true,
    writable: result.writable === true,
    ...(typeof result.name === 'string' && result.name ? { name: result.name } : {})
  })
}

function sendStaticAsset (req, res, asset, { page = false } = {}) {
  const extension = asset.key.slice(asset.key.lastIndexOf('.') + 1).toLowerCase()
  const body = asset.encoding === 'base64' ? b4a.from(asset.content, 'base64') : b4a.from(asset.content)

  res.statusCode = 200
  res.setHeader('Content-Type', STATIC_CONTENT_TYPES[extension] || 'application/octet-stream')
  res.setHeader('Content-Length', String(body.byteLength))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (page || extension === 'html') {
    // The viewer shows private drives. No other page may frame it, even on
    // a WebView too old to say where a request came from.
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
  }
  res.setHeader('Connection', 'close')

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  res.end(body)
}

// The proxy carries bytes from an untrusted drive. Three things must not get
// through: the wildcard CORS the shared streamer sets, which would let any
// website read the response; a renderable content type, which would let a
// drive run scripts on the viewer's origin; and a cache header, which would
// put a private drive's files in the WebView's disk cache.
function guardProxyResponse (res) {
  return new Proxy(res, {
    get (target, property) {
      if (property === 'setHeader') {
        return (name, value) => {
          const header = String(name).toLowerCase()
          if (header.startsWith('access-control-')) return target
          if (header === 'content-type') return target.setHeader(name, safeProxyContentType(value))
          if (header === 'cache-control') return target.setHeader(name, 'no-store')
          return target.setHeader(name, value)
        }
      }

      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

export function safeProxyContentType (value) {
  const contentType = String(value || '')
  return PROXYABLE_CONTENT_TYPES.test(contentType) ? contentType : 'application/octet-stream'
}

async function bindServer (options, port) {
  const instance = createHyperdriveViewerHttpServer(options)

  try {
    const address = await listen(instance, port)
    const boundPort = typeof address === 'object' && address ? address.port : null

    if (!Number.isInteger(boundPort) || boundPort < 1) {
      throw new Error('The Hyperdrive viewer server started without a valid port')
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
    instance.listen(port, HYPERDRIVE_VIEWER_LOOPBACK_HOST)
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

// Loaded lazily so tests can drive the server with a fake fetch, a fake list
// and Node's http module without pulling the Hyper SDK into the process.
async function getHyperFetchModule () {
  if (!hyperFetchModule) {
    hyperFetchModule = await import('../hyper/fetch.mjs')
  }

  return hyperFetchModule
}

async function getHyperRuntimeModule () {
  if (!hyperRuntimeModule) {
    hyperRuntimeModule = await import('../hyper/runtime.mjs')
  }

  return hyperRuntimeModule
}

function parseRequestUrl (rawUrl) {
  try {
    return new URL(String(rawUrl || '/'), `http://${HYPERDRIVE_VIEWER_LOOPBACK_HOST}`)
  } catch {
    return null
  }
}

function sendJson (res, statusCode, value) {
  sendText(res, statusCode, JSON.stringify(value), 'application/json; charset=utf-8')
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
  // A viewer that moved on, as scrolling past a video does, is not an error.
  if (req?.aborted || res.destroyed) return

  if (res.headersSent) {
    // Passing a late stream error through Bare's native HTTP callback can
    // abort the JS worklet, taking hyper and PeerChat down with it. Closing
    // the incomplete response is enough for the client.
    res.destroy()
    return
  }

  sendText(res, error?.statusCode || 502, error?.message || 'Hyperdrive viewer request failed')
}
