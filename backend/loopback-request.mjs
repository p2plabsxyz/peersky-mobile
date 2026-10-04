// The app runs small servers on 127.0.0.1 for its own pages. Any web page can
// aim a request at a loopback port, so each server answers only its own
// origin and refuses everyone else, other loopback servers included: one of
// them may be serving a page someone else wrote.

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

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
