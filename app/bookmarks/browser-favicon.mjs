import { isWebUrl, MAX_BROWSER_URL_LENGTH } from '../browser-shell.mjs'

export const BROWSER_FAVICON_MESSAGE_TYPE = 'peersky-browser-favicon'
export const MAX_BROWSER_FAVICON_DATA_LENGTH = 512 * 1024

export function normalizeBrowserFavicon (favicon, pageUrl) {
  const value = String(favicon || '').trim()
  if (!value) return null

  if (value.length <= MAX_BROWSER_FAVICON_DATA_LENGTH && isSupportedImageDataUrl(value)) {
    return value
  }

  try {
    const parsed = new URL(value, pageUrl)
    if (
      !isWebUrl(parsed.href) ||
      parsed.username ||
      parsed.password ||
      parsed.href.length > MAX_BROWSER_URL_LENGTH
    ) {
      return null
    }

    return parsed.href
  } catch {
    return null
  }
}

export function parseBrowserFaviconMessage (message, pageUrl) {
  try {
    const value = JSON.parse(String(message || ''))
    if (value?.type !== BROWSER_FAVICON_MESSAGE_TYPE) return undefined
    return normalizeBrowserFavicon(value.favicon, pageUrl)
  } catch {
    return undefined
  }
}

export function createBrowserFaviconScript () {
  return `(() => {
    try {
      const icon = document.querySelector(
        'link[rel~="icon" i], link[rel="apple-touch-icon" i]'
      )
      let favicon = icon && icon.href ? icon.href : ''

      if (!favicon && /^https?:$/i.test(location.protocol)) {
        favicon = new URL('/favicon.ico', location.href).href
      }

      if (favicon.length <= ${MAX_BROWSER_FAVICON_DATA_LENGTH}) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: '${BROWSER_FAVICON_MESSAGE_TYPE}',
          favicon
        }))
      }
    } catch {}

    true
  })()`
}

export function combineBrowserInjectedScripts (...scripts) {
  return `${scripts.join(';\n')};\ntrue`
}

function isSupportedImageDataUrl (value) {
  return /^data:image\/(?:gif|jpeg|png|webp|x-icon|vnd[.]microsoft[.]icon);base64,[a-z0-9+/]+={0,2}$/i.test(value)
}
