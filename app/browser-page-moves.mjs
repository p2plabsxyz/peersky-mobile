import { MAX_BROWSER_URL_LENGTH } from './browser-shell.mjs'

// A page can change its own address without becoming a new page: it can
// rewrite it with history.replaceState, put another page in its place with
// location.replace, or step back with history.back(). A WebView only says the
// address changed, and the tab took every change as a new page. YouTube adds
// &ra=m to a video's address once the video is open, so the video went into
// the tab's history twice: Back showed it again, stopped, and only a second
// Back went back to the list. The page knows what it did, so it says so here.

export const BROWSER_PAGE_MOVE_MESSAGE_TYPE = 'peersky-browser-page-move'
export const BROWSER_PAGE_MOVE_TOKEN_LENGTH = 32

const MOVE_KINDS = new Set(['document', 'push', 'replace', 'traverse'])
// How a new page was reached: opened, put in another's place, reloaded, or
// reached by Back or Forward.
const DOCUMENT_NAVIGATIONS = new Set(['push', 'replace', 'reload', 'traverse', ''])
const MAX_MESSAGE_LENGTH = MAX_BROWSER_URL_LENGTH * 2 + 1024

/**
 * Runs before the page's own scripts, in the main frame only, and every report
 * carries the tab's token. It tells the app how each new page was reached and
 * what each change within a page was: a new step, a rewrite of this one, or a
 * step back or forward. The Navigation API says so where the WebView has it
 * (Chrome's, and Safari's from iOS 26), with the page a new one took the place
 * of when that page was on the same site. Older WebViews get pushState and
 * replaceState wrapped, and a popstate read as a step back or forward unless
 * the count of pages changed or a link to a part of the page was just
 * followed, as either makes a new step.
 */
export function createBrowserPageMoveScript (token) {
  if (!isPageMoveToken(token)) return ''

  return `(function () {
  var bridge = window.ReactNativeWebView;
  var pageHistory = window.history;
  if (!bridge || typeof bridge.postMessage !== 'function' || !pageHistory || window.__peerskyPageMoves) return;
  try {
    Object.defineProperty(window, '__peerskyPageMoves', { value: true });
  } catch (error) {
    return;
  }
  // Taken before any page script runs, as the hyper bridge does: a page that
  // later replaced JSON.stringify or Object.assign would be handed the token
  // with every report, and a copy with no prototype gives a page's
  // Object.prototype.toJSON nothing to catch.
  var post = bridge.postMessage.bind(bridge);
  var stringify = JSON.stringify;
  var assign = Object.assign;
  var create = Object.create;
  var apply = Reflect.apply;
  var now = Date.now;
  var token = ${JSON.stringify(token)};
  var lastUrl = '' + location.href;
  var lastLength = pageHistory.length;
  function report (kind, from, navigation) {
    lastUrl = '' + location.href;
    lastLength = pageHistory.length;
    try {
      post(stringify(assign(create(null), {
        type: ${JSON.stringify(BROWSER_PAGE_MOVE_MESSAGE_TYPE)},
        token: token,
        kind: kind,
        from: from || '',
        url: lastUrl,
        length: lastLength,
        navigation: navigation || ''
      })));
    } catch (error) {}
  }

  var api = window.navigation;
  var navigation = '';
  var replaced = '';
  try {
    var activation = api && api.activation;
    if (activation && typeof activation.navigationType === 'string') {
      navigation = activation.navigationType;
      if (navigation === 'replace' && activation.from && typeof activation.from.url === 'string') replaced = activation.from.url;
    } else {
      var timing = performance.getEntriesByType('navigation')[0];
      var type = timing && typeof timing.type === 'string'
        ? timing.type
        : performance.navigation ? ['navigate', 'reload', 'back_forward'][performance.navigation.type] : '';
      navigation = type === 'back_forward' ? 'traverse' : type === 'reload' ? 'reload' : type ? 'push' : '';
    }
  } catch (error) {}
  report('document', replaced, navigation);

  if (api && typeof api.addEventListener === 'function') {
    api.addEventListener('currententrychange', function (event) {
      var type = event.navigationType;
      var from = event.from && typeof event.from.url === 'string' ? event.from.url : lastUrl;
      if (type === 'push') report('push', from, '');
      else if (type === 'replace' && '' + location.href !== from) report('replace', from, '');
      else if (type === 'traverse') report('traverse', '', '');
    });
    return;
  }

  // Every pushState adds a page, even to the same address, so each one is
  // told for the count. A replaceState that kept the address changed nothing.
  ['pushState', 'replaceState'].forEach(function (name) {
    var original = pageHistory[name];
    if (typeof original !== 'function') return;
    pageHistory[name] = function () {
      var from = '' + location.href;
      var result = apply(original, this, arguments);
      if (name === 'pushState') report('push', from, '');
      else if ('' + location.href !== from) report('replace', from, '');
      return result;
    };
  });
  var followed = null;
  document.addEventListener('click', function (event) {
    try {
      var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      var href = link && link.href;
      var here = '' + location.href;
      if (typeof href === 'string' && href !== here && href.indexOf('#') > 0 && href.split('#')[0] === here.split('#')[0]) {
        followed = { url: href, at: now() };
      }
    } catch (error) {}
  }, true);
  // In the capture phase, so a page's own listener can't stop it first.
  window.addEventListener('popstate', function () {
    var link = followed !== null && followed.url === '' + location.href && now() - followed.at < 1000;
    followed = null;
    if (link || pageHistory.length !== lastLength) report('push', lastUrl, '');
    else report('traverse', '', '');
  }, true);
  window.addEventListener('hashchange', function () {
    lastUrl = '' + location.href;
    lastLength = pageHistory.length;
  }, true);
})();`
}

