// The note editor is the app's own page, loaded from a string, and it can ask
// the app to publish and to save images. The room's server only answers its
// requests. It never gets to put a page of its own where the editor is.

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'hyper:'])

export function createP2pmdNonce (bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16) {
    throw new TypeError('A P2PMD nonce needs at least 16 random bytes')
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The editor's address. The nonce keeps a link in a note from naming it, which
 * would load the room's own page in the editor's place.
 */
export function createP2pmdEditorUrl (roomBaseUrl, role, nonce) {
  const url = new URL(`${String(roomBaseUrl).replace(/\/+$/, '')}/`)
  url.searchParams.set('role', role === 'host' ? 'host' : 'client')
  url.searchParams.set('editor', nonce)
  return url.href
}

function withoutHash (url) {
  return String(url || '').split('#')[0]
}

/**
 * 'load' for the editor itself, 'open' for a link to show in a browser tab, else 'block'.
 * @param {{ url: string, isTopFrame?: boolean }} request
 * @param {string} editorUrl
 */
export function getP2pmdEditorRequestAction ({ url, isTopFrame = true }, editorUrl) {
  if (!isTopFrame) return 'block'
  if (url === 'about:blank' || withoutHash(url) === withoutHash(editorUrl)) return 'load'
  try {
    return LINK_PROTOCOLS.has(new URL(url).protocol) ? 'open' : 'block'
  } catch {
    return 'block'
  }
}

/**
 * iOS reports the page's own address. Android reports only the origin a
 * message came from, or about:blank on a WebView too old to say. Nothing but
 * the editor ever loads at the room's origin in this view, so that is enough.
 */
export function isP2pmdEditorMessage (reportedUrl, editorUrl) {
  const url = String(reportedUrl || '')
  if (url === '' || url === 'about:blank') return true
  if (withoutHash(url) === withoutHash(editorUrl)) return true
  try {
    return url === new URL(editorUrl).origin
  } catch {
    return false
  }
}
