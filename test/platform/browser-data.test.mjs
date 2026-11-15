import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import { clearBrowserWebViewData, clearWebsiteData } from '../../app/browser-data.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

function fakeWebView (calls) {
  return {
    clearCache: (includeDiskFiles) => calls.push(['clearCache', includeDiskFiles]),
    clearHistory: () => calls.push(['clearHistory']),
    stopLoading: () => calls.push(['stopLoading'])
  }
}

describe('browser data clearing', () => {
  test('clears memory and disk cache on every supported platform', () => {
    const calls = []
    assert.equal(clearBrowserWebViewData(fakeWebView(calls)), true)
    assert.deepEqual(calls, [
      ['stopLoading'],
      ['clearCache', true]
    ])
  })

  test('reports when no WebView cache API is available', () => {
    assert.equal(clearBrowserWebViewData(null), false)
    assert.equal(clearBrowserWebViewData({}), false)
  })

  // A burn on iOS emptied PeerTunes: clearCache(true) clears IndexedDB for
  // every origin, and the library lives in IndexedDB at http://127.0.0.1.
  test('on iOS the websites are cleared by the native module, which keeps the app\'s own pages', () => {
    const calls = []
    let asked = 0
    const browserData = { clearSiteData: () => { asked += 1; return Promise.resolve({ cleared: 3, kept: 1 }) } }
    assert.equal(clearWebsiteData({ platform: 'ios', browserData, webViews: [fakeWebView(calls), fakeWebView(calls)] }), true)
    assert.equal(asked, 1)
    // Pages stop, and nothing clears every origin's storage behind its back.
    assert.deepEqual(calls, [['stopLoading'], ['stopLoading']])

    // A build without the module clears caches, never storage.
    const older = []
    assert.equal(clearWebsiteData({ platform: 'ios', browserData: undefined, webViews: [fakeWebView(older)] }), true)
    assert.deepEqual(older, [['stopLoading'], ['clearCache', false]])
    assert.equal(clearWebsiteData({ platform: 'ios', browserData: undefined, webViews: [] }), false)
  })

  test('on Android the HTTP cache is cleared as before', () => {
    const calls = []
    assert.equal(clearWebsiteData({ platform: 'android', browserData: undefined, webViews: new Set([fakeWebView(calls), null]).values() }), true)
    assert.deepEqual(calls, [['stopLoading'], ['clearCache', true]])
    assert.equal(clearWebsiteData({ platform: 'android', webViews: [] }), false)
  })

  test('burning and Settings both clear websites this way, and the module keeps loopback pages', async () => {
    const app = await read('app/index.tsx')
    const burn = app.slice(app.indexOf('function burnBrowserTabs'), app.indexOf('function onBrowserCloseAllTabs'))
    assert.match(burn, /clearWebsiteData\(\{\s+platform: Platform\.OS,\s+browserData: NativeModules\.PeerSkyBrowserData,\s+webViews: browserWebViewRefs\.current\.values\(\)/)
    const settings = await read('app/settings/DataClearing.tsx')
    assert.match(settings, /clearWebsiteData\(\{\s+platform: Platform\.OS,\s+browserData: NativeModules\.PeerSkyBrowserData,\s+webViews: \[clearWebViewRef\.current\]/)
    assert.doesNotMatch(app + settings, /clearBrowserWebViewData\(/)

    const manager = await read('plugins/templates/PeerSkyWebViewManager.m.template')
    assert.match(manager, /RCT_EXPORT_MODULE\(PeerSkyBrowserData\)/)
    assert.match(manager, /NSSet<NSString \*> \*appOwn = \[NSSet setWithArray:@\[ @"127\.0\.0\.1", @"localhost" \]\];/)
    assert.match(manager, /if \(\[appOwn containsObject:record\.displayName\.lowercaseString\]\) \{\s+kept \+= 1;\s+\} else \{\s+\[sites addObject:record\];/)
    assert.match(manager, /\[store removeDataOfTypes:types forDataRecords:sites completionHandler:/)
    // The same storage clearCache(true) cleared, no more: cookies are kept.
    // They go one site at a time, in Settings > Cookies and site data.
    const clearAll = manager.slice(manager.indexOf('RCT_EXPORT_METHOD(clearSiteData'), manager.indexOf('RCT_EXPORT_METHOD(listSites'))
    assert.match(clearAll, /WKWebsiteDataTypeIndexedDBDatabases/)
    assert.doesNotMatch(clearAll, /WKWebsiteDataTypeCookies|allWebsiteDataTypes/)
  })
})

// Android's WebView writes its cookies to disk about every half a minute. A
// sign-in made just before PeerSky went to the background was lost when
// Android stopped the app for memory, as it does with apps out of sight.
describe('cookies kept when Android stops the app', () => {
  test('are written to disk as PeerSky goes to the background', async () => {
    const app = await read('app/index.tsx')
    assert.match(app, /^import CookieManager from '@preeternal\/react-native-cookie-manager'$/m)
    const listener = /AppState\.addEventListener\('change', \(nextState\) => \{([\s\S]*?)\n {4}\}\)/.exec(app)?.[1] || ''
    assert.match(listener, /if \(Platform\.OS === 'android' && nextState === 'background'\) \{\s*void CookieManager\.flush\(\)\.catch\(/)

    // The library writes Android's own cookie store, the one every tab but
    // the incognito ones uses.
    const module = await read('node_modules/@preeternal/react-native-cookie-manager/android/src/main/java/com/preeternal/reactnativecookiemanager/CookieManagerModule.kt')
    assert.match(module, /override fun flush\(promise: Promise\) \{\s*try \{\s*getCookieManager\(\)\.flush\(\)/)
    assert.match(module, /val cookieManager = CookieManager\.getInstance\(\)/)
  })
})
