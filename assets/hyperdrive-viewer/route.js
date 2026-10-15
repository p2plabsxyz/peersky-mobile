/* eslint-env browser */
// The viewer's address: /hyperdrive/<view>/<host><path>[?auto][#state].
//
// <host> is the hyper:// host as given, lower-cased: a z-base-32 key, a hex
// key or a DNS name. <path> is a folder in the drive, starting and ending
// with /, each segment percent-encoded. The fragment holds what is open
// inside a view, as `#places`, `#album=/2024/Goa/` or `#item=/2024/IMG_1.jpg`.

export const VIEWS = Object.freeze(['files', 'photos', 'videos'])

// A DNS name: labels of at most 63 characters.
const DNS_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/
// A drive key: 52 characters of z-base-32, or 64 of hex (longer than a DNS
// label may be).
const KEY = /^(?:[ybndrfg8ejkmcpqxot1uwisza345h769]{52}|[0-9a-f]{64})$/

/** A key or a DNS name, lower-case. */
export function isValidHost (host) {
  return typeof host === 'string' && (KEY.test(host) || DNS_NAME.test(host))
}

/** True for a drive key rather than a DNS name. */
export function isKeyHost (host) {
  return KEY.test(host)
}

/** The first 6 and last 4 characters of a key; a DNS name in full. */
export function shortHost (host) {
  if (!isKeyHost(host)) return host
  return `${host.slice(0, 6)}…${host.slice(-4)}`
}

/** '/a b/c/' to '/a%20b/c/'. */
export function encodePath (path) {
  return String(path).split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

/**
 * '/a%20b/c/' to '/a b/c/'. Null when a segment cannot be decoded, holds a
 * slash once decoded, or is '.' or '..'.
 */
export function decodePath (encoded) {
  const segments = String(encoded).split('/')
  const out = []
  for (const segment of segments) {
    let decoded
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return null
    }
    if (decoded.includes('/') || decoded.includes('\\') || decoded === '.' || decoded === '..' || decoded.includes('\0')) return null
    out.push(decoded)
  }
  return out.join('/')
}

/** A folder path with one / at each end. */
export function folderPath (path) {
  let out = String(path || '/')
  if (!out.startsWith('/')) out = '/' + out
  if (!out.endsWith('/')) out += '/'
  return out.replace(/\/{2,}/g, '/')
}

/** The folder a path is in: '/a/b.jpg' and '/a/b/' both give '/a/'. */
export function parentPath (path) {
  const trimmed = String(path).replace(/\/+$/, '')
  const at = trimmed.lastIndexOf('/')
  return at <= 0 ? '/' : trimmed.slice(0, at + 1)
}

/** The last segment of a path, without slashes. */
export function lastSegment (path) {
  const parts = String(path).split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

/** The name a folder goes by: its last segment, or the short host at the root. */
// The drive's own name, when the device knows it, stands for its root.
export function folderTitle (host, path, name) {
  const known = typeof name === 'string' ? name.trim() : ''
  return lastSegment(path) || known || shortHost(host)
}

/**
 * `#places&album=/2024/Goa/` to { places: true, album: '/2024/Goa/' }.
 * Keys are kept in order; a value is decoded, a bare key is true.
 */
export function parseHash (hash) {
  const out = {}
  const text = String(hash || '').replace(/^#/, '')
  if (!text) return out
  for (const part of text.split('&')) {
    if (!part) continue
    const at = part.indexOf('=')
    const rawKey = at === -1 ? part : part.slice(0, at)
    let key
    let value
    try {
      key = decodeURIComponent(rawKey)
      value = at === -1 ? true : decodeURIComponent(part.slice(at + 1))
    } catch {
      continue
    }
    if (!/^[\w-]{1,32}$/.test(key)) continue
    out[key] = value
  }
  return out
}

function encodeHashValue (value) {
  // Slashes stay readable: #album=/2024/Goa/
  return encodeURIComponent(String(value)).replace(/%2F/gi, '/')
}

/** { places: true, album: '/2024/' } to '#places&album=/2024/'; '' when empty. */
export function buildHash (state) {
  const parts = []
  for (const [key, value] of Object.entries(state || {})) {
    if (value === undefined || value === null || value === false || value === '') continue
    parts.push(value === true ? encodeURIComponent(key) : `${encodeURIComponent(key)}=${encodeHashValue(value)}`)
  }
  return parts.length ? '#' + parts.join('&') : ''
}

/**
 * The route in an address, or null when it is not a viewer address:
 * { view, host, path, auto, hash }.
 */
export function parseRoute (loc = window.location) {
  const match = /^\/hyperdrive\/(files|photos|videos)\/([^/]+)(\/.*)?$/.exec(loc.pathname)
  if (!match) return null
  const host = match[2].toLowerCase()
  if (!isValidHost(host)) return null
  const path = decodePath(folderPath(match[3] || '/'))
  if (path === null) return null
  const auto = new URLSearchParams(loc.search).has('auto')
  return { view: match[1], host, path: folderPath(path), auto, hash: parseHash(loc.hash) }
}

/** The page's own address for a route: /hyperdrive/<view>/<host><path>#hash */
export function routeHref ({ view, host, path, hash }) {
  return `/hyperdrive/${view}/${host}${encodePath(folderPath(path))}${typeof hash === 'string' ? hash : buildHash(hash)}`
}

/** The address PeerSky shows for a route: peersky://p2p/hyperdrive/... */
export function peerskyHref (route) {
  return 'peersky://p2p' + routeHref(route)
}

/** hyper://<host><path>, each segment encoded. */
export function hyperHref (host, path) {
  return `hyper://${host}${encodePath(path)}`
}
