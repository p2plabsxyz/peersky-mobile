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
