import {
  BROWSER_HOME_URL,
  isWebUrl,
  MAX_BROWSER_URL_LENGTH
} from './browser-shell.mjs'

export const MAX_BROWSER_TABS = 50
export const MAX_LIVE_BROWSER_WEBVIEWS = 5
export const MAX_BROWSER_TITLE_LENGTH = 256
export const BROWSER_PAGE_ZOOMS = [80, 90, 100, 110, 125, 150]
export const DEFAULT_BROWSER_PAGE_ZOOM = 100
const SESSION_VERSION = 1
const INTERNAL_APP_URLS = {
  hyper: 'peersky://hyper/',
  holesail: 'peersky://holesail/',
  p2pmd: 'peersky://p2p/p2pmd/'
}

export function createBrowserTab (id, title = 'PeerSky') {
  return {
    id,
    title,
    history: [{ url: BROWSER_HOME_URL, source: { kind: 'home' } }],
    historyIndex: 0,
    pageZoom: DEFAULT_BROWSER_PAGE_ZOOM,
    webCanGoBack: false,
    webCanGoForward: false
  }
}

export function createBrowserTabsState () {
  return {
    tabs: [createBrowserTab('tab-1')],
    activeTabId: 'tab-1',
    nextTabIndex: 2
  }
}

export function getActiveBrowserTab (state) {
  return state.tabs.find((tab) => tab.id === state.activeTabId) || state.tabs[0] || null
}

export function isCurrentBrowserTabEntry (state, tabId, entry) {
  const tab = state.tabs.find((item) => item.id === tabId)
  const currentEntry = tab?.history[tab.historyIndex]
  if (currentEntry === entry) return true

  // Native WebView callbacks may arrive after its web entry was synchronized.
  return currentEntry?.source.kind === 'web' && entry?.source.kind === 'web'
}

export function addBrowserTabState (state) {
  if (state.tabs.length >= MAX_BROWSER_TABS) return state

  const id = `tab-${state.nextTabIndex}`
  const tab = createBrowserTab(id)

  return {
    tabs: [...state.tabs, tab],
    activeTabId: id,
    nextTabIndex: state.nextTabIndex + 1
  }
}

export function serializeBrowserTabsState (state) {
  return JSON.stringify({
    version: SESSION_VERSION,
    activeTabId: state.activeTabId,
    nextTabIndex: state.nextTabIndex,
    tabs: state.tabs.map((tab) => {
      const entry = tab.history[tab.historyIndex] || tab.history[0]
      const url = normalizeBrowserTabUrl(entry?.url)

      return {
        id: tab.id,
        pageZoom: normalizeBrowserPageZoom(tab.pageZoom),
        title: normalizeBrowserTabTitle(tab.title),
        entry: entry
          ? {
              url,
              source: getPersistedSource({ ...entry, url })
            }
          : {
              url: BROWSER_HOME_URL,
              source: { kind: 'home' }
            }
      }
    })
  })
}

export function restoreBrowserTabsState (serialized) {
  let value

  try {
    value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized
  } catch {
    return createBrowserTabsState()
  }

  if (!value || value.version !== SESSION_VERSION || !Array.isArray(value.tabs)) {
    return createBrowserTabsState()
  }

  const seenTabIds = new Set()
  const tabs = value.tabs
    .slice(0, MAX_BROWSER_TABS)
    .map(restoreBrowserTab)
    .filter((tab) => {
      if (!tab || seenTabIds.has(tab.id)) return false
      seenTabIds.add(tab.id)
      return true
    })

  if (tabs.length === 0) return createBrowserTabsState()

  const activeTabId = tabs.some((tab) => tab.id === value.activeTabId)
    ? value.activeTabId
    : tabs[0].id
  const highestTabIndex = tabs.reduce((highest, tab) => {
    const match = /^tab-(\d+)$/.exec(tab.id)
    const index = match ? Number(match[1]) : 0
    return Number.isSafeInteger(index) ? Math.max(highest, index) : highest
  }, 0)
  const requestedNextTabIndex = Number.isSafeInteger(value.nextTabIndex) && value.nextTabIndex > 0
    ? value.nextTabIndex
    : 1
  const nextTabIndex = Math.max(requestedNextTabIndex, highestTabIndex + 1)

  return {
    tabs,
    activeTabId,
    nextTabIndex
  }
}

