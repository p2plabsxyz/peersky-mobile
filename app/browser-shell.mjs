import { parseExternalAppLink } from './browser-permissions.mjs'

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

/** @param {'back' | 'forward' | null} [direction] */
export function recordBrowserWebNavigationState (
  state,
  url,
  source,
  direction = null,
  hasNativeBackEntry = true,
  isLoading = false
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

  // A WebView with no native back entry has replaced or redirected its first
  // page. Keep that transition out of browser history so Back can reach Home.
  if (!direction && !hasNativeBackEntry) {
    return replaceBrowserEntryState(state, url, source)
  }

  const adjacentIndex = direction === 'back'
    ? state.historyIndex - 1
    : direction === 'forward'
      ? state.historyIndex + 1
      : -1

  if (state.history[adjacentIndex]?.url === url) {
    return buildBrowserState(state.history, adjacentIndex)
  }

  // Native WebView history can be deeper than our bounded restorable history.
  // Do not append an older native target as a new forward entry: doing that
  // makes repeated Back alternate between pages once the bound is crossed.
  if (direction) {
    return replaceBrowserEntryState(state, url, source)
  }

  return commitBrowserEntryState(state, url, source)
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

export function getBrowserRequestAction ({
  requestUrl,
  currentSourceKind,
  currentUrl = '',
  navigationType = '',
  isTopFrame = true
}) {
  const url = String(requestUrl || '')

  if (url.length > MAX_BROWSER_URL_LENGTH) {
    return { action: 'block' }
  }

  if (url === 'about:blank') {
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

/**
 * The host of a hyper:// address, lower case: how a site is known for things
 * like the publishing permission. Null for anything else.
 */
export function getHyperSiteId (url) {
  try {
    const parsed = new URL(String(url || ''))
    if (parsed.protocol !== 'hyper:') return null
    const host = parsed.hostname.toLowerCase()
    return /^([0-9a-f]{64}|[a-z0-9]{52})$/.test(host) ? host : null
  } catch {
    return null
  }
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
 * The site a hyper:// tab's bridge request speaks for, or null when it may not
 * use the bridge: the page that sent it is somewhere else, such as a web page
 * the tab navigated off to.
 */
export function getHyperBridgeSite ({ url, reportedUrl = '', isHyper }) {
  const siteId = isHyper ? getHyperSiteId(url) : null
  if (!siteId) return null
  const page = getBrowserMessagePageUrl(String(reportedUrl || '').split('#')[0], url)
  return getHyperSiteId(page) === siteId ? siteId : null
}

export function formatHyperSiteForPrompt (siteId) {
  const id = String(siteId || '')
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
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
