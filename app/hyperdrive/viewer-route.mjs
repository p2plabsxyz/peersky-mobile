// The Hyperdrive viewer's addresses. A hyper:// folder that is not a website
// opens in a view made for what it holds:
//
//   peersky://p2p/hyperdrive/<view>/<host><path>[?auto][#state]
//
// <view> is files, photos or videos. <host> is the hyper:// host as given,
// lower-cased: a key or a DNS name. <path> is a folder of the drive, starting
// and ending with /, each segment percent-encoded. ?auto asks the viewer to
// pick the view itself, and the fragment holds what is open inside it. The
// phone's WebView loads the same path from the viewer's server on
// 127.0.0.1 (backend/hyperdrive-viewer/server.mjs), and the address bar shows
// the peersky:// form. Parsed by hand, not with URL: React Native's URL does
// not take these schemes apart the way Node's does.

export const VIEWER_VIEWS = Object.freeze(['files', 'photos', 'videos'])
export const MAX_VIEWER_URL_LENGTH = 8192

const VIEWER_ADDRESS = /^peersky:\/\/p2p\/hyperdrive\/(files|photos|videos)\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i
const HYPER_ADDRESS = /^hyper:\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i
// A key or a DNS name. A hex key is one 64 character label, longer than DNS
// lets a label be, so keys are taken as keys first.
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/
const KEY = /^(?:[a-z0-9]{52}|[0-9a-f]{64})$/
// What a fragment can hold as the viewer writes one, as #album=/2024/Goa/.
const FRAGMENT = /^#[\w\-.~%!$&'()*+,;=:@/?]*$/
const MAX_FRAGMENT_LENGTH = 2048
// The index files hypercore-fetch serves in place of a folder's list that are
// not a website. The viewer shows them under the list. Only index.html, which
// it serves too, and index.htm make a folder a website.
const README_INDEX = /^(?:readme\.md|readme\.org|index\.md|index\.gmi|index\.gemini|index\.org)$/i

/**
 * The route in a viewer address, or null when it is not one:
 * { view, host, path, auto, hash }. The path is the drive's own, decoded.
 */
export function parseViewerUrl (url) {
  const value = String(url || '').trim()
  if (!value || value.length > MAX_VIEWER_URL_LENGTH) return null

  const match = VIEWER_ADDRESS.exec(value)
  if (!match) return null

  const host = match[2].toLowerCase()
  if (!isDriveHost(host)) return null

  const path = decodePath(match[3] || '/')
  if (path === null) return null

  return {
    view: match[1].toLowerCase(),
    host,
    path,
    auto: hasQueryKey(match[4], 'auto'),
    hash: cleanFragment(match[5])
  }
}

/** The address of a route, in the one form the app keeps. */
export function formatViewerUrl ({ view, host, path, auto = false, hash = '' }) {
  return `peersky://p2p/hyperdrive/${view}/${host}${encodePath(folderPath(path))}${auto ? '?auto' : ''}${cleanFragment(hash)}`
}

/** A viewer address in its one form, or null when it is not one. */
export function normalizeViewerUrl (url) {
  const route = parseViewerUrl(url)
  return route ? formatViewerUrl(route) : null
}

/** The path the viewer's server answers for a viewer address, or null. */
export function toViewerLocalPath (url) {
  const route = parseViewerUrl(url)
  if (!route) return null
  return `/hyperdrive/${route.view}/${route.host}${encodePath(route.path)}${route.auto ? '?auto' : ''}${route.hash}`
}

/**
 * The viewer address for a hyper:// folder, which lets the viewer pick the
 * view, or null when the address cannot be one.
 */
export function viewerUrlFor (hyperUrl, { view = 'files', auto = true } = {}) {
  const match = HYPER_ADDRESS.exec(String(hyperUrl || '').trim())
  if (!match || !VIEWER_VIEWS.includes(view)) return null

  const host = match[1].toLowerCase()
  if (!isDriveHost(host)) return null

  const path = decodePath(match[2] || '/')
  if (path === null) return null

  const url = formatViewerUrl({ view, host, path, auto })
  return url.length <= MAX_VIEWER_URL_LENGTH ? url : null
}

/** The hyper:// address of the folder a route shows. */
export function hyperUrlForViewer (route) {
  return `hyper://${route.host}${encodePath(folderPath(route.path))}`
}

