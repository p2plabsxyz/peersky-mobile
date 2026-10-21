// The app runs small servers on 127.0.0.1 for its own pages. Any web page can
// aim a request at a loopback port, so each server answers only its own
// origin and refuses everyone else, other loopback servers included: one of
// them may be serving a page someone else wrote.
//
// Another app on the phone can reach the ports too, and it can send any
// headers it likes. So a server that hands out anything private, or starts
// anything, also wants its token: a secret made for each run that only the
// app's own WebView is given.

import b4a from 'b4a'
import { randomBytes } from 'node:crypto'

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

// Where a token goes when it cannot go in the address: a P2PMD note's tunnel
// puts it on the requests of people who came in with the note's address.
export const LOOPBACK_TOKEN_HEADER = 'X-PeerSky-Token'

/** A new token for one run of a local server: 32 random bytes in hex. */
export function createLoopbackToken () {
  return b4a.toString(randomBytes(32), 'hex')
}

/** Whether value is the token, compared in constant time. */
export function isLoopbackToken (value, token) {
  if (typeof value !== 'string' || typeof token !== 'string' || !token) return false
  if (value.length !== token.length) return false
  let difference = 0
  for (let index = 0; index < token.length; index++) {
    difference |= value.charCodeAt(index) ^ token.charCodeAt(index)
  }
  return difference === 0
}

function getHeader (req, name) {
  const value = req.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * @param {object} req
 * @param {{ allowOrigins?: string[] }} [options] Other origins this server
 *   answers, like desktop P2PMD's peersky://p2p.
 */
export function isOwnLoopbackRequest (req, { allowOrigins = [] } = {}) {
  const host = String(getHeader(req, 'host') || '').toLowerCase()
  // A name that resolves to 127.0.0.1 is a rebinding attack, not us.
  if (host && !LOOPBACK_HOSTNAMES.has(host.replace(/:\d+$/, ''))) return false

  const origin = getHeader(req, 'origin')
  if (origin) return allowOrigins.includes(origin) || isSameOrigin(origin, host)

  // No Origin: a same-origin GET, or a no-cors load like <img src> from
  // another site, which Sec-Fetch-Site gives away.
  const site = String(getHeader(req, 'sec-fetch-site') || '').toLowerCase()
  return !site || site === 'same-origin' || site === 'none'
}

function isSameOrigin (origin, host) {
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && Boolean(host) && url.host.toLowerCase() === host
  } catch {
    return false
  }
}
