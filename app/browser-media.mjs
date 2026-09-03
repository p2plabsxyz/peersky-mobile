import { MAX_BROWSER_URL_LENGTH } from './browser-shell.mjs'

export const BROWSER_MEDIA_MESSAGE_TYPE = 'peersky-browser-media-long-press'
export const BROWSER_MEDIA_DIAGNOSTIC_MESSAGE_TYPE = 'peersky-browser-media-diagnostic'
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

export function parseBrowserMediaDiagnosticMessage (message, expectedToken = '') {
  if (typeof message !== 'string' || message.length > MAX_BROWSER_MEDIA_MESSAGE_LENGTH) return null

  try {
    const parsed = JSON.parse(message)
    if (
      parsed?.type !== BROWSER_MEDIA_DIAGNOSTIC_MESSAGE_TYPE ||
      !isBrowserMediaToken(expectedToken) ||
      parsed.token !== expectedToken ||
      typeof parsed.stage !== 'string' ||
      !/^[a-z0-9-]{1,80}$/.test(parsed.stage)
    ) return null

    const details = parsed.details && typeof parsed.details === 'object' && !Array.isArray(parsed.details)
      ? Object.fromEntries(Object.entries(parsed.details).slice(0, 16).map(([key, value]) => [
        Array.from(key).slice(0, 40).join(''),
        normalizeDiagnosticScalar(value)
      ]))
      : {}

    return { stage: parsed.stage, details }
  } catch {
    return null
  }
}

export function createBrowserMediaLongPressScript ({ token = '' } = {}) {
  return `
    (() => {
      if (window.__peerskyMediaLongPressInstalled) return true;
      window.__peerskyMediaLongPressInstalled = true;

      const messageType = ${JSON.stringify(BROWSER_MEDIA_MESSAGE_TYPE)};
      const diagnosticType = ${JSON.stringify(BROWSER_MEDIA_DIAGNOSTIC_MESSAGE_TYPE)};
      const messageToken = ${JSON.stringify(isBrowserMediaToken(token) ? token : '')};
      const maxUrlLength = ${MAX_BROWSER_URL_LENGTH};
      const maxTextLength = ${MAX_BROWSER_MEDIA_TEXT_LENGTH};

      function postDiagnostic(stage, details) {
        if (!messageToken) return;
        window.ReactNativeWebView?.postMessage(JSON.stringify({
          type: diagnosticType,
          token: messageToken,
          stage,
          details
        }));
      }

      function closestElement(candidates, selector) {
        for (const candidate of candidates) {
          if (candidate && candidate.nodeType === 1) {
            if (candidate.matches && candidate.matches(selector)) return candidate;
            if (candidate.closest) {
              const match = candidate.closest(selector);
              if (match) return match;
            }
          }
        }
        return null;
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

      function dispatchTarget(candidates) {
        const video = closestElement(candidates, 'video');
        const image = video ? null : closestElement(candidates, 'img');
        const link = closestElement(candidates, 'a[href]');

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
        } else if (image) {
          mediaUrl = bridgeSafeUrl(image.currentSrc || image.src, ['http:', 'https:']);
          if (mediaUrl) {
            kind = 'image';
            title = targetTitle(image, link && link.textContent);
          }
        } else if (link) {
          if (linkUrl) {
            kind = 'link';
            title = targetTitle(link);
          }
        }

        if (!kind) {
          postDiagnostic('dom-target-missed', {
            candidateCount: candidates.length,
            hasImage: Boolean(image),
            hasLink: Boolean(link),
            hasVideo: Boolean(video)
          });
          return false;
        }

        window.ReactNativeWebView?.postMessage(JSON.stringify({
          type: messageType,
          token: messageToken,
          kind,
          mediaUrl,
          linkUrl,
          title
        }));
        postDiagnostic('dom-target-dispatched', { kind });
        return true;
      }

      Object.defineProperty(window, '__peerskyResolveMediaLongPressAt', {
        configurable: false,
        enumerable: false,
        writable: false,
        value(providedToken, xRatio, yRatio) {
          if (
            providedToken !== messageToken ||
            !Number.isFinite(xRatio) ||
            !Number.isFinite(yRatio) ||
            xRatio < 0 || xRatio > 1 ||
            yRatio < 0 || yRatio > 1
          ) {
            postDiagnostic('dom-resolver-rejected', {
              tokenMatched: providedToken === messageToken,
              validCoordinates: Number.isFinite(xRatio) && Number.isFinite(yRatio)
            });
            return false;
          }

          const x = xRatio * window.innerWidth;
          const y = yRatio * window.innerHeight;
          const candidates = typeof document.elementsFromPoint === 'function'
            ? document.elementsFromPoint(x, y)
            : [document.elementFromPoint(x, y)].filter(Boolean);
          const handled = dispatchTarget(candidates);
          postDiagnostic('dom-resolver-finished', { candidateCount: candidates.length, handled });
          return handled;
        }
      });

      postDiagnostic('script-installed', {
        hasElementsFromPoint: typeof document.elementsFromPoint === 'function'
      });

      document.addEventListener('contextmenu', (event) => {
        if (!event.isTrusted || !messageToken) return;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
        const handled = dispatchTarget(path);
        postDiagnostic('context-menu', { candidateCount: path.length, handled });
        if (handled) event.preventDefault();
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

function normalizeDiagnosticScalar (value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'string') return Array.from(value).slice(0, 128).join('')
  return String(value).slice(0, 128)
}

function hasControlCharacters (value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint < 32 || (codePoint >= 127 && codePoint <= 159)
  })
}
