// browser://theme/ and agregore://theme/ on the phone, as on the desktop:
// pages made for PeerSky or Agregore take the browser's colours and look.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

import { BROWSER_THEME_SCHEMES, browserThemeFiles, browserThemeVarsCss } from '../../app/browser-theme.mjs'
import STYLE_CSS from '../../app/browser-theme-style.mjs'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('the theme pages are given', () => {
  test('vars.css follows the app, light or dark, not the system', () => {
    // Agregore's pages map their own names from these, with dark defaults, so
    // a page left without them was dark inside a light app.
    const light = browserThemeVarsCss(false)
    const dark = browserThemeVarsCss(true)
    for (const name of ['font-family', 'background', 'page-background', 'text-color', 'primary-highlight', 'secondary-highlight']) {
      assert.match(light, new RegExp(`--browser-theme-${name}: `))
      assert.match(dark, new RegExp(`--browser-theme-${name}: `))
    }
    assert.match(light, /--browser-theme-background: #ffffff;/)
    assert.match(light, /--browser-theme-text-color: #151821;/)
    assert.match(dark, /--browser-theme-background: #18181b;/)
    assert.match(dark, /--browser-theme-text-color: #e7eaf0;/)
    assert.match(light, /color-scheme: light;/)
    assert.match(dark, /color-scheme: dark;/)
    assert.doesNotMatch(dark, /prefers-color-scheme/)
  })

  test('style.css is the desktop\'s, kept as the asset says', () => {
    assert.equal(STYLE_CSS, read('assets/browser-theme/style.css'))
    assert.match(STYLE_CSS, /^@import url\('browser:\/\/theme\/vars\.css'\);/)
    assert.deepEqual(Object.keys(browserThemeFiles(true)).sort(), ['style.css', 'vars.css'])
    assert.deepEqual(BROWSER_THEME_SCHEMES, ['browser', 'agregore'])
  })

  test('every tab is handed them, made again only when the app goes light or dark', () => {
    const app = read('app/index.tsx')
    assert.match(app, /useMemo\(\(\) => browserThemeFiles\(browserIsDark\), \[browserIsDark\]\)/)
    assert.match(app, /themeFiles: browserThemeFilesForTabs/)
  })
})

describe('the WebView answers browser:// and agregore://', () => {
  test('on iOS, a scheme handler serves the theme host from the files and nothing else', () => {
    const ios = read('plugins/templates/PeerSkyWebViewManager.m.template')
    assert.match(ios, /RCT_EXPORT_VIEW_PROPERTY\(themeFiles, NSDictionary\)/)
    assert.match(ios, /for \(NSString \*scheme in @\[ @"browser", @"agregore" \]\)/)
    assert.match(ios, /setURLSchemeHandler:PeerSkySharedThemeSchemeHandler\(\) forURLScheme:scheme/)
    const handler = ios.slice(ios.indexOf('@implementation PeerSkyThemeSchemeHandler'), ios.indexOf('static PeerSkyThemeSchemeHandler'))
    assert.match(handler, /isEqualToString:@"theme"/)
    assert.match(handler, /\.themeFiles\[name\]/)
    assert.match(handler, /statusCode:css \? 200 : 404/)
    assert.match(handler, /text\/css; charset=utf-8/)
  })

  test('on Android, the client answers them before any blocking, from what the manager hands it', () => {
    const client = read('plugins/templates/PeerSkyWebViewClient.kt.template')
    const intercept = client.slice(client.indexOf('override fun shouldInterceptRequest'), client.indexOf('internal fun themeResponse'))
    assert.ok(intercept.indexOf('themeResponse(request.url)') < intercept.indexOf('shouldBlock(request)'))
    assert.match(client, /scheme != "browser" && scheme != "agregore"/)
    assert.match(client, /uri\.host\.equals\("theme", ignoreCase = true\)/)
    assert.match(client, /WebResourceResponse\("text\/css", "utf-8", 200/)

    const manager = read('plugins/templates/PeerSkyWebViewManager.kt.template')
    assert.match(manager, /@ReactProp\(name = "themeFiles"\)/)
    assert.match(manager, /propName == "themeFiles"/)
    assert.match(manager, /client\.themeFiles = themeFiles\[view\.webView\]/)
    assert.match(manager, /clients\[wrapper\.webView\]\?\.themeFiles = next/)
  })
})
