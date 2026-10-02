import {
  BROWSER_HOME_URL,
  boundBrowserHistory,
  isWebUrl,
  MAX_BROWSER_HISTORY_ENTRIES,
  MAX_BROWSER_URL_LENGTH
} from './browser-shell.mjs'
import { getRuntimeAppFromUrl } from './internal-apps-registry.mjs'

export const MAX_BROWSER_TABS = 50
export const MAX_LIVE_BROWSER_WEBVIEWS = 5
export const MAX_BROWSER_TITLE_LENGTH = 256
export const BROWSER_PAGE_ZOOMS = [80, 90, 100, 110, 125, 150]
export const DEFAULT_BROWSER_PAGE_ZOOM = 100
export const DEFAULT_BROWSER_TAB_VIEW_MODE = 'grid'
const SESSION_VERSION = 1
// An incognito tab keeps no history, no preview and no cookies past its own
// session, and is never written into the saved session.
export function createBrowserTab (id, title = 'New tab', { incognito = false } = {}) {
  return {
    id,
    title,
    desktopView: false,
    history: [{ url: BROWSER_HOME_URL, source: { kind: 'home' } }],
    historyIndex: 0,
    pageZoom: DEFAULT_BROWSER_PAGE_ZOOM,
    webCanGoBack: false,
    webCanGoForward: false,
    ...(incognito ? { incognito: true } : {})
  }
}