/** What a tab showing the viewer is called until the viewer names it. */
export function viewerTitle (route) {
  const name = String(route?.path || '').split('/').filter(Boolean).pop()
  if (name) return name
  const host = String(route?.host || '')
  return KEY.test(host) ? `${host.slice(0, 6)}…${host.slice(-4)}` : host
}

/** Whether a hyper:// address asks for the raw listing: ?raw. */
export function isRawListingUrl (hyperUrl) {
  const match = HYPER_ADDRESS.exec(String(hyperUrl || '').trim())
  return Boolean(match) && hasQueryKey(match[3], 'raw')
}

/**
 * Where a hyper:// load should go instead of showing what came back: the
 * viewer, for a folder that is not a website. That is a folder that came back
 * as hypercore-fetch's JSON listing, or as its README or another index file
 * that is not a web page. ?raw and hypercore-fetch's own ?noResolve keep what
 * came back, and so does an address that names the README itself. Null for
 * everything else, which shows as before.
 *
 * @param {string} requestedUrl The hyper:// address the tab asked for.
 * @param {{ ok?: boolean, body?: string, headers?: Record<string, string>, downloadUrl?: string, mediaUrl?: string }} response
 *   What RPC_HYPER_FETCH answered.
 */
export function getFolderViewerRedirect (requestedUrl, response) {
  const match = HYPER_ADDRESS.exec(String(requestedUrl || '').trim())
  if (!match || hasQueryKey(match[3], 'raw') || hasQueryKey(match[3], 'noResolve')) return null
  if (!response?.ok) return null

  // hypercore-fetch names what it served in a canonical link: the folder for
  // its listing, the file for a file, an index file served for its folder
  // included.
  const headers = response.headers || {}
  const requested = match[2] || '/'
  const canonical = /<([^>]*)>\s*;\s*rel="?canonical"?/i.exec(String(headers.link || ''))?.[1]
  const served = canonical ? HYPER_ADDRESS.exec(canonical)?.[2] || '/' : requested

  if (requested.endsWith('/') && isReadmeOfFolder(served, requested)) return viewerUrlFor(requestedUrl)

  if (response.downloadUrl || response.mediaUrl) return null
  if (!/^application\/json\b/i.test(String(headers['content-type'] || '').trim())) return null
  // A JSON file is a file.
  if (!served.endsWith('/')) return null
  if (!/^\s*\[/.test(String(response.body || ''))) return null

  return viewerUrlFor(requestedUrl)
}

/** '/a b/c/' to '/a%20b/c/'. */
export function encodePath (path) {
  return String(path).split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

// '/a%20b/c' to '/a b/c/', as the viewer reads it (route.js decodePath). Null
// when a segment cannot be decoded, holds a slash once decoded, or is . or ..
function decodePath (encoded) {
  const out = []
  for (const segment of folderPath(encoded).split('/')) {
    let decoded
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return null
    }
    if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0') || decoded === '.' || decoded === '..') return null
    out.push(decoded)
  }
  return out.join('/')
}

// Whether a served path is a README or another index file that is not a web
// page, right inside the folder. Names compare decoded, the file's in any case.
function isReadmeOfFolder (served, folder) {
  const folderNames = pathNames(folder)
  const servedNames = pathNames(served)
  if (!folderNames || !servedNames || servedNames.length !== folderNames.length + 1) return false
  if (folderNames.some((name, index) => name !== servedNames[index])) return false
  return README_INDEX.test(servedNames[servedNames.length - 1])
}

// '/a%20b/c/' to ['a b', 'c']. Null when a name cannot be decoded.
function pathNames (path) {
  const names = []
  for (const part of String(path).split('/')) {
    if (!part) continue
    try {
      names.push(decodeURIComponent(part))
    } catch {
      return null
    }
  }
  return names
}

function isDriveHost (host) {
  return KEY.test(host) || HOST.test(host)
}

function folderPath (path) {
  let out = String(path || '/')
  if (!out.startsWith('/')) out = `/${out}`
  if (!out.endsWith('/')) out += '/'
  return out.replace(/\/{2,}/g, '/')
}

function hasQueryKey (query, key) {
  return String(query || '').replace(/^\?/, '').split('&').some((part) => part.split('=')[0] === key)
}

function cleanFragment (hash) {
  const value = String(hash || '')
  if (value === '#') return ''
  return value.length <= MAX_FRAGMENT_LENGTH && FRAGMENT.test(value) ? value : ''
}
