import { getIntentFallbackUrl, parseAppLink, parseExternalAppLink } from './browser-permissions.mjs'

export const BROWSER_HOME_URL = 'peersky://home'
// The index of the built-in apps. It used to resolve to nothing and come back
// as an unsupported scheme, which is a poor answer for an address the app
// itself hands out.
export const BROWSER_P2P_URL = 'peersky://p2p'

export function isBrowserP2pUrl (value) {
  return /^peersky:\/\/p2p\/?$/i.test(String(value || '').trim())
}
export const MAX_BROWSER_HISTORY_ENTRIES = 20
export const MAX_BROWSER_URL_LENGTH = 8192
export const DEFAULT_SEARCH_ENGINE = 'duckduckgo'
export const CUSTOM_SEARCH_QUERY_PLACEHOLDER = '%s'
export const MAX_CUSTOM_SEARCH_URL_LENGTH = 2048

export function normalizeBrowserAddress (
  address,
  searchEngine = DEFAULT_SEARCH_ENGINE,
  customSearchUrl = ''
) {
  const value = String(address || '').trim()
  if (!value || value === BROWSER_HOME_URL) return BROWSER_HOME_URL

  if (parseExternalAppLink(value)) return value

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value

  if (/^(localhost|127[.]0[.]0[.]1|10[.]0[.]2[.]2)(:\d+)?(\/.*)?$/i.test(value)) {
    return `http://${value}`
  }

  if (value.includes(' ') || !value.includes('.')) {
    return getSearchUrl(searchEngine, value, customSearchUrl)
  }

  return `https://${value}`
}

/**
 * A drive address that lists what is in it instead of resolving to a page.
 *
 * hypercore-fetch serves index.html for a directory that has one, which is
 * right for visiting a site and wrong for "show me this drive". P2PMD publishes
 * a note as index.html, so opening its app data opened the note rather than the
 * files behind it.
 */
export function getHyperDriveListingUrl (url) {
  const value = String(url || '')
  if (!isHyperUrl(value) || /[?&]noResolve(?:[=&]|$)/i.test(value)) return value

  const hashIndex = value.indexOf('#')
  const address = hashIndex === -1 ? value : value.slice(0, hashIndex)
  const fragment = hashIndex === -1 ? '' : value.slice(hashIndex)
  return `${address}${address.includes('?') ? '&' : '?'}noResolve${fragment}`
}

// Each one is the engine's own plain search address. noai.duckduckgo.com is
// DuckDuckGo's own host for results without the AI answers on top.
const SEARCH_ENGINE_URLS = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  'duckduckgo-noai': 'https://noai.duckduckgo.com/?q=',
  startpage: 'https://www.startpage.com/sp/search?q=',
  ecosia: 'https://www.ecosia.org/search?q=',
  kagi: 'https://kagi.com/search?q='
}

export function getSearchUrl (searchEngine, query, customSearchUrl = '') {
  const encodedQuery = encodeURIComponent(String(query || ''))
  const normalizedCustomUrl = normalizeCustomSearchUrl(customSearchUrl)

  if (searchEngine === 'custom' && normalizedCustomUrl) {
    return normalizedCustomUrl.replaceAll(CUSTOM_SEARCH_QUERY_PLACEHOLDER, encodedQuery)
  }

  // An engine this build has never heard of falls back rather than failing to
  // search at all, which is what a saved setting from a newer version looks
  // like after a downgrade.
  return `${SEARCH_ENGINE_URLS[searchEngine] || SEARCH_ENGINE_URLS[DEFAULT_SEARCH_ENGINE]}${encodedQuery}`
}

export function normalizeCustomSearchUrl (customSearchUrl) {
  const value = String(customSearchUrl || '').trim()
  if (
    value.length < 1 ||
    value.length > MAX_CUSTOM_SEARCH_URL_LENGTH ||
    !value.includes(CUSTOM_SEARCH_QUERY_PLACEHOLDER)
  ) {
    return null
  }

  try {
    const parsed = new URL(value.replaceAll(CUSTOM_SEARCH_QUERY_PLACEHOLDER, 'query'))
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    return value
  } catch {
    return null
  }
}