function getPersistedSource (entry) {
  const { source } = entry

  if (source.kind === 'home' || source.kind === 'app') {
    return source
  }

  if (source.kind === 'web' && isWebUrl(entry.url)) {
    return { kind: 'web', uri: entry.url }
  }

  return { kind: 'restore', url: entry.url }
}

function restoreBrowserTab (tab) {
  if (
    !tab ||
    typeof tab.id !== 'string' ||
    tab.id.length < 1 ||
    tab.id.length > 64 ||
    typeof tab.entry?.url !== 'string' ||
    tab.entry.url.length < 1 ||
    tab.entry.url.length > MAX_BROWSER_URL_LENGTH
  ) {
    return null
  }

  const source = restorePersistedSource(tab.entry.source, tab.entry.url)

  return {
    id: tab.id,
    pageZoom: normalizeBrowserPageZoom(tab.pageZoom),
    title: normalizeBrowserTabTitle(tab.title || tab.entry.url),
    history: [{ url: tab.entry.url, source }],
    historyIndex: 0,
    webCanGoBack: false,
    webCanGoForward: false
  }
}

function restorePersistedSource (source, url) {
  if (!source || typeof source.kind !== 'string') {
    return { kind: 'restore', url }
  }

  if (source.kind === 'home' && url === BROWSER_HOME_URL) return { kind: 'home' }

  if (source.kind === 'app' && INTERNAL_APP_URLS[source.app] === url) {
    return { kind: 'app', app: source.app }
  }

  if (source.kind === 'web' && source.uri === url && isWebUrl(url)) {
    return { kind: 'web', uri: url }
  }

  return { kind: 'restore', url }
}

export function switchBrowserTabState (state, tabId) {
  if (!state.tabs.some((tab) => tab.id === tabId)) return state

  return {
    ...state,
    activeTabId: tabId
  }
}

export function updateBrowserTabState (state, tabId, patch) {
  const normalizedPatch = {
    ...patch,
    ...(Object.hasOwn(patch, 'title')
      ? { title: normalizeBrowserTabTitle(patch.title) }
      : {}),
    ...(Object.hasOwn(patch, 'pageZoom')
      ? { pageZoom: normalizeBrowserPageZoom(patch.pageZoom) }
      : {})
  }

  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === tabId ? { ...tab, ...normalizedPatch } : tab)
  }
}

export function touchLiveBrowserTabIds (tabIds, tabId) {
  return [...tabIds.filter((id) => id !== tabId), tabId]
    .slice(-MAX_LIVE_BROWSER_WEBVIEWS)
}

export function suspendInactiveBrowserTabsState (state, liveTabIds) {
  const liveIds = new Set(liveTabIds)
  let changed = false
  const tabs = state.tabs.map((tab) => {
    if (tab.id === state.activeTabId || liveIds.has(tab.id)) return tab

    let tabChanged = false
    const history = tab.history.map((entry) => {
      if (entry.source.kind !== 'hyper' && entry.source.kind !== 'error') return entry

      changed = true
      tabChanged = true
      return {
        url: entry.url,
        source: { kind: 'restore', url: entry.url }
      }
    })

    return tabChanged ? { ...tab, history } : tab
  })

  return changed ? { ...state, tabs } : state
}

export function closeBrowserTabState (state, tabId) {
  const tabIndex = state.tabs.findIndex((tab) => tab.id === tabId)
  if (tabIndex < 0) return state

  if (state.tabs.length === 1) {
    const id = `tab-${state.nextTabIndex}`
    return {
      tabs: [createBrowserTab(id)],
      activeTabId: id,
      nextTabIndex: state.nextTabIndex + 1
    }
  }

  const tabs = state.tabs.filter((tab) => tab.id !== tabId)
  const activeTabId = state.activeTabId === tabId
    ? tabs[Math.max(0, tabIndex - 1)].id
    : state.activeTabId

  return {
    ...state,
    tabs,
    activeTabId
  }
}

export function normalizeBrowserTabTitle (title) {
  return String(title || '').slice(0, MAX_BROWSER_TITLE_LENGTH)
}

export function normalizeBrowserPageZoom (pageZoom) {
  return BROWSER_PAGE_ZOOMS.includes(pageZoom) ? pageZoom : DEFAULT_BROWSER_PAGE_ZOOM
}

function normalizeBrowserTabUrl (url) {
  const value = String(url || '')
  return value && value.length <= MAX_BROWSER_URL_LENGTH ? value : BROWSER_HOME_URL
}
