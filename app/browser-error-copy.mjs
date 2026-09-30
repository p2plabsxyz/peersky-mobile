/**
 * What a failed page says.
 *
 * "Page failed" over a raw error string is a status line, not a sentence. The
 * version people can act on names the site, says what probably happened, and
 * suggests the one thing worth trying. The raw message stays, underneath and
 * out of the way, because when it does matter it matters a lot.
 */
export function describeBrowserError (targetUrl, message) {
  const site = describeSite(targetUrl)
  const detail = String(message || '').trim()

  if (/\b(404|not found)\b/i.test(detail)) {
    return {
      title: 'This page is missing',
      body: `${site} answered, but there is nothing at this address. The page may have moved or been deleted.`
    }
  }

  if (/\b(403|forbidden|unauthori[sz]ed|401)\b/i.test(detail)) {
    return {
      title: 'This page is not open to you',
      body: `${site} refused the request. You may need to sign in, or the page may be private.`
    }
  }

  if (/\b(5\d\d|server error|internal error|bad gateway|unavailable)\b/i.test(detail)) {
    return {
      title: 'This site is having trouble',
      body: `Something went wrong at ${site}, not here. Trying again in a moment usually works.`
    }
  }

  if (/timed? ?out|timeout/i.test(detail)) {
    return {
      title: 'This site took too long',
      body: `${site} did not answer in time. It may be busy, or your connection may be slow.`
    }
  }

  if (/peer|swarm|no one|not found on the network|offline/i.test(detail) && isPeerUrl(targetUrl)) {
    return {
      title: 'Nobody is sharing this yet',
      body: 'This address is held by other people’s devices, and none of them are online right now. It will load as soon as one is.'
    }
  }

  return {
    title: 'This page would not load',
    body: `PeerSky could not reach ${site}. Check your connection, then try again.`
  }
}

function isPeerUrl (targetUrl) {
  return /^(?:hyper|hs|ipfs|ipns):\/\//i.test(String(targetUrl || ''))
}

// The host on its own, because that is the part somebody recognises. A peer
// address has a key for a host, which nobody recognises, so those say so
// instead of showing sixty four characters of hex.
function describeSite (targetUrl) {
  const value = String(targetUrl || '').trim()
  if (!value) return 'this page'

  try {
    const { host } = new URL(value)
    if (!host) return 'this page'
    if (isPeerUrl(value) && /^[0-9a-f]{32,}$/i.test(host)) return 'this address'
    return host.replace(/^www\./i, '')
  } catch {
    return 'this page'
  }
}