/**
 * A report from createBrowserPageMoveScript, or null for anything else: a
 * message without the tab's token, or one that isn't about a web page.
 */
export function parseBrowserPageMoveMessage (message, expectedToken) {
  if (typeof message !== 'string' || message.length > MAX_MESSAGE_LENGTH || !isPageMoveToken(expectedToken)) {
    return null
  }

  let parsed
  try {
    parsed = JSON.parse(message)
  } catch {
    return null
  }

  if (
    parsed?.type !== BROWSER_PAGE_MOVE_MESSAGE_TYPE ||
    parsed.token !== expectedToken ||
    !MOVE_KINDS.has(parsed.kind) ||
    !Number.isSafeInteger(parsed.length) ||
    parsed.length < 1
  ) return null

  const url = normalizeWebUrl(parsed.url)
  if (!url) return null
  let from = parsed.kind === 'traverse' ? null : normalizeWebUrl(parsed.from)
  if ((parsed.kind === 'push' || parsed.kind === 'replace') && !from) return null
  // A page only rewrites, or takes the place of, a page on its own site, so
  // one that claims another site's page took no place of it.
  if (from && parsed.kind !== 'push' && new URL(from).origin !== new URL(url).origin) {
    if (parsed.kind === 'replace') return null
    from = null
  }
  const navigation = typeof parsed.navigation === 'string' && DOCUMENT_NAVIGATIONS.has(parsed.navigation)
    ? parsed.navigation
    : ''

  return { kind: parsed.kind, url, from, length: parsed.length, navigation }
}

/**
 * What a report means for the tab: a 'replace' of the page at `from` (the
 * page rewrote its address, or another page took its place), a 'traverse'
 * (the page went back or forward on its own), or null (a new page, as the tab
 * takes it anyway). A new page that took another's place says which only when
 * that page was on its own site; one that can't say is a new page, as before.
 *
 * @param {{ kind: string, from: string | null, navigation: string }} report
 * @returns {{ move: 'replace' | 'traverse', from: string | null } | null}
 */
export function classifyBrowserPageMove (report) {
  if (report.kind === 'replace' && report.from) return { move: 'replace', from: report.from }
  if (report.kind === 'traverse') return { move: 'traverse', from: null }
  if (report.kind === 'document') {
    if (report.navigation === 'traverse') return { move: 'traverse', from: null }
    if (report.navigation === 'replace' && report.from) return { move: 'replace', from: report.from }
  }
  return null
}

function normalizeWebUrl (value) {
  if (typeof value !== 'string' || !value || value.length > MAX_BROWSER_URL_LENGTH) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.href.length <= MAX_BROWSER_URL_LENGTH ? parsed.href : null
  } catch {
    return null
  }
}

function isPageMoveToken (value) {
  return typeof value === 'string' &&
    value.length === BROWSER_PAGE_MOVE_TOKEN_LENGTH &&
    /^[a-f0-9]+$/.test(value)
}