/**
 * The https:// address to try first for an http:// page, as Safari and Chrome
 * do. Only for a page on the web, at the usual port: this phone, the local
 * network and a name only it knows stay as they are, as does an address on
 * another port. Null when there is nothing to try.
 */
export function getHttpsUpgradeUrl (url) {
  let parsed
  try {
    parsed = new URL(String(url || ''))
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' || parsed.username || parsed.password) return null
  if (parsed.port && parsed.port !== '80') return null
  if (isLocalNetworkHost(parsed.hostname)) return null
  parsed.protocol = 'https:'
  parsed.port = ''
  return parsed.href
}

function isLocalNetworkHost (hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  if (host.includes(':')) {
    return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) ||
      /^::ffff:(0|10|127|169\.254|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(host)
  }
  // A single name, as a router or a printer has, and names that are only
  // ever on the local network.
  return !host.includes('.') || /\.(localhost|local|lan|home\.arpa|internal)$/.test(host)
}

export function isWebUrl (targetUrl) {
  return /^https?:\/\//i.test(String(targetUrl || ''))
}

export function isHyperUrl (targetUrl) {
  return /^hyper:\/\//i.test(String(targetUrl || ''))
}

// One page, whatever part of it the address points at.
function pageAddress (value) {
  return String(value || '').split('#')[0]
}

function isSameHyperDocument (url, currentUrl) {
  return Boolean(currentUrl) && pageAddress(url) === pageAddress(currentUrl)
}

export function getBrowserWebViewKey (tabId, sourceKind) {
  return `${tabId}:${sourceKind}`
}

export function getBrowserAddressForUrl (url) {
  return url === BROWSER_HOME_URL ? '' : url
}

export function commitBrowserEntryState (state, url, source) {
  const nextHistory = boundBrowserHistory(state.history
    .slice(0, state.historyIndex + 1)
    .map(getRestorableHistoryEntry)
    .concat({ url, source }))
  return buildBrowserState(nextHistory, nextHistory.length - 1, {
    resetWebNavigation: true
  })
}

export function boundBrowserHistory (history) {
  if (!Array.isArray(history) || history.length <= MAX_BROWSER_HISTORY_ENTRIES) return history

  const recentEntries = history.slice(-(MAX_BROWSER_HISTORY_ENTRIES - 1))
  const homeEntry = history.find((entry) =>
    entry?.url === BROWSER_HOME_URL && entry?.source?.kind === 'home'
  )
  if (!homeEntry || recentEntries.includes(homeEntry)) {
    return history.slice(-MAX_BROWSER_HISTORY_ENTRIES)
  }
  return [homeEntry, ...recentEntries]
}

export function replaceBrowserEntryState (state, url, source) {
  const nextHistory = state.history.slice()
  nextHistory[state.historyIndex] = { url, source }
  return buildBrowserState(nextHistory, state.historyIndex)
}

export function syncBrowserEntryState (state, url, source) {
  return replaceBrowserEntryState(state, url, source)
}

/**
 * How Back or Forward goes from the step on screen. A web page steps in its
 * own WebView, which keeps the page it goes to as it was left: where it was
 * scrolled, what was typed in it, its own history and a form's result, as
 * Safari and Chrome do. That WebView holds only the pages it showed itself,
 * which the tab knows by the WebView each step was recorded from (a web
 * source's view): not the pages before the tab last showed something else,
 * a hyper:// site, an app, Home or an error, nor any from before the WebView
 * was built again, as after a restart. Any other step builds its page again
 * from the tab's history.
 *
 * The WebView's own word counts too, for a step it has and the tab does not,
 * such as a menu a page opened under its own address, which Back closes. Its
 * no counts only where it can be believed (believeNo), as on Android:
 * WKWebView has said it cannot go forward with a page ahead of it.
 *
 * @param {'back' | 'forward'} direction
 * @param {{ view: number | null, canGoBack: boolean, canGoForward: boolean } | null} webView
 *   the tab's WebView on screen, and what it last said it can go to, or null
 *   when it has said nothing yet
 * @param {boolean} [believeNo]
 * @returns {{ mode: 'webview' } | { mode: 'rebuild', state: NonNullable<ReturnType<typeof getBrowserBackState>> } | null}
 */
export function getBrowserTraversal (state, direction, webView, believeNo = false) {
  const step = direction === 'back' ? -1 : 1
  const entry = state.history[state.historyIndex]
  const next = state.history[state.historyIndex + step]
  const view = webView?.view
  if (typeof view === 'number' && entry?.source?.kind === 'web' && entry.source.view === view) {
    const kept = next?.source?.kind === 'web' && next.source.view === view
    const said = direction === 'back' ? webView.canGoBack : webView.canGoForward
    if (said === true || (kept && !(believeNo && said === false))) return { mode: 'webview' }
  }

  const nextState = direction === 'back' ? getBrowserBackState(state) : getBrowserForwardState(state)
  return nextState ? { mode: 'rebuild', state: nextState } : null
}

/**
 * @param {'back' | 'forward' | null} [direction] Back or Forward the tab asked
 *   its WebView for, which the page reported here is where it went
 * @param {{ move: 'replace' | 'traverse', from: string | null } | null} [pageMove]
 *   what the page said it did to its address (browser-page-moves.mjs): put
 *   this address in the place of the one at `from`, or went back or forward
 *   on its own. A new page is null.
 */
export function recordBrowserWebNavigationState (
  state,
  url,
  source,
  direction = null,
  hasNativeBackEntry = true,
  isLoading = false,
  pageMove = null
) {
  const currentEntry = state.history[state.historyIndex]
  if (currentEntry?.url === url) {
    return replaceBrowserEntryState(state, url, source)
  }

  // Nothing is decided until the navigation lands. A page that is still
  // loading is not on the WebView's back list yet, so hasNativeBackEntry still
  // describes the page being left, and reading it here made every link look
  // like a redirect: following a search result replaced the search instead of
  // stacking on it, and Back went to whatever was before the search.
  if (isLoading) {
    return buildBrowserState(state.history, state.historyIndex)
  }

  if (direction === 'back' || direction === 'forward') {
    return traverseBrowserHistoryState(state, url, source, direction)
  }

  // The page rewrote its address, or put another page in its place: still
  // one step, as in any browser. Only when the page it replaced is the one the
  // tab is on: a page that moves on while it is still loading was never a
  // step, and the one before it stays.
  if (pageMove?.move === 'replace' && isSameBrowserUrl(pageMove.from, currentEntry?.url)) {
    return replaceBrowserEntryState(state, url, source)
  }
  // The page went back or forward by itself, to the step next to this one.
  // Anywhere else it is a new step, as it was.
  if (pageMove?.move === 'traverse') {
    if (state.history[state.historyIndex - 1]?.url === url) {
      return buildBrowserState(state.history, state.historyIndex - 1)
    }
    if (state.history[state.historyIndex + 1]?.url === url) {
      return buildBrowserState(state.history, state.historyIndex + 1)
    }
  }

  // A WebView with no native back entry has replaced or redirected its first
  // page. Keep that transition out of browser history so Back can reach Home.
  if (!hasNativeBackEntry) {
    return replaceBrowserEntryState(state, url, source)
  }

  return commitBrowserEntryState(state, url, source)
}

/**
 * Where Back or Forward in the WebView went. The page it lands on is the
 * nearest step that way with its address, which skips a step the tab kept and
 * the WebView did not, such as a page that sent the tab on before it had
 * loaded. The WebView only has the pages it showed itself, so nothing past a
 * page that was not on the web, or one another WebView showed, is looked at.
 * A page the WebView kept and the tab did not goes in next to the step it came
 * from, where the WebView has it. The step takes the address exactly as the
 * WebView reports it, so the WebView is never sent to that page again as a
 * new one.
 */
function traverseBrowserHistoryState (state, url, source, direction) {
  const step = direction === 'back' ? -1 : 1
  for (
    let index = state.historyIndex + step;
    index >= 0 && index < state.history.length;
    index += step
  ) {
    const entry = state.history[index]
    if (entry?.source?.kind !== 'web') break
    if (typeof entry.source.view === 'number' && typeof source.view === 'number' && entry.source.view !== source.view) break
    if (isSameBrowserUrl(entry.url, url)) {
      if (entry.url === url && entry.source.uri === source.uri && entry.source.view === source.view) {
        return buildBrowserState(state.history, index)
      }
      const history = state.history.slice()
      history[index] = { url, source }
      return buildBrowserState(history, index)
    }
  }

  const at = direction === 'back' ? state.historyIndex : state.historyIndex + 1
  const history = [
    ...state.history.slice(0, at),
    { url, source },
    ...state.history.slice(at)
  ]
  if (history.length <= MAX_BROWSER_HISTORY_ENTRIES) {
    return buildBrowserState(history, at)
  }
  // Over the bound, the step furthest from the new one goes: the last when
  // it went in going back, the oldest (keeping Home) going forward.
  if (direction === 'back') {
    return buildBrowserState(history.slice(0, MAX_BROWSER_HISTORY_ENTRIES), at)
  }
  const fromEnd = history.length - 1 - at
  const bounded = boundBrowserHistory(history)
  return buildBrowserState(bounded, bounded.length - 1 - fromEnd)
}

/**
 * Where a page that would not load goes in the tab's history. The page on
 * screen stays a step of its own: a link that failed is the next step, under
 * the address that failed, where it took the page's place and its name, so
 * Back went past the page it came from. A failed load of the step itself, as
 * a reload or an address typed, is that step, and Back or Forward that failed
 * is the step it was going to.
 *
 * @param {'back' | 'forward' | null} direction Back or Forward that was on its way
 * @param {string} [shownUrl] the address the step is shown under, when it is
 *   not the one that failed: the http:// page an https:// try was for
 */
export function recordBrowserErrorState (state, failedUrl, source, direction = null, shownUrl = failedUrl) {
  let nextState
  if (direction === 'back' || direction === 'forward') {
    nextState = traverseBrowserHistoryState(state, failedUrl, source, direction)
  } else if (isSameBrowserUrl(state.history[state.historyIndex]?.url, failedUrl)) {
    nextState = replaceBrowserEntryState(state, failedUrl, source)
  } else {
    nextState = commitBrowserEntryState(state, failedUrl, source)
  }
  return shownUrl === failedUrl ? nextState : replaceBrowserEntryState(nextState, shownUrl, source)
}

// The same page, however each side wrote its address.
function isSameBrowserUrl (a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a === b) return true
  try {
    return new URL(a).href === new URL(b).href
  } catch {
    return false
  }
}

