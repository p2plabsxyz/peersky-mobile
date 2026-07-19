import {
  createBrowserTabsState,
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

export function createBrowserResetSession (webViewRefs) {
  webViewRefs.clear()
  const tabsState = createBrowserTabsState()

  return {
    tabsState,
    liveTabIds: [tabsState.activeTabId],
    serializedSession: serializeBrowserTabsState(tabsState)
  }
}
