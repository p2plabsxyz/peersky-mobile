/**
 * What the padlock in a browser actually tells you, for the schemes PeerSky
 * speaks.
 *
 * Only two things matter to somebody looking at it: can anybody on the way read
 * or change this, and where did it come from. So there are four answers rather
 * than a badge per scheme.
 */
export const SITE_SECURITY = {
  SECURE: 'secure',
  INSECURE: 'insecure',
  PEER: 'peer',
  INTERNAL: 'internal',
  UNKNOWN: 'unknown'
}

export function getSiteSecurity (url) {
  const value = String(url || '').trim()
  if (!value) return SITE_SECURITY.UNKNOWN

  const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase()
  if (!scheme) return SITE_SECURITY.UNKNOWN

  // Pages the app serves itself. Nothing left the device to draw them.
  if (scheme === 'peersky' || scheme === 'about' || scheme === 'file') return SITE_SECURITY.INTERNAL
  // Content addressed and signed: a peer cannot hand you something else and
  // have it verify, which is a different promise from a certificate.
  if (scheme === 'hyper' || scheme === 'hs' || scheme === 'ipfs' || scheme === 'ipns') return SITE_SECURITY.PEER
  if (scheme === 'https') return SITE_SECURITY.SECURE
  if (scheme === 'http') {
    // Nothing leaves the device for these, whatever the scheme says.
    return isLoopbackHost(value) ? SITE_SECURITY.INTERNAL : SITE_SECURITY.INSECURE
  }
  return SITE_SECURITY.UNKNOWN
}

function isLoopbackHost (url) {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

export function describeSiteSecurity (state) {
  if (state === SITE_SECURITY.SECURE) {
    return {
      title: 'Connection is encrypted',
      body: 'Nobody between this phone and the site can read or change what you send.'
    }
  }
  if (state === SITE_SECURITY.INSECURE) {
    return {
      title: 'Connection is not encrypted',
      body: 'Anybody on the same network can read and change what you send. Do not enter a password or card number here.'
    }
  }
  if (state === SITE_SECURITY.PEER) {
    return {
      title: 'Served by peers',
      body: 'This came from other devices rather than a server, and its address is a key: the content is verified against it, so nobody can hand you something else.'
    }
  }
  if (state === SITE_SECURITY.INTERNAL) {
    return {
      title: 'Part of PeerSky',
      body: 'This page is the app itself. Nothing left the device to show it.'
    }
  }
  return {
    title: 'No connection information',
    body: 'PeerSky cannot say anything about how this page was loaded.'
  }
}