/**
 * Android's WebView also reports a navigation that never replaced the page, a
 * 204 or a cancelled download, as a page that finished, with the address it
 * was going to. Taken as the page, the address bar showed that site over the
 * one on screen, which a page could set off on its own. Only a navigation that
 * commits starts a load there, so a finish for an address nothing committed
 * since the last finished page is not the page on screen.
 *
 * @param {{ platform: string, isLoadStart: boolean, committedUrls?: Set<string> | null, url: string }} navigation
 */
export function isUncommittedNavigationFinish ({ platform, isLoadStart, committedUrls, url }) {
  if (platform !== 'android' || isLoadStart || !committedUrls || committedUrls.size === 0) return false
  return !committedUrls.has(url)
}

/**
 * A page's word on a move the tab had already taken as a new page. Android can
 * hand the app the address change before the page's report, so the page just
 * added is folded back: into the one it rewrote, or, when the page went back,
 * onto the step it went back to. Only the page the last web navigation added,
 * and only while it is still the one on screen.
 *
 * @param {{ history: { url: string }[], historyIndex: number }} state
 * @param {{ move: 'replace' | 'traverse', url: string, from?: string | null }} report
 * @param {{ url: string, index: number } | null} added the page the last web
 *   navigation added to this tab
 */
export function settleLateBrowserPageMove (state, report, added) {
  const index = state.historyIndex
  const entry = state.history[index]
  if (!added || added.index !== index || added.url !== report.url || entry?.url !== report.url) return null

  if (report.move === 'replace') {
    const previous = state.history[index - 1]
    if (!previous || !isSameBrowserUrl(report.from, previous.url)) return null
    return buildBrowserState([
      ...state.history.slice(0, index - 1),
      entry,
      ...state.history.slice(index + 1)
    ], index - 1)
  }

  if (report.move === 'traverse') {
    // [..., T, C] then back to T came in as [..., T, C, T]: it is [..., T, C]
    // on T, with C ahead.
    if (state.history[index - 2]?.url !== report.url) return null
    return buildBrowserState(state.history.slice(0, index), index - 2)
  }

  return null
}