export function createBrowserTabsState () {
  return {
    tabs: [createBrowserTab('tab-1')],
    activeTabId: 'tab-1',
    nextTabIndex: 2,
    viewMode: DEFAULT_BROWSER_TAB_VIEW_MODE
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

export function addBrowserTabState (state, { incognito = false } = {}) {
  if (state.tabs.length >= MAX_BROWSER_TABS) return state

  const id = `tab-${state.nextTabIndex}`
  const tab = createBrowserTab(id, 'New tab', { incognito })

  return {
    ...state,
    tabs: [...state.tabs, tab],
    activeTabId: id,
    nextTabIndex: state.nextTabIndex + 1
  }
}

export function addBackgroundBrowserTabState (state, url, title = 'New tab', { incognito = false } = {}) {
  const previousActiveTabId = state.activeTabId
  const nextState = addBrowserTabState(state, { incognito })
  if (nextState === state) return state

  const normalizedUrl = normalizeBrowserTabUrl(url)
  const tabId = nextState.activeTabId
  return {
    ...updateBrowserTabState(nextState, tabId, {
      title,
      history: [{
        url: normalizedUrl,
        source: normalizedUrl === BROWSER_HOME_URL
          ? { kind: 'home' }
          : { kind: 'restore', url: normalizedUrl }
      }],
      historyIndex: 0
    }),
    activeTabId: previousActiveTabId
  }
}

export function serializeBrowserTabsState (state) {
  const kept = state.tabs.filter((tab) => !tab.incognito)
  const tabs = kept.length > 0 ? kept : [createBrowserTab(`tab-${state.nextTabIndex}`)]
  const activeTabId = tabs.some((tab) => tab.id === state.activeTabId)
    ? state.activeTabId
    : tabs[tabs.length - 1].id
  return JSON.stringify({
    version: SESSION_VERSION,
    activeTabId,
    nextTabIndex: state.nextTabIndex + (kept.length > 0 ? 0 : 1),
    viewMode: normalizeBrowserTabViewMode(state.viewMode),
    tabs: tabs.map((tab) => {
      const retainedHistory = boundBrowserHistory(tab.history)
      const history = retainedHistory.map((entry) => {
        const url = normalizeBrowserTabUrl(entry?.url)
        return {
          url,
          source: getPersistedSource({ ...entry, url })
        }
      })
      const currentEntry = tab.history[tab.historyIndex]
      const retainedIndex = retainedHistory.indexOf(currentEntry)
      const historyIndex = retainedIndex >= 0 ? retainedIndex : history.length - 1
      const entry = history[historyIndex]
      const persistedHistory = history.length > 0
        ? history
        : [{
            url: BROWSER_HOME_URL,
            source: { kind: 'home' }
          }]

      return {
        id: tab.id,
        desktopView: tab.desktopView === true,
        pageZoom: normalizeBrowserPageZoom(tab.pageZoom),
        title: normalizeBrowserTabTitle(tab.title),
        history: persistedHistory,
        historyIndex: history.length > 0 ? historyIndex : 0,
        // Keep the current entry for compatibility with older app versions.
        entry: entry || {
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
    nextTabIndex,
    viewMode: normalizeBrowserTabViewMode(value.viewMode)
  }
}

function getPersistedSource (entry) {
  const { source } = entry

  if (source.kind === 'home' || source.kind === 'p2p' || source.kind === 'app') {
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
    tab.id.length > 64
  ) {
    return null
  }

  const persistedHistory = Array.isArray(tab.history) && tab.history.length > 0
    ? tab.history.slice(-MAX_BROWSER_HISTORY_ENTRIES)
    : [tab.entry]
  const history = persistedHistory
    .map(restorePersistedEntry)
    .filter(Boolean)

  if (history.length === 0) return null

  const historyIndex = Number.isInteger(tab.historyIndex)
    ? Math.min(Math.max(tab.historyIndex, 0), history.length - 1)
    : history.length - 1
  const currentEntry = history[historyIndex]

  return {
    id: tab.id,
    desktopView: tab.desktopView === true,
    pageZoom: normalizeBrowserPageZoom(tab.pageZoom),
    title: normalizeBrowserTabTitle(tab.title || currentEntry.url),
    history,
    historyIndex,
    webCanGoBack: false,
    webCanGoForward: false
  }
}

function restorePersistedEntry (entry) {
  if (
    typeof entry?.url !== 'string' ||
    entry.url.length < 1 ||
    entry.url.length > MAX_BROWSER_URL_LENGTH
  ) {
    return null
  }

  return {
    url: entry.url,
    source: restorePersistedSource(entry.source, entry.url)
  }
}

function restorePersistedSource (source, url) {
  if (!source || typeof source.kind !== 'string') {
    return { kind: 'restore', url }
  }

  if (source.kind === 'home' && url === BROWSER_HOME_URL) return { kind: 'home' }

  // Ask the registry rather than keeping a second copy of the app list here.
  // The old map had to be updated by hand for every new app, and compared exact
  // strings, so a shared link carrying a #playlist suffix never matched.
  if (source.kind === 'app' && getRuntimeAppFromUrl(url) === source.app) {
    return { kind: 'app', app: source.app }
  }

  if (source.kind === 'web' && source.uri === url && isWebUrl(url)) {
    return { kind: 'web', uri: url }
  }

  return { kind: 'restore', url }
}

/**
 * Adds tabs that came from another device, after the ones already open. A
 * page that is already open is not opened twice, the tab limit holds, and the
 * tab on screen stays the one on screen: these load when they are chosen.
 */
export function appendIncomingBrowserTabs (state, incoming) {
  const list = Array.isArray(incoming?.tabs) ? incoming.tabs : []
  if (list.length === 0) return state

  const openUrls = new Set(state.tabs.map((tab) => tab.history[tab.historyIndex]?.url).filter(Boolean))
  const usedIds = new Set(state.tabs.map((tab) => tab.id))
  const tabs = [...state.tabs]
  let nextTabIndex = state.nextTabIndex

  for (const item of list) {
    if (tabs.length >= MAX_BROWSER_TABS) break
    const url = typeof item?.url === 'string' ? item.url : ''
    if (!/^(?:https?|hyper):\/\/\S+$/i.test(url) || openUrls.has(url)) continue

    while (usedIds.has(`tab-${nextTabIndex}`)) nextTabIndex += 1
    const tab = restoreBrowserTab({
      id: `tab-${nextTabIndex}`,
      title: typeof item.title === 'string' && item.title ? item.title : url,
      historyIndex: 0,
      history: [{ url, source: isWebUrl(url) ? { kind: 'web', uri: url } : { kind: 'restore', url } }]
    })
    if (!tab) continue

    usedIds.add(tab.id)
    openUrls.add(url)
    nextTabIndex += 1
    tabs.push(tab)
  }

  if (tabs.length === state.tabs.length) return state
  return { ...state, tabs, nextTabIndex }
}

export function switchBrowserTabState (state, tabId) {
  if (!state.tabs.some((tab) => tab.id === tabId)) return state

  return {
    ...state,
    activeTabId: tabId
  }
}

export function setBrowserTabViewModeState (state, viewMode) {
  const normalizedViewMode = normalizeBrowserTabViewMode(viewMode)
  return normalizedViewMode === state.viewMode
    ? state
    : { ...state, viewMode: normalizedViewMode }
}

export function normalizeBrowserTabViewMode (viewMode) {
  return viewMode === 'list' ? 'list' : DEFAULT_BROWSER_TAB_VIEW_MODE
}

export function updateBrowserTabState (state, tabId, patch) {
  const normalizedPatch = {
    ...patch,
    ...(Object.hasOwn(patch, 'title')
      ? { title: normalizeBrowserTabTitle(patch.title) }
      : {}),
    ...(Object.hasOwn(patch, 'pageZoom')
      ? { pageZoom: normalizeBrowserPageZoom(patch.pageZoom) }
      : {}),
    ...(Object.hasOwn(patch, 'desktopView')
      ? { desktopView: patch.desktopView === true }
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
      nextTabIndex: state.nextTabIndex + 1,
      viewMode: normalizeBrowserTabViewMode(state.viewMode)
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
