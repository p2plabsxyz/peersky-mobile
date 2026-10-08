export function parseHyperUrl (url) {
  if (!url || typeof url !== 'string') {
    return { error: 'Missing required "url"' }
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { error: 'Invalid URL format' }
  }

  if (parsed.protocol !== 'hyper:') {
    return { error: 'Only hyper:// URLs are supported' }
  }

  if (parsed.hostname && !isValidHyperHost(parsed.hostname)) {
    return { error: 'Invalid URL format' }
  }

  const normalizedPath = normalizeHyperPath(getRawHyperPath(url))
  if (normalizedPath.error) return normalizedPath

  return {
    driveAddress: parsed.hostname ? `hyper://${parsed.hostname}/` : 'default',
    pathname: normalizedPath.pathname
  }
}

/**
 * The query a hyper:// address carries, if any.
 *
 * parseHyperUrl reports the drive and the path and drops everything else, which
 * is right for reading a page. Writing needs the query kept: creating a named
 * drive is "hyper://localhost/?key=myapp" and without the key it is a request
 * for something else entirely.
 */
export function getHyperSearch (url) {
  try {
    const { search } = new URL(url)
    // Only what a query can legitimately hold, so nothing smuggles a newline
    // or a control character into the request line.
    return /^\??[\w\-.~%!$&'()*+,;=:@/?]*$/.test(search) ? search : ''
  } catch {
    return ''
  }
}

/**
 * What a write address asked to be stored as: '', 'public', 'private' or
 * 'device'.
 *
 * The Hyperdrive page sends this alongside the key. Private and device-only
 * drives live in their own storage, which the page write path does not reach,
 * so this is what lets it refuse rather than quietly publish.
 */
export function getHyperVisibility (url) {
  try {
    return (new URL(url).searchParams.get('visibility') || '').trim().toLowerCase()
  } catch {
    return ''
  }
}

export function createHyperUrl (driveAddress, pathname) {
  const encodedPath = pathname
    .split('/')
    // hypercore-fetch decodes paths with decodeURI, which intentionally keeps
    // escaped path-safe delimiters such as commas. Keep those delimiters
    // literal so the URL resolves to the exact Hyperdrive key.
    .map((segment) => encodeURI(segment).replace(/[?#]/g, encodeURIComponent))
    .join('/')
  return `${driveAddress.slice(0, -1)}${encodedPath}`
}

/**
 * The path hypercore-fetch reads for an address made by createHyperUrl.
 *
 * decodeURI leaves %3F and %23 as they are, so a file uploaded through
 * hypercore-fetch as "Why?.txt", by the desktop or a page, is stored as
 * "Why%3F.txt", and the browser and the desktop read it under that name.
 */
export function getHyperFetchPath (pathname) {
  return pathname
    .split('/')
    .map((segment) => decodeURI(encodeURI(segment).replace(/[?#]/g, encodeURIComponent)))
    .join('/')
}

/**
 * A hyper:// address as hypercore-fetch has to be given it.
 *
 * Pages escape a name with encodeURIComponent, so "Safe & Sound.mp3" arrives
 * as "Safe%20%26%20Sound.mp3". decodeURI leaves the %26 as it is, and the
 * file looked up was "Safe %26 Sound.mp3", which is not there. Anything that
 * is not a hyper:// address with a drive is passed on unchanged.
 */
export function toHyperFetchUrl (url) {
  const target = parseHyperUrl(url)
  if (target.error || target.driveAddress === 'default') return url
  return createHyperUrl(target.driveAddress, target.pathname) + getHyperSearch(url)
}

function getRawHyperPath (url) {
  const withoutProtocol = url.slice('hyper://'.length)
  const slashIndex = withoutProtocol.indexOf('/')
  if (slashIndex === -1) return '/'

  const rawPath = withoutProtocol.slice(slashIndex)
  const queryIndex = rawPath.search(/[?#]/)
  return queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex)
}

function isValidHyperHost (value) {
  if (typeof value !== 'string' || !value) return false
  if (!/^[A-Za-z0-9.-]+$/.test(value)) return false
  if (value.includes('..')) return false
  if (value.startsWith('.') || value.endsWith('.')) return false
  return true
}

function normalizeHyperPath (rawPathname) {
  let decodedPathname

  try {
    decodedPathname = decodeURIComponent(rawPathname)
  } catch {
    return { error: 'Invalid URL path encoding' }
  }

  if (decodedPathname.includes('\\')) {
    return { error: 'Invalid path separator' }
  }

  const endsWithSlash = decodedPathname.endsWith('/')
  const segments = decodedPathname.split('/')
  const normalizedSegments = []

  for (const segment of segments) {
    if (!segment || segment === '.') continue

    if (segment === '..') {
      return { error: 'Path traversal is not allowed' }
    }

    normalizedSegments.push(segment)
  }

  let pathname = '/' + normalizedSegments.join('/')

  if (pathname !== '/' && endsWithSlash) {
    pathname += '/'
  }

  return { pathname }
}
