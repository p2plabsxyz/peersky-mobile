// browser://theme/ and agregore://theme/ on the phone, as on the desktop
// (peersky-browser src/protocols/theme-handler.js). Pages made for PeerSky or
// Agregore, like the apps at agregore.mauve.moe, take the browser's colours
// from vars.css and its look from style.css. The native WebView answers these
// two schemes from the files handed to it here (PeerSkyWebViewManager on iOS,
// PeerSkyWebViewClient on Android).
//
// vars.css follows the app's own light or dark setting, as the pages the app
// builds do (browser-html.mjs), not the system's. style.css is the desktop's
// (scripts/sync-browser-theme.mjs).
import { DOCUMENT_THEMES } from './browser-html.mjs'
import STYLE_CSS from './browser-theme-style.mjs'

export const BROWSER_THEME_SCHEMES = ['browser', 'agregore']

// The desktop's highlights, the same in its light and dark themes.
const PRIMARY_HIGHLIGHT = '#3b82f6'
const SECONDARY_HIGHLIGHT = '#1d4ed8'

export function browserThemeVarsCss (isDark = false) {
  const theme = isDark ? DOCUMENT_THEMES.dark : DOCUMENT_THEMES.light
  return `:root {
  color-scheme: ${isDark ? 'dark' : 'light'};
  --browser-theme-font-family: system-ui, -apple-system, sans-serif;
  --browser-theme-background: ${theme.page};
  --browser-theme-page-background: ${theme.page};
  --browser-theme-text-color: ${theme.ink};
  --browser-theme-primary-highlight: ${PRIMARY_HIGHLIGHT};
  --browser-theme-secondary-highlight: ${SECONDARY_HIGHLIGHT};
  --browser-theme-background-hover: ${isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'};
  --browser-theme-background-active: rgba(59, 130, 246, 0.12);
}
`
}

/** The files a WebView serves at browser://theme/ and agregore://theme/. */
export function browserThemeFiles (isDark = false) {
  return {
    'vars.css': browserThemeVarsCss(isDark),
    'style.css': STYLE_CSS
  }
}

// WebKit counts browser:// and agregore:// as insecure beside https://, so it
// will not load them into an https:// page, and the WebView's own answer is
// never asked for. A page that asks for the theme gets it from this script as
// well: the variables in a <style> of their own, put just before the first
// thing that asks, and a link to style.css pointed at a data: copy. A page
// that never asks is left alone, and the watch ends once the page has loaded.
export function createBrowserThemeScript (isDark = false) {
  const style = STYLE_CSS.replace("@import url('browser://theme/vars.css');", '')
  const styleUrl = 'data:text/css;charset=utf-8,' + encodeURIComponent(style)
  return `(function () {
  var VARS = ${JSON.stringify(browserThemeVarsCss(isDark))};
  var STYLE_URL = ${JSON.stringify(styleUrl)};
  var added = false;
  function asksForTheme (text) {
    var lower = String(text || '').toLowerCase();
    return lower.indexOf('browser://theme/') !== -1 || lower.indexOf('agregore://theme/') !== -1;
  }
  function addVars (before) {
    if (added || !before.parentNode) return;
    added = true;
    var node = document.createElement('style');
    node.setAttribute('data-peersky-theme', '');
    node.textContent = VARS;
    before.parentNode.insertBefore(node, before);
  }
  function visit (node) {
    if (!node) return;
    // A style's text can come after the style itself while the page loads.
    if (node.nodeType === 3) {
      if (node.parentNode && node.parentNode.tagName === 'STYLE' && asksForTheme(node.data)) addVars(node.parentNode);
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.tagName === 'LINK') {
      var href = String(node.getAttribute('href') || '').toLowerCase();
      if (href.indexOf('browser://theme/') !== 0 && href.indexOf('agregore://theme/') !== 0) return;
      addVars(node);
      if (href.split('?')[0].split('#')[0].slice(-'/style.css'.length) === '/style.css') node.setAttribute('href', STYLE_URL);
    } else if (node.tagName === 'STYLE' && !node.hasAttribute('data-peersky-theme') && asksForTheme(node.textContent)) {
      addVars(node);
    }
  }
  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var nodes = records[i].addedNodes;
      for (var j = 0; j < nodes.length; j++) visit(nodes[j]);
    }
  });
  observer.observe(document, { childList: true, subtree: true });
  window.addEventListener('load', function () { observer.disconnect(); }, { once: true });
})();`
}
