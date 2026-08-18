export function clearBrowserWebViewData (webView) {
  if (!webView || typeof webView.clearCache !== 'function') return false

  webView.stopLoading?.()
  webView.clearCache(true)
  return true
}
