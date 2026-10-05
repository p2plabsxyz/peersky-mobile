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
  // One reply channel for every request, keyed by the id that went out. A
  // scan answers with text; keeping a folder and checking folders answer with
  // an object, which this used to turn into null, so "Keep On This Device"
  // always said it could not.
  window.__peerskyResolveScan = function (id, value) {
    var resolve = pending[id];
    if (!resolve) return;
    delete pending[id];
    if (value && typeof value === 'object') return resolve(value);
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
  // Which of these hyper folders PeerSky still keeps on the device. A folder
  // removed in Settings, P2P Data is no longer among them, and its songs go.
  window.peerskyKeptFolders = function (urls) {
    return new Promise(function (resolve) {
      if (!window.ReactNativeWebView) return resolve(null);
      var id = 'kept-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      pending[id] = resolve;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'peertunes-kept-folders',
        requestId: id,
        urls: Array.isArray(urls) ? urls.map(String) : []
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

const MAX_KEPT_FOLDER_URLS = 500

// The folders a page asks about, or null when the message is not that request.
export function parsePeerTunesKeptFoldersRequest (raw) {
  try {
    const parsed = JSON.parse(String(raw || ''))
    if (parsed?.type !== 'peertunes-kept-folders') return null
    const requestId = parsed.requestId
    if (!/^kept-[\w-]{1,64}$/.test(String(requestId))) return null
    if (!Array.isArray(parsed.urls)) return null
    const urls = parsed.urls
      .filter((url) => typeof url === 'string' && /^hyper:\/\//i.test(url) && url.length <= 2048)
      .slice(0, MAX_KEPT_FOLDER_URLS)
    return { requestId, urls }
  } catch {
    return null
  }
}

/**
 * Which of a page's folder addresses an offline folder still covers. The
 * offline list keeps a drive key and a folder path; a page's address is the
 * one it asked to keep, so the two meet in the same key form. A folder kept
 * under another spelling of its key is simply not reported, which keeps its
 * songs rather than dropping them.
 * @param {string[]} urls
 * @param {{ driveKey?: string, path?: string }[]} items
 */
export function keptFolderUrls (urls, items) {
  const folders = (Array.isArray(items) ? items : [])
    .filter((item) => typeof item?.driveKey === 'string' && typeof item?.path === 'string')
    .map((item) => `hyper://${item.driveKey.toLowerCase()}${item.path.endsWith('/') ? item.path : `${item.path}/`}`)
  return urls.filter((url) => {
    const match = /^hyper:\/\/([^/?#]+)(\/[^?#]*)?/i.exec(url)
    if (!match) return false
    const path = match[2] || '/'
    const folder = `hyper://${match[1].toLowerCase()}${path.endsWith('/') ? path : `${path}/`}`
    return folders.some((kept) => folder.startsWith(kept))
  })
}

/**
 * Tells the page whether sound is going to a Bluetooth device, for its
 * Bluetooth mark. A WebView cannot see the audio outputs itself.
 */
export function createAudioRouteScript (external) {
  return `window.peerskyAudioRoute = { external: ${external === true} }; window.dispatchEvent(new Event('peersky-audio-route')); true;`
}

// Headset and car buttons, on Android. A WebView never hands its audio to the
// system, so play and pause from earbuds had nowhere to go. This keeps the
// page's own Media Session handlers where the app can call them, and says what
// is playing so the app's media session can tell the system.
// Big enough for the medium widget's cover at three times, small enough to
// hand across as text.
const COVER_THUMB_SIZE = 256

export const PEERTUNES_MEDIA_BRIDGE_SCRIPT = `(function () {
  if (window.__peerskyMediaCommand) return;
  var handlers = {};
  var session = navigator.mediaSession;
  if (!session) {
    var metadata = null;
    session = {
      playbackState: 'none',
      setActionHandler: function () {},
      setPositionState: function () {}
    };
    Object.defineProperty(session, 'metadata', {
      configurable: true,
      get: function () { return metadata; },
      set: function (value) { metadata = value; }
    });
    try { Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: session }); } catch (e) {}
    if (typeof window.MediaMetadata === 'undefined') {
      window.MediaMetadata = function (init) {
        init = init || {};
        this.title = init.title || '';
        this.artist = init.artist || '';
        this.album = init.album || '';
        this.artwork = init.artwork || [];
      };
    }
  }

  var last = '';
  // The cover, drawn small for the home screen widget, which cannot load the
  // page's own address for it. Made once for each cover.
  var coverSrc = '';
  var coverThumb = '';
  function coverFor (metadata) {
    var artwork = metadata && metadata.artwork;
    var src = artwork && artwork.length ? String(artwork[artwork.length - 1].src || '') : '';
    if (src === coverSrc) return coverThumb;
    coverSrc = src;
    coverThumb = '';
    if (!src) return '';
    var image = new Image();
    image.onload = function () {
      if (coverSrc !== src) return;
      try {
        var side = Math.min(image.naturalWidth, image.naturalHeight);
        if (!side) return;
        var canvas = document.createElement('canvas');
        canvas.width = ${COVER_THUMB_SIZE};
        canvas.height = ${COVER_THUMB_SIZE};
        canvas.getContext('2d').drawImage(
          image,
          (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side,
          0, 0, ${COVER_THUMB_SIZE}, ${COVER_THUMB_SIZE}
        );
        coverThumb = canvas.toDataURL('image/jpeg', 0.8);
      } catch (e) {
        coverThumb = '';
      }
      report();
    };
    image.src = src;
    return '';
  }
  function isPlaying () {
    var media = document.querySelectorAll('audio, video');
    for (var i = 0; i < media.length; i++) {
      if (!media[i].paused && !media[i].ended) return true;
    }
    return false;
  }
  function report () {
    if (!window.ReactNativeWebView) return;
    var metadata = session.metadata || {};
    var state = JSON.stringify({
      type: 'peertunes-now-playing',
      playing: isPlaying(),
      title: String(metadata.title || ''),
      artist: String(metadata.artist || ''),
      album: String(metadata.album || ''),
      artwork: coverFor(metadata)
    });
    if (state === last) return;
    last = state;
    window.ReactNativeWebView.postMessage(state);
  }
  function soon () { setTimeout(report, 0); }

  var setActionHandler = session.setActionHandler;
  session.setActionHandler = function (name, handler) {
    handlers[name] = handler;
    try { return setActionHandler.call(session, name, handler); } catch (e) {}
  };
  try {
    var own = Object.getOwnPropertyDescriptor(session, 'metadata');
    var inherited = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(session), 'metadata');
    var accessor = own || inherited;
    if (accessor && accessor.set) {
      Object.defineProperty(session, 'metadata', {
        configurable: true,
        get: function () { return accessor.get.call(session); },
        set: function (value) { accessor.set.call(session, value); soon(); }
      });
    }
  } catch (e) {}
  ['play', 'playing', 'pause', 'ended', 'emptied'].forEach(function (name) {
    document.addEventListener(name, soon, true);
  });

  // Says what is playing even when nothing changed: the widget shows a button
  // press before the page acts on it, and this puts it right either way.
  window.__peerskyMediaReport = function () {
    last = '';
    report();
  };

  // The page's own handler when it set one, so next and previous move through
  // its queue. Otherwise the media on the page.
  window.__peerskyMediaCommand = function (name) {
    var handler = handlers[name];
    if (typeof handler === 'function') {
      try { handler({ action: name }); } catch (e) {}
      return;
    }
    var media = document.querySelectorAll('audio, video');
    for (var i = 0; i < media.length; i++) {
      if (name === 'pause' && !media[i].paused) media[i].pause();
      if (name === 'play' && media[i].paused && media[i].currentSrc) {
        media[i].play().catch(function () {});
        return;
      }
    }
  };
})(); true;`

export const PEERTUNES_MEDIA_REPORT_SCRIPT = 'window.__peerskyMediaReport && window.__peerskyMediaReport(); true;'

const MEDIA_COMMANDS = new Set(['play', 'pause', 'nexttrack', 'previoustrack'])
const MAX_NOW_PLAYING_TEXT = 200
// The cover thumbnail is a few tens of kilobytes. Far past that it is not one.
const MAX_NOW_PLAYING_ARTWORK = 300 * 1024

// What the page says is playing, or null when the message is something else.
export function parsePeerTunesNowPlaying (raw) {
  try {
    const parsed = JSON.parse(String(raw || ''))
    if (parsed?.type !== 'peertunes-now-playing') return null
    return {
      playing: parsed.playing === true,
      title: cleanNowPlayingText(parsed.title),
      artist: cleanNowPlayingText(parsed.artist),
      album: cleanNowPlayingText(parsed.album),
      // Checked again where it is written: readArtworkBase64.
      artwork: typeof parsed.artwork === 'string' && parsed.artwork.length <= MAX_NOW_PLAYING_ARTWORK
        ? parsed.artwork
        : ''
    }
  } catch {
    return null
  }
}

function cleanNowPlayingText (value) {
  return Array.from(typeof value === 'string' ? value : '')
    .filter((character) => character.codePointAt(0) >= 32)
    .slice(0, MAX_NOW_PLAYING_TEXT)
    .join('')
}

// A button press from the system, handed to the page. Null for anything that
// is not one of the four.
export function createPeerTunesMediaCommandScript (command) {
  if (!MEDIA_COMMANDS.has(command)) return null
  return `window.__peerskyMediaCommand && window.__peerskyMediaCommand(${JSON.stringify(command)}); true;`
}
