export const BROWSER_PRINT_MESSAGE_TYPE = 'peersky-print-page'
// Enough for a long article with its styles inlined, and small enough that a
// runaway page cannot push megabytes across the bridge.
export const MAX_PRINT_HTML_LENGTH = 4 * 1024 * 1024

/**
 * Whether the system print dialog can do anything with this address.
 *
 * Printing goes through the page's own markup, which means there has to be a
 * page: peersky:// addresses are the app's own screens and have no document
 * worth printing.
 */
export function canPrintBrowserUrl (targetUrl) {
  return /^(?:https?|hyper|hs|ipfs|ipns):\/\//i.test(String(targetUrl || ''))
}

/**
 * Asks the page for its markup.
 *
 * expo-print's uri option takes a PDF and nothing else, so a web address hands
 * it a file it cannot read and the dialog never opens. Printing the document
 * the page actually rendered means taking its markup and giving it that.
 */
export function createBrowserPrintScript (token = '') {
  return `(() => {
    try {
      var html = document.documentElement ? document.documentElement.outerHTML : '';
      var message = {
        type: ${JSON.stringify(BROWSER_PRINT_MESSAGE_TYPE)},
        token: ${JSON.stringify(String(token || ''))},
        html: html.slice(0, ${MAX_PRINT_HTML_LENGTH})
      };
      // Sent through the bridge's sender, taken before the page could replace
      // JSON.stringify and read the token out of this message.
      if (typeof window.__peerskyPostNative === 'function') window.__peerskyPostNative(message);
      else window.ReactNativeWebView.postMessage(JSON.stringify(message));
    } catch (error) {}
  })(); true;`
}

export function parseBrowserPrintMessage (message, expectedToken = '') {
  try {
    const parsed = JSON.parse(String(message || ''))
    if (parsed?.type !== BROWSER_PRINT_MESSAGE_TYPE) return null
    if (!expectedToken || parsed.token !== expectedToken) return null
    if (typeof parsed.html !== 'string' || !parsed.html) return null
    return parsed.html.slice(0, MAX_PRINT_HTML_LENGTH)
  } catch {
    return null
  }
}

/**
 * Relative stylesheets, images and fonts are resolved against wherever the
 * print renderer thinks it is, which is nowhere. A base href points them back
 * at the page they came from, so the printout keeps its layout.
 */
export function withPrintBaseHref (html, pageUrl) {
  const source = String(html || '')
  if (!pageUrl || /<base\s[^>]*href=/i.test(source)) return source

  const base = `<base href="${String(pageUrl).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" />`
  if (/<head\b[^>]*>/i.test(source)) {
    return source.replace(/<head\b([^>]*)>/i, `<head$1>${base}`)
  }
  return `${base}\n${source}`
}
