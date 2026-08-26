import { MAX_BROWSER_URL_LENGTH } from '../browser-shell.mjs'
import { YOUTUBE_AD_BREAK_PATH } from './youtube-ad-blocking.mjs'

export function createBrowserContentBlockingScript ({
  bridgeToken = '',
  enabled = false,
  youtubeAdBlockingEnabled = false
} = {}) {
  if (!enabled && !youtubeAdBlockingEnabled) return 'true'

  return `
    (() => {
      if (window.__peerskyContentBlockingInstalled) return true;

      const bridge = window.PeerSkyContentBlocker;
      window.__peerskyContentBlockingInstalled = true;

      const maxUrlLength = ${MAX_BROWSER_URL_LENGTH};
      const originalFetch = window.fetch;
      const originalOpen = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
      const originalSend = window.XMLHttpRequest && window.XMLHttpRequest.prototype.send;

      function normalizeUrl(value) {
        if (typeof value !== 'string' || value.length < 1 || value.length > maxUrlLength) return null;
        if (/[\\u0000-\\u001f\\u007f-\\u009f]/.test(value)) return null;

        try {
          const parsed = new URL(value, document.baseURI);
          if (!/^https?:$/i.test(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
            return null;
          }
          return parsed.href.length <= maxUrlLength ? parsed.href : null;
        } catch {
          return null;
        }
      }

      function normalizeMethod(value) {
        const method = String(value || 'GET').toUpperCase();
        return /^[A-Z]{1,16}$/.test(method) ? method : 'GET';
      }

      function shouldBlock(url, method) {
        try {
          const requestUrl = normalizeUrl(url);
          const documentUrl = normalizeUrl(location.href);
          if (!requestUrl || !documentUrl) return false;

          const request = new URL(requestUrl);
          const document = new URL(documentUrl);
          const youtubeHost = (host) => host === 'youtube.com' || host.endsWith('.youtube.com');
          if (
            ${youtubeAdBlockingEnabled} &&
            youtubeHost(document.hostname) &&
            youtubeHost(request.hostname) &&
            request.pathname === ${JSON.stringify(YOUTUBE_AD_BREAK_PATH)}
          ) return true;

          return Boolean(
            ${enabled} &&
            bridge &&
            typeof bridge.shouldBlock === 'function' &&
            bridge.shouldBlock(${JSON.stringify(bridgeToken)}, requestUrl, documentUrl, 'xhr', method)
          );
        } catch {
          return false;
        }
      }

      if (typeof originalFetch === 'function') {
        window.fetch = function peerskyBlockedFetch(input, init) {
          const inputUrl = typeof input === 'string' || input instanceof URL ? String(input) : input && input.url;
          const method = normalizeMethod(init && init.method ? init.method : input && input.method);

          if (shouldBlock(inputUrl, method)) {
            return Promise.reject(new TypeError('Failed to fetch'));
          }

          return originalFetch.apply(this, arguments);
        };
      }

      if (typeof originalOpen === 'function' && typeof originalSend === 'function') {
        window.XMLHttpRequest.prototype.open = function peerskyBlockedXhrOpen(method, url) {
          this.__peerskyRequestUrl = url;
          this.__peerskyRequestMethod = normalizeMethod(method);
          return originalOpen.apply(this, arguments);
        };

        window.XMLHttpRequest.prototype.send = function peerskyBlockedXhrSend() {
          if (shouldBlock(this.__peerskyRequestUrl, this.__peerskyRequestMethod)) {
            setTimeout(() => {
              try {
                this.dispatchEvent(new ProgressEvent('error'));
                this.dispatchEvent(new ProgressEvent('loadend'));
              } catch {}
            }, 0);
            return;
          }

          return originalSend.apply(this, arguments);
        };
      }

      true;
    })();
  `
}
