export function clearBrowserWebViewData (webView) {
  if (!webView || typeof webView.clearCache !== 'function') return false

  webView.stopLoading?.()
  webView.clearCache(true)
  return true
}

/**
 * Clears what websites kept on the phone, for burning the tabs and for
 * clearing cached website data in Settings.
 *
 * On iOS react-native-webview's clearCache(true) empties local storage and
 * IndexedDB for every origin in the shared store, the app's own pages with
 * them: PeerTunes keeps its library in IndexedDB at http://127.0.0.1, so a burn
 * emptied the library while the songs stayed in their drives. The native
 * PeerSkyBrowserData clears every website but the app's own loopback pages. A
 * build without it clears the caches only, never storage. Android's
 * clearCache(true) only ever cleared the HTTP cache, and still does.
 *
 * @returns false when there was nothing to clear with.
 */
export function clearWebsiteData ({ platform, browserData, webViews }) {
  const views = [...(webViews || [])].filter(Boolean)
  if (platform !== 'ios') {
    return views.map(clearBrowserWebViewData).some(Boolean)
  }

  for (const webView of views) webView.stopLoading?.()
  if (typeof browserData?.clearSiteData === 'function') {
    browserData.clearSiteData().catch(() => {})
    return true
  }
  let cleared = false
  for (const webView of views) {
    if (typeof webView.clearCache !== 'function') continue
    webView.clearCache(false)
    cleared = true
  }
  return cleared
}
