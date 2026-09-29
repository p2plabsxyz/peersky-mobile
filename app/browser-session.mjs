import {
  createBrowserTabsState,
  normalizeBrowserTabViewMode,
  restoreBrowserTabsState,
  serializeBrowserTabsState
} from './browser-tabs.mjs'

// Tabs always come back. Every browser does this, and the switch that used to
// govern it only ever cost somebody their open pages. userInteracted is still
// checked: a tap that landed before the session file finished reading has
// already moved the browser somewhere, and restoring over it loses that.
export function resolveBrowserStartupSession ({
  serializedSession,
  userInteracted
}) {
  if (serializedSession === null || userInteracted) return null
  return restoreBrowserTabsState(serializedSession)
}

/**
 * The settings page to reopen when going back, or null for ordinary back.
 *
 * Settings is a sheet rather than a history entry, so a link opened from it
 * leaves nothing behind to return to. This holds only while the page that link
 * opened is still the one on screen, in the tab it opened in: navigate on, or
 * switch tabs, and back goes back through history as it always did.
 */
export function getSettingsReturnPage (pending, { tabId, url }) {
  if (!pending?.page) return null
  if (pending.tabId !== tabId || pending.url !== url) return null
  return pending.page
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
