import {
  createBrowserTabsState,
  normalizeBrowserTabViewMode,
  restoreBrowserTabsState,
  serializeBrowserTabsState
} from './browser-tabs.mjs'

export function resolveBrowserStartupSession ({
  restoreTabsOnStartup,
  serializedSession,
  userInteracted
}) {
  if (!restoreTabsOnStartup || serializedSession === null || userInteracted) return null
  return restoreBrowserTabsState(serializedSession)
}

export function createBrowserResetSession (webViewRefs, viewMode) {
  webViewRefs.clear()
  const tabsState = {
    ...createBrowserTabsState(),
    viewMode: normalizeBrowserTabViewMode(viewMode)
  }

  return {
    tabsState,
    liveTabIds: [tabsState.activeTabId],
    serializedSession: serializeBrowserTabsState(tabsState)
  }
}