export function getBrowserBackState (state) {
  if (state.historyIndex <= 0) return null
  return buildBrowserState(state.history, state.historyIndex - 1)
}

export function getBrowserForwardState (state) {
  if (state.historyIndex >= state.history.length - 1) return null
  return buildBrowserState(state.history, state.historyIndex + 1)
}

// A file goes to Downloads and the WebView loads nothing in its place. A tab
// that went to one from no page at all sat there blank, and one sent to it
// from the address bar named the file over the page it still showed. So the
// file's entry goes and the tab is back where it was. A tab that only ever
// held the file has nowhere to go back to, and closes.
export function getFileHandoffAction ({ history, historyIndex, fileUrl, showedPage }) {
  const entry = history[historyIndex]
  const entryIsFile = entry?.source?.kind === 'web' && pageAddress(entry.url) === pageAddress(fileUrl)
  if (showedPage && !entryIsFile) return { action: 'stay' }
  if (history.length === 1) return { action: 'close-tab' }
  if (historyIndex > 0) {
    return { action: 'back', state: buildBrowserState(history.slice(0, historyIndex), historyIndex - 1) }
  }
  return { action: 'stay' }
}

// tapped: the person's tap started the request. iOS says a link was clicked,
// and Android that a gesture came with it.
export function getBrowserRequestAction ({
  requestUrl,
  currentSourceKind,
  currentUrl = '',
  navigationType = '',
  isTopFrame = true,
  tapped = false
}) {
  const url = String(requestUrl || '')

  if (url.length > MAX_BROWSER_URL_LENGTH) {
    return { action: 'block' }
  }

  if (url === 'about:blank') {
    return { action: 'allow' }
  }

  // A document a page makes for a frame of its own: data:, blob: or srcdoc.
  // Every browser loads these in a frame, and only refuses a whole tab sent to
  // data:. Refused here, Agregore's scratchpad showed no live preview.
  if (!isTopFrame && /^(?:data:|blob:|about:srcdoc$)/i.test(url)) {
    return { action: 'allow' }
  }

  if (isHyperUrl(url)) {
    // A hyper:// frame cannot load in place, and turning it into a navigation
    // let any embed or ad take the whole tab to a page of its choosing.
    if (!isTopFrame) return { action: 'block' }
    // The page itself, loaded from the string the app fetched under its own
    // address. iOS reports that load like any other, and taking it over would
    // load the page again, and again. A link or a reload is still the app's.
    if (
      currentSourceKind === 'hyper' &&
      navigationType === 'other' &&
      isSameHyperDocument(url, currentUrl)
    ) {
      return { action: 'allow' }
    }
    return { action: 'load-hyper', url }
  }

  const externalLink = parseExternalAppLink(url)
  if (externalLink) {
    if (!isTopFrame) return { action: 'block' }

    return {
      action: 'open-external',
      ...externalLink
    }
  }

  // A link to another app's own scheme goes to that app only when the person
  // tapped it, and after asking, never on a page's say alone. It used to go
  // nowhere at all, without a word. An intent:// link with a web page of its
  // own to fall back on opens that page in the tab instead.
  const appLink = parseAppLink(url)
  if (appLink) {
    if (!isTopFrame || !tapped) return { action: 'block' }
    const fallbackUrl = getIntentFallbackUrl(url)
    if (fallbackUrl) return { action: 'load-fallback', url: fallbackUrl }
    return { action: 'open-external', ...appLink }
  }

  if (!isWebUrl(url)) {
    return { action: 'block' }
  }

  if (currentSourceKind !== 'web') {
    // Only a real top-frame navigation should take the tab to the web. An
    // iframe, image or script inside a hyper page is a subresource: loading it
    // in place is correct, and treating it as a navigation used to hijack the
    // tab, so an embed on a hyper site replaced the page you were reading.
    if (!isTopFrame) return { action: 'allow' }

    return {
      action: 'commit-web',
      url,
      source: { kind: 'web', uri: url }
    }
  }

  return { action: 'allow' }
}

