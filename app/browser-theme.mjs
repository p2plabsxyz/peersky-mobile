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
