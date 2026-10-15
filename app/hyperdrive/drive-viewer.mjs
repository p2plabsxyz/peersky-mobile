import { HYPERDRIVE_VIEWER_LOOPBACK_HOST, HYPERDRIVE_VIEWER_LOOPBACK_PORT } from '../../backend/hyperdrive-viewer/constants.mjs'
import { formatViewerUrl, parseViewerUrl, toViewerLocalPath, viewerTitle } from './viewer-route.mjs'

// What passes between the app and the Hyperdrive viewer's page. The page is
// the app's own, served from 127.0.0.1, but it shows files and names from
// drives anyone wrote, so everything it sends is checked like a stranger's.

// Where the viewer's server is, unless its port was taken.
export const DRIVE_VIEWER_LOCAL_URL = `http://${HYPERDRIVE_VIEWER_LOOPBACK_HOST}:${HYPERDRIVE_VIEWER_LOOPBACK_PORT}`

const MAX_MESSAGE_LENGTH = 64 * 1024
const MAX_URL_LENGTH = 8192
const MAX_TITLE_LENGTH = 256
const MAX_NAME_LENGTH = 255
const MAX_COPY_LENGTH = 16 * 1024
const HYPER_URL = /^hyper:\/\/[^/?#\s]+(?:[/?#][^\s]*)?$/i
const WEB_URL = /^https?:\/\/[^/?#\s]+(?:[/?#][^\s]*)?$/i

/** The viewer's page for a viewer address, on the server at localUrl. */
export function createDriveViewerPageUrl (localUrl, viewerUrl) {
  const base = String(localUrl || '').replace(/\/+$/, '')
  const path = toViewerLocalPath(viewerUrl)
  return base && path ? `${base}${path}` : null
}

/**
 * The drive's file and the name a download through the viewer's server asked
 * for, or null when the address is not such a download. A retry asks the
 * server to sign the same download again, for the run going now
 * (signViewerDownload in backend/hyperdrive-viewer/server.mjs).
 */
export function parseDriveViewerDownloadUrl (url) {
  const query = /\?([^#]*)/.exec(String(url || ''))?.[1] || ''
  const params = new URLSearchParams(query)
  const hyperUrl = params.get('url')
  if (!hyperUrl || !params.has('download') || !HYPER_URL.test(hyperUrl)) return null
  return { url: hyperUrl, name: params.get('name') || '' }
}

/** Whether a value is a secret as the viewer's server makes them. */
export function isRunToken (token) {
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token)
}

/** Whether a download's address is one of the viewer's server's, signed by it. */
export function isDriveViewerDownloadUrl (url, localUrl = DRIVE_VIEWER_LOCAL_URL) {
  return isDriveViewerOrigin(url, localUrl) && /^https?:\/\/[^/?#]+\/hyper\/asset\?/i.test(String(url || ''))
}

/**
 * Whether a message came from the viewer's own page. iOS says which page,
 * Android only which origin, so the origin is what is compared.
 */
export function isDriveViewerOrigin (reportedUrl, localUrl) {
  const reported = parseHttpOrigin(reportedUrl)
  const expected = parseHttpOrigin(localUrl)
  return Boolean(reported && expected && reported === expected)
}

/**
 * Whether the viewer's WebView may load this address itself: only the
 * viewer's own pages. Its files and listings are read by the page, never
 * shown in place of it, and everything else opens in a tab of its own.
 */
export function isDriveViewerPageRequest (requestUrl, localUrl) {
  const value = String(requestUrl || '')
  if (value === 'about:blank') return true
  if (!isDriveViewerOrigin(value, localUrl)) return false
  const path = /^[a-z]+:\/\/[^/?#]*(\/[^?#]*)?/i.exec(value)?.[1] || '/'
  return /^\/hyperdrive\/(?:files|photos|videos)(?:\/|$)/.test(path)
}

/**
 * @typedef {{ type: 'route', url: string, title: string }
 *   | { type: 'download', url: string, name: string }
 *   | { type: 'open', url: string }
 *   | { type: 'copy', text: string }
 *   | { type: 'share', url: string, name: string }} DriveViewerMessage
 */

/**
 * A message from the viewer, checked and cleaned, or null when it is not
 * one the app answers:
 *   { type: 'route', url, title }    the viewer moved: the tab's address and title follow
 *   { type: 'download', url, name }  a drive's file to save
 *   { type: 'open', url }            a hyper:// or http(s):// address for a new tab
 *   { type: 'copy', text }
 *   { type: 'share', url, name }     a hyper:// address for the share sheet
 * A message that carries this run's secret anywhere in it is refused whole:
 * the secret never reaches the address bar, the clipboard, another app or a
 * tab.
 * @param {unknown} data
 * @param {{ secret?: string | null }} [options]
 * @returns {DriveViewerMessage | null}
 */
export function parseDriveViewerMessage (data, { secret = null } = {}) {
  if (typeof data !== 'string' || data.length > MAX_MESSAGE_LENGTH) return null

  let message
  try {
    message = JSON.parse(data)
  } catch {
    return null
  }
  if (!message || typeof message !== 'object') return null
  // Read back as plain JSON, so an escape cannot hide it.
  if (secret && carriesSecret(JSON.stringify(message), secret)) return null

  if (message.type === 'route') {
    const route = parseViewerUrl(message.url)
    if (!route) return null
    return { type: 'route', url: formatViewerUrl(route), title: cleanText(message.title, MAX_TITLE_LENGTH) || viewerTitle(route) }
  }

  if (message.type === 'download') {
    const url = cleanUrl(message.url, HYPER_URL)
    // A file, not a folder or a whole drive.
    const path = url ? /^hyper:\/\/[^/?#]+(\/[^?#]*)?/i.exec(url)?.[1] || '' : ''
    if (!url || !path || path.endsWith('/')) return null
    return { type: 'download', url, name: cleanText(message.name, MAX_NAME_LENGTH) || fileNameOf(url) }
  }

  if (message.type === 'open') {
    const url = cleanUrl(message.url, HYPER_URL) || cleanUrl(message.url, WEB_URL)
    return url ? { type: 'open', url } : null
  }

  if (message.type === 'copy') {
    const text = typeof message.text === 'string' ? message.text : ''
    return text && text.length <= MAX_COPY_LENGTH ? { type: 'copy', text } : null
  }

  if (message.type === 'share') {
    const url = cleanUrl(message.url, HYPER_URL)
    return url ? { type: 'share', url, name: cleanText(message.name, MAX_NAME_LENGTH) || fileNameOf(url) } : null
  }

  return null
}

/** The keys of viewer-strings.json: each text, and each plural by its `other`. */
export function viewerStringKeys (list) {
  const strings = Array.isArray(list?.strings) ? list.strings.filter((text) => typeof text === 'string') : []
  const plurals = Array.isArray(list?.plurals)
    ? list.plurals.map((forms) => forms?.other).filter((text) => typeof text === 'string')
    : []
  return [...new Set([...strings, ...plurals])]
}

/**
 * What the viewer reads as window.peerskyViewer before its scripts run. The
 * safe area is all zero: the browser's own bars sit around the page.
 */
export function createDriveViewerConfig ({ platform, language, strings, dark, incognito, epoch, token }) {
  return {
    platform: platform === 'ios' ? 'ios' : 'android',
    language: typeof language === 'string' && language ? language : 'en',
    strings: strings && typeof strings === 'object' ? strings : {},
    dark: dark === true,
    incognito: incognito === true,
    epoch: Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : 0,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    // This run's secret for /api/list and /hyper/asset. The page is the only
    // place it goes.
    token: isRunToken(token) ? token : ''
  }
}

/**
 * The script that sets window.peerskyViewer, and only on a page of the
 * viewer's own origin, so the secret in it can reach no other page even if
 * the WebView were somehow to load one. The two line separators are valid
 * JSON but end a JavaScript string, so they go in escaped.
 */
export function createDriveViewerConfigScript (config, { localUrl = DRIVE_VIEWER_LOCAL_URL } = {}) {
  const origin = JSON.stringify(/^https?:\/\/[^/?#]+/i.exec(String(localUrl || ''))?.[0] || '')
  const json = JSON.stringify(createDriveViewerConfig(config))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `(function () { if (window.location.origin !== ${origin}) return; window.peerskyViewer = ${json}; })(); true;`
}

// The secret is hex, which encoding an address leaves as it is, so it shows
// as itself wherever a message holds it, in upper case or lower.
function carriesSecret (data, secret) {
  return data.toLowerCase().includes(String(secret).toLowerCase())
}

function parseHttpOrigin (url) {
  const match = /^(https?):\/\/([^/?#@\s]+)(?:[/?#]|$)/i.exec(String(url || ''))
  if (!match) return null
  const scheme = match[1].toLowerCase()
  const host = match[2].toLowerCase()
  const port = /:\d+$/.test(host) ? '' : `:${scheme === 'https' ? 443 : 80}`
  return `${scheme}://${host}${port}`
}

function cleanUrl (value, pattern) {
  const url = typeof value === 'string' ? value.trim() : ''
  return url && url.length <= MAX_URL_LENGTH && pattern.test(url) ? url : null
}

// Text from a drive for a title or a file name: no line breaks or other
// control characters, and not too long.
function cleanText (value, limit) {
  return Array.from(typeof value === 'string' ? value : '')
    .filter((character) => {
      const code = character.codePointAt(0)
      return code >= 32 && (code < 127 || code > 159)
    })
    .slice(0, limit)
    .join('')
    .trim()
}

function fileNameOf (url) {
  const name = String(url).replace(/[?#].*$/, '').split('/').filter(Boolean).pop() || ''
  try {
    return cleanText(decodeURIComponent(name), MAX_NAME_LENGTH)
  } catch {
    return cleanText(name, MAX_NAME_LENGTH)
  }
}