const HYPER_KEY_HOST = /^([0-9a-f]{64}|[a-z0-9]{52})$/
// A name the Hyper runtime looks up over DNS, such as agregore.mauve.moe.
const HYPER_DOMAIN_HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/

/**
 * The host of a hyper:// address, lower case: the drive key, or the domain
 * name the site was opened under. How a hyper site is known for things like
 * the publishing permission. Null for anything else.
 */
export function getHyperSiteId (url) {
  try {
    const parsed = new URL(String(url || ''))
    if (parsed.protocol !== 'hyper:') return null
    const host = parsed.hostname.toLowerCase()
    return HYPER_KEY_HOST.test(host) || HYPER_DOMAIN_HOST.test(host) ? host : null
  } catch {
    return null
  }
}

/** The origin of an https:// page, which is how a web site is known. Null for anything else. */
export function getWebSiteId (url) {
  try {
    const parsed = new URL(String(url || ''))
    return parsed.protocol === 'https:' ? parsed.origin : null
  } catch {
    return null
  }
}

/** Whether a saved site is one the bridge could have named. */
export function isBridgeSiteId (value) {
  const id = String(value || '')
  return HYPER_KEY_HOST.test(id) || HYPER_DOMAIN_HOST.test(id) || getWebSiteId(id) === id
}

