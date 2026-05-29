export function parseHyperUrl (url) {
  if (!url || typeof url !== 'string') {
    return { error: 'Missing required "url"' }
  }

  const parsed = new URL(url)

  if (parsed.protocol !== 'hyper:') {
    return { error: 'Only hyper:// URLs are supported' }
  }

  return {
    driveAddress: parsed.hostname ? `hyper://${parsed.hostname}/` : 'default',
    pathname: decodeURIComponent(parsed.pathname || '/')
  }
}
