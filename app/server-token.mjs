// PeerTunes and an open P2PMD note each listen on 127.0.0.1, where any app on
// the phone can reach them. Each run makes a token, and only the app's own
// WebView is given it, here, before its page loads. The page adds it to what
// it asks for. It is never in anything served, so fetching the page does not
// give it away.

const SERVER_TOKEN = /^[0-9a-f]{64}$/

/**
 * The script that hands a page its server's token, as window.peerskyServerToken.
 * Anything that is not a token gives the page none, and the server refuses it.
 * @param {string | null | undefined} token
 */
export function createServerTokenScript (token) {
  const value = typeof token === 'string' && SERVER_TOKEN.test(token) ? token : ''
  return `window.peerskyServerToken = ${JSON.stringify(value)}; true;`
}

// This device's reset id, which changes each time its P2P data is cleared.
// PeerTunes keeps its songs in the page's own storage, out of reach of the
// clear, and empties them when it sees a new id (p2p-reset.mjs).
export function createResetIdScript (resetId) {
  const value = typeof resetId === 'string' && /^[0-9a-f]{32}$/.test(resetId) ? resetId : ''
  return `window.peerskyResetId = ${JSON.stringify(value)}; true;`
}
