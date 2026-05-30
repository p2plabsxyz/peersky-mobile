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

  const normalizedPath = normalizeHyperPath(parsed.pathname || '/')
  if (normalizedPath.error) return normalizedPath

  return {
    driveAddress: parsed.hostname ? `hyper://${parsed.hostname}/` : 'default',
    pathname: normalizedPath.pathname
  }
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
