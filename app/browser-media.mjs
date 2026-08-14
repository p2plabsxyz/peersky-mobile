import { MAX_BROWSER_URL_LENGTH } from './browser-shell.mjs'

export const BROWSER_MEDIA_MESSAGE_TYPE = 'peersky-browser-media-long-press'
export const MAX_BROWSER_MEDIA_MESSAGE_LENGTH = 24 * 1024
export const MAX_BROWSER_MEDIA_TEXT_LENGTH = 256
export const BROWSER_MEDIA_TOKEN_LENGTH = 32

const MEDIA_KINDS = new Set(['image', 'video', 'link'])
const MEDIA_PROTOCOLS = new Set(['http:', 'https:'])
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'hyper:', 'peersky:'])

export function createBrowserMediaToken (bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== BROWSER_MEDIA_TOKEN_LENGTH / 2) {
    throw new TypeError('Browser media token requires 16 random bytes')
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function parseBrowserMediaMessage (message, pageUrl = '', expectedToken = '') {
  if (typeof message !== 'string' || message.length > MAX_BROWSER_MEDIA_MESSAGE_LENGTH) {
    return null
  }

  try {
    const parsed = JSON.parse(message)
    if (
      parsed?.type !== BROWSER_MEDIA_MESSAGE_TYPE ||
      !isBrowserMediaToken(expectedToken) ||
      parsed.token !== expectedToken ||
      !MEDIA_KINDS.has(parsed.kind)
    ) {
      return null
    }

    const mediaUrl = normalizeTargetUrl(parsed.mediaUrl, pageUrl, MEDIA_PROTOCOLS)
    const linkUrl = normalizeTargetUrl(parsed.linkUrl, pageUrl, LINK_PROTOCOLS)
    const kind = parsed.kind

    if (kind === 'link' && !linkUrl) return null
    if (kind !== 'link' && !mediaUrl) return null

    return {
      kind,
      mediaUrl,
      linkUrl,
      title: normalizeTargetText(parsed.title)
    }
  } catch {
    return null
  }
}

export function createBrowserMediaLongPressScript ({ nativeHitTesting = false, token = '' } = {}) {
  return `
    (() => {
      if (window.__peerskyMediaLongPressInstalled) return true;
      window.__peerskyMediaLongPressInstalled = true;

      const nativeHitTesting = ${nativeHitTesting ? 'true' : 'false'};
      const messageType = ${JSON.stringify(BROWSER_MEDIA_MESSAGE_TYPE)};
      const messageToken = ${JSON.stringify(isBrowserMediaToken(token) ? token : '')};
      const maxUrlLength = ${MAX_BROWSER_URL_LENGTH};
      const maxTextLength = ${MAX_BROWSER_MEDIA_TEXT_LENGTH};

      function closestElement(event, selector) {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        for (const candidate of path) {
          if (candidate && candidate.nodeType === 1) {
            if (candidate.matches && candidate.matches(selector)) return candidate;
            if (candidate.closest) {
              const match = candidate.closest(selector);
              if (match) return match;
            }
          }
        }

        const target = event.target;
        return target && target.closest ? target.closest(selector) : null;
      }

      function bridgeSafeUrl(value, protocols) {
        if (typeof value !== 'string' || value.length < 1 || value.length > maxUrlLength) return null;
        if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return null;

        try {
          const parsed = new URL(value, document.baseURI);
          if (!protocols.includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
            return null;
          }
          return parsed.href.length <= maxUrlLength ? parsed.href : null;
        } catch {
          return null;
        }
      }

      function targetTitle(element, fallback) {
        const value = element && (element.title || element.alt || element.textContent);
        return Array.from(String(value || fallback || '').replace(/[\\u0000-\\u001f\\u007f-\\u009f]+/g, ' ').trim())
          .slice(0, maxTextLength)
          .join('');
      }

      document.addEventListener('contextmenu', (event) => {
        if (!event.isTrusted || !messageToken) return;

        const video = closestElement(event, 'video');
        const image = video ? null : closestElement(event, 'img');
        const link = closestElement(event, 'a[href]');

        let kind = null;
        let mediaUrl = null;
        let linkUrl = bridgeSafeUrl(link && link.href, ['http:', 'https:', 'hyper:', 'peersky:']);
        let title = '';

        if (video) {
          const source = video.currentSrc || video.src || video.querySelector('source')?.src;
          mediaUrl = bridgeSafeUrl(source, ['http:', 'https:']);
          if (mediaUrl) {
            kind = 'video';
            title = targetTitle(video, link && link.textContent);
          }
        } else if (image && !nativeHitTesting) {
          mediaUrl = bridgeSafeUrl(image.currentSrc || image.src, ['http:', 'https:']);
          if (mediaUrl) {
            kind = 'image';
            title = targetTitle(image, link && link.textContent);
          }
        } else if (link && !nativeHitTesting) {
          if (linkUrl) {
            kind = 'link';
            title = targetTitle(link);
          }
        }

        if (!kind) return;

        event.preventDefault();
        window.ReactNativeWebView?.postMessage(JSON.stringify({
          type: messageType,
          token: messageToken,
          kind,
          mediaUrl,
          linkUrl,
          title
        }));
      }, true);

      true;
    })();
  `
}

function isBrowserMediaToken (value) {
  return typeof value === 'string' &&
    value.length === BROWSER_MEDIA_TOKEN_LENGTH &&
    /^[a-f0-9]+$/.test(value)
}

export function isDownloadableBrowserMediaUrl (url) {
  return normalizeTargetUrl(url, '', MEDIA_PROTOCOLS) !== null
}

function normalizeTargetUrl (value, pageUrl, allowedProtocols) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_BROWSER_URL_LENGTH || hasControlCharacters(trimmed)) {
    return null
  }

  try {
    const parsed = pageUrl ? new URL(trimmed, pageUrl) : new URL(trimmed)
    if (
      !allowedProtocols.has(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.href.length > MAX_BROWSER_URL_LENGTH
    ) return null

    return parsed.href
  } catch {
    return null
  }
}

function normalizeTargetText (value) {
  if (typeof value !== 'string') return ''

  const normalized = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint >= 32 && !(codePoint >= 127 && codePoint <= 159)
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

  return Array.from(normalized)
    .slice(0, MAX_BROWSER_MEDIA_TEXT_LENGTH)
    .join('')
}

function hasControlCharacters (value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint < 32 || (codePoint >= 127 && codePoint <= 159)
  })
}