/**
 * The page a tab's message came from. iOS reports the page's address, or
 * about:blank for one loaded from a string. Android reports only the origin:
 * https://example.com for any page on that site, and hyper:// for every
 * hyper:// page. When that fits the tab's own entry, the entry says more.
 */
export function getBrowserMessagePageUrl (reportedUrl, entryUrl) {
  const reported = String(reportedUrl || '')
  if (!reported || reported.startsWith('about:')) return entryUrl
  try {
    const entry = new URL(entryUrl)
    if (reported === (entry.protocol === 'hyper:' ? 'hyper://' : entry.origin)) return entryUrl
  } catch {}
  return reported
}

/**
 * The site a tab's bridge request speaks for, or null when it may not use the
 * bridge: the page that sent it is somewhere else, such as a site the tab
 * navigated off to, or the tab shows one of the app's own pages. A hyper://
 * page is known by its host and an https:// page by its origin, and both get
 * the same rules.
 */
export function getHyperBridgeSite ({ url, reportedUrl = '', isHyper, isWeb = false }) {
  const reported = String(reportedUrl || '').split('#')[0]
  if (isHyper) {
    const siteId = getHyperSiteId(url)
    if (!siteId) return null
    return getHyperSiteId(getBrowserMessagePageUrl(reported, url)) === siteId ? siteId : null
  }
  // A web page always says where it is, as its address on iOS and its origin
  // on Android, so a message that names nowhere is not taken for the tab's.
  const siteId = isWeb ? getWebSiteId(url) : null
  return siteId && getWebSiteId(reported) === siteId ? siteId : null
}

/** A site as the publishing prompt and Settings name it. */
export function formatBridgeSite (siteId) {
  const id = String(siteId || '')
  if (getWebSiteId(id) === id) return id
  return `hyper://${HYPER_KEY_HOST.test(id) ? `${id.slice(0, 8)}…${id.slice(-4)}` : id}`
}

export function isStaleBrowserLoad (loadSeq, currentSeq) {
  return loadSeq !== currentSeq
}

function getRestorableHistoryEntry (entry) {
  if (entry.source.kind !== 'hyper' && entry.source.kind !== 'error') return entry

  return {
    url: entry.url,
    source: { kind: 'restore', url: entry.url }
  }
}

function buildBrowserState (history, historyIndex, {
  resetWebNavigation = false
} = {}) {
  const entry = history[historyIndex]
  const result = {
    history,
    historyIndex,
    currentUrl: entry.url,
    address: getBrowserAddressForUrl(entry.url),
    source: entry.source,
    canGoBack: historyIndex > 0,
    canGoForward: history.length > historyIndex + 1
  }

  if (resetWebNavigation) {
    result.webCanGoBack = false
    result.webCanGoForward = false
  }

  return result
}
