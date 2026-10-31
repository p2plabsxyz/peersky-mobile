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

/**
 * Every website's cookies and storage, for Remove my data and a restore, so
 * whoever uses the phone next is not signed in as the last person. Android
 * keeps no list of its sites and clears them all at once. iOS lists every
 * site but the app's own loopback pages, and removes each with all it holds.
 *
 * @returns what the platform said, or null when there was nothing to do it with.
 */
export async function removeAllWebsiteData (browserData) {
  if (typeof browserData?.removeAllSites === 'function') return browserData.removeAllSites()
  if (typeof browserData?.listSites !== 'function' || typeof browserData?.removeSites !== 'function') return null
  const sites = await browserData.listSites([])
  const names = (Array.isArray(sites) ? sites : [])
    .map((site) => site?.name)
    .filter((name) => typeof name === 'string' && name.length > 0)
  return browserData.removeSites(names)
}
