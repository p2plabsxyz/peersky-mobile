// browser://theme/ and agregore://theme/ on the phone, as on the desktop:
// pages made for PeerSky or Agregore take the browser's colours and look.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import vm from 'node:vm'

import { BROWSER_THEME_SCHEMES, browserThemeFiles, browserThemeVarsCss, createBrowserThemeScript } from '../../app/browser-theme.mjs'
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

// Just enough of a page for the script: elements with attributes, text
// nodes, a parent that takes insertBefore, and a MutationObserver the test
// feeds by hand.
function fakePage () {
  const inserted = []
  let observer = null
  let loaded = null
  const element = (tagName, attributes = {}, text = '') => ({
    nodeType: 1,
    tagName,
    attributes: { ...attributes },
    textContent: text,
    parentNode: null,
    getAttribute (name) { return this.attributes[name] ?? null },
    setAttribute (name, value) { this.attributes[name] = String(value) },
    hasAttribute (name) { return name in this.attributes }
  })
  const head = { tagName: 'HEAD', insertBefore (node, before) { inserted.push({ node, before }) } }
  const document = { createElement: (tag) => element(tag.toUpperCase()) }
  const window = { addEventListener: (type, listener) => { if (type === 'load') loaded = listener } }
  class MutationObserver {
    constructor (callback) { this.callback = callback; observer = this }
    observe () {}
    disconnect () { this.disconnected = true }
  }
  return {
    run (script) { vm.runInNewContext(script, { document, window, MutationObserver }) },
    add (node) { node.parentNode = node.parentNode || head; observer.callback([{ addedNodes: [node] }]) },
    element,
    head,
    inserted,
    load () { loaded() },
    observer: () => observer
  }
}

describe('pages over https://, which WebKit will not load browser:// into', () => {
  test('a link to style.css gets a data: copy, with the variables just before it', () => {
    const page = fakePage()
    page.run(createBrowserThemeScript(true))
    const link = page.element('LINK', { rel: 'stylesheet', href: 'browser://theme/style.css' })
    page.add(link)
    assert.match(link.getAttribute('href'), /^data:text\/css;charset=utf-8,/)
    const css = decodeURIComponent(link.getAttribute('href').split(',')[1])
    assert.equal(css, STYLE_CSS.replace("@import url('browser://theme/vars.css');", ''))
    assert.equal(page.inserted.length, 1)
    assert.equal(page.inserted[0].before, link)
    assert.equal(page.inserted[0].node.textContent, browserThemeVarsCss(true))

    // Agregore's own name for it is taken the same way, and the variables go in once.
    const agregore = page.element('LINK', { rel: 'stylesheet', href: 'agregore://theme/style.css?v=1' })
    page.add(agregore)
    assert.match(agregore.getAttribute('href'), /^data:text\/css/)
    assert.equal(page.inserted.length, 1)
  })

  test('a style that imports vars.css gets the variables, its text early or late', () => {
    const early = fakePage()
    early.run(createBrowserThemeScript(false))
    const style = early.element('STYLE', {}, '@import url("browser://theme/vars.css");')
    early.add(style)
    assert.equal(early.inserted[0]?.before, style)

    const late = fakePage()
    late.run(createBrowserThemeScript(false))
    const empty = late.element('STYLE')
    late.add(empty)
    assert.equal(late.inserted.length, 0)
    late.add({ nodeType: 3, data: '@import url("agregore://theme/vars.css");', parentNode: empty })
    assert.equal(late.inserted[0]?.before, empty)
    assert.equal(late.inserted[0].node.textContent, browserThemeVarsCss(false))
  })

  test('a page that never asks is left alone, and the watch ends when it has loaded', () => {
    const page = fakePage()
    page.run(createBrowserThemeScript(false))
    const link = page.element('LINK', { rel: 'stylesheet', href: 'https://example.com/site.css' })
    page.add(link)
    page.add(page.element('STYLE', {}, 'body { color: red }'))
    assert.equal(link.getAttribute('href'), 'https://example.com/site.css')
    assert.equal(page.inserted.length, 0)
    page.load()
    assert.equal(page.observer().disconnected, true)
  })

  test('every tab runs it, made again only when the app goes light or dark', () => {
    const app = read('app/index.tsx')
    assert.match(app, /useMemo\(\(\) => createBrowserThemeScript\(browserIsDark\), \[browserIsDark\]\)/)
    const before = app.slice(app.indexOf('const browserBeforeContentScript'), app.indexOf('const webViewGeneration'))
    assert.match(before, /browserThemeScript\n/)
  })
})

describe('frames on Android', () => {
  test('are decided by the client, as the app decides them on iOS', () => {
    // react-native-webview gives the app no isTopFrame on Android, so a
    // frame's data: preview was refused as a whole tab sent to data: would be.
    const client = read('plugins/templates/PeerSkyWebViewClient.kt.template')
    assert.match(client, /if \(!request\.isForMainFrame\) return !frameMayLoad\(request\.url\)/)
    const rules = client.slice(client.indexOf('internal fun frameMayLoad'), client.indexOf('internal fun themeResponse'))
    assert.match(rules, /"about:blank" \|\| url == "about:srcdoc"/)
    assert.match(rules, /"http", "https", "data", "blob" -> true/)
    assert.match(rules, /else -> false/)
  })
})
