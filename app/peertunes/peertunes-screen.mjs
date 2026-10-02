// The app page lives on the loopback PeerTunes server. A share link's
// query or fragment rides along so the page can pick up the playlist.
export function createPeerTunesPageUrl (localUrl, launchSuffix = '') {
  const base = String(localUrl || '').replace(/\/+$/, '')
  if (!base) return ''
  return `${base}/${launchSuffix || ''}`
}

// Only the app's own origin may navigate inside the WebView. Anything else,
// such as the GitHub link in the About screen, goes back to the browser.
export function isPeerTunesPageRequest (requestUrl, localUrl) {
  const value = String(requestUrl || '')
  if (value === 'about:blank') return true

  const base = String(localUrl || '').replace(/\/+$/, '')
  if (!base) return false

  // Compare parsed origins rather than string prefixes. A prefix test rejects
  // same-origin URLs that carry only a query or a fragment, which ejected the
  // user out of the app, and it is fussy about scheme case.
  try {
    const target = new URL(value)
    const expected = new URL(base)
    return target.protocol === expected.protocol &&
      target.hostname === expected.hostname &&
      target.port === expected.port
  } catch {
    return false
  }
}

// PeerTunes asks native to scan, because WKWebView has no BarcodeDetector and
// the native scanner is the one the rest of the app already uses. The page sees
// a promise; native runs the camera and resolves it.
export const PEERTUNES_SCAN_BRIDGE_SCRIPT = `(function () {
  var pending = {};
  // One reply channel for both, keyed by the id that went out.
  window.__peerskyResolveScan = function (id, value) {
    var resolve = pending[id];
    if (!resolve) return;
    delete pending[id];
    resolve(typeof value === 'string' && value ? value : null);
  };
  // A page inside a WebView cannot reach the taptic engine, so it asks. One
  // message per press, with the weight it wants; native does the rest.
  window.peerskyHaptic = function (weight) {
    if (!window.ReactNativeWebView) return false;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'peertunes-haptic',
      weight: weight === 'medium' || weight === 'heavy' ? weight : 'light'
    }));
    return true;
  };
  // Keeping a shared folder on the device. PeerSky already downloads a hyper
  // folder when you ask it to; this is the page asking on the user's behalf,
  // so an imported playlist plays with the network off.
  window.peerskyKeepOffline = function (url) {
    return new Promise(function (resolve) {
      if (!window.ReactNativeWebView) return resolve(null);
      var id = 'keep-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      pending[id] = resolve;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'peertunes-keep-offline',
        requestId: id,
        url: String(url || '')
      }));
    });
  };
  window.peerskyScanQr = function () {
    return new Promise(function (resolve) {
      if (!window.ReactNativeWebView) return resolve(null);
      var id = 'scan-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      pending[id] = resolve;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'peertunes-scan-qr',
        requestId: id
      }));
    });
  };
})(); true;`

export function parsePeerTunesScanRequest (raw) {
  try {
    const parsed = JSON.parse(String(raw || ''))
    if (parsed?.type !== 'peertunes-scan-qr') return null
    const requestId = parsed.requestId
    return typeof requestId === 'string' && /^scan-[\w-]{1,64}$/.test(requestId)
      ? requestId
      : null
  } catch {
    return null
  }
}

// Scanned text is whatever was on the QR code, so it goes back into the page as
// a JSON literal. The two line separators are valid JSON but break a JavaScript
// string, so escape them too.
export function serializeScanResult (value) {
  return JSON.stringify(value ?? null)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

// The weight a page asked for, or null when the message is not a haptic
// request. Anything unrecognised reads as the lightest one rather than being
// refused: a buzz is not worth an error path.
export function parsePeerTunesHapticRequest (raw) {
  try {
    const parsed = JSON.parse(String(raw || ''))
    if (parsed?.type !== 'peertunes-haptic') return null
    return parsed.weight === 'medium' || parsed.weight === 'heavy' ? parsed.weight : 'light'
  } catch {
    return null
  }
}

// The url a page wants kept on the device, or null when the message is not a
// keep-offline request.
export function parsePeerTunesKeepOfflineRequest (raw) {
  try {
    const parsed = JSON.parse(String(raw || ''))
    if (parsed?.type !== 'peertunes-keep-offline') return null
    const requestId = parsed.requestId
    const url = typeof parsed.url === 'string' ? parsed.url.trim() : ''
    if (!/^keep-[\w-]{1,64}$/.test(String(requestId))) return null
    // Only a hyper folder. Anything else is not something this can download.
    if (!/^hyper:\/\//i.test(url) || url.length > 2048) return null
    return { requestId, url }
  } catch {
    return null
  }
}

/**
 * Tells the page whether sound is going to a Bluetooth device, for its
 * Bluetooth mark. A WebView cannot see the audio outputs itself.
 */
export function createAudioRouteScript (external) {
  return `window.peerskyAudioRoute = { external: ${external === true} }; window.dispatchEvent(new Event('peersky-audio-route')); true;`
}
