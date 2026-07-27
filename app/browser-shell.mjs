import { parseExternalAppLink } from './browser-permissions.mjs'

export const BROWSER_HOME_URL = 'peersky://home'
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

export function getSearchUrl (searchEngine, query, customSearchUrl = '') {
  const encodedQuery = encodeURIComponent(String(query || ''))
  const normalizedCustomUrl = normalizeCustomSearchUrl(customSearchUrl)

  if (searchEngine === 'custom' && normalizedCustomUrl) {
    return normalizedCustomUrl.replaceAll(CUSTOM_SEARCH_QUERY_PLACEHOLDER, encodedQuery)
  }

  return `https://duckduckgo.com/?q=${encodedQuery}`
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

export function getBrowserWebViewKey (tabId, sourceKind) {
  return `${tabId}:${sourceKind}`
}

export function getBrowserAddressForUrl (url) {
  return url === BROWSER_HOME_URL ? '' : url
}

export function commitBrowserEntryState (state, url, source) {
  const nextHistory = state.history
    .slice(0, state.historyIndex + 1)
    .map(getRestorableHistoryEntry)
    .concat({ url, source })
    .slice(-MAX_BROWSER_HISTORY_ENTRIES)
  return buildBrowserState(nextHistory, nextHistory.length - 1, {
    resetWebNavigation: true
  })
}

export function replaceBrowserEntryState (state, url, source) {
  const nextHistory = state.history.slice()
  nextHistory[state.historyIndex] = { url, source }
  return buildBrowserState(nextHistory, state.historyIndex)
}

export function syncBrowserEntryState (state, url, source) {
  return replaceBrowserEntryState(state, url, source)
}

export function getBrowserBackState (state) {
  if (state.historyIndex <= 0) return null
  return buildBrowserState(state.history, state.historyIndex - 1)
}

export function getBrowserForwardState (state) {
  if (state.historyIndex >= state.history.length - 1) return null
  return buildBrowserState(state.history, state.historyIndex + 1)
}

export function getBrowserRequestAction ({ requestUrl, currentSourceKind, isTopFrame = true }) {
  const url = String(requestUrl || '')

  if (url.length > MAX_BROWSER_URL_LENGTH) {
    return { action: 'block' }
  }

  if (url === 'about:blank') {
    return { action: 'allow' }
  }

  if (isHyperUrl(url)) {
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
    return {
      action: 'commit-web',
      url,
      source: { kind: 'web', uri: url }
    }
  }

  return { action: 'allow' }
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
