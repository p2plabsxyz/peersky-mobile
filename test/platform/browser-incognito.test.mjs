import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createRequire } from 'node:module'

import {
  addBackgroundBrowserTabState,
  addBrowserTabState,
  createBrowserTabsState,
  restoreBrowserTabsState,
  serializeBrowserTabsState
} from '../../app/browser-tabs.mjs'

const require = createRequire(import.meta.url)
const downloadsPlugin = require('../../plugins/with-browser-downloads')
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('an incognito tab is never written into the saved session', () => {
  let state = createBrowserTabsState()
  state = addBrowserTabState(state, { incognito: true })
  assert.equal(state.tabs.at(-1).incognito, true)
  assert.equal(state.tabs[0].incognito, undefined)

  const saved = JSON.parse(serializeBrowserTabsState(state))
  assert.deepEqual(saved.tabs.map((tab) => tab.id), ['tab-1'])
  // The incognito tab was the active one, so the saved session opens on
  // the tab that is left.
  assert.equal(saved.activeTabId, 'tab-1')
  assert.equal(restoreBrowserTabsState(saved).tabs.some((tab) => tab.incognito), false)
})

test('with only incognito tabs open, a fresh tab is saved instead', () => {
  let state = { ...createBrowserTabsState(), tabs: [] }
  state = addBrowserTabState(state, { incognito: true })
  const saved = JSON.parse(serializeBrowserTabsState(state))
  assert.equal(saved.tabs.length, 1)
  assert.notEqual(saved.tabs[0].id, state.tabs[0].id)
  assert.equal(saved.activeTabId, saved.tabs[0].id)
})

test('a link opened from an incognito tab stays incognito', async () => {
  const state = addBackgroundBrowserTabState(createBrowserTabsState(), 'https://example.com/', 'Example', { incognito: true })
  assert.equal(state.tabs.at(-1).incognito, true)

  const app = await read('app/index.tsx')
  assert.match(app, /createBrowserTab\(action\.url, \{ incognito: isIncognitoTab\(tabId\) \}\)/)
  assert.match(app, /createBrowserTab\(targetUrl, \{ incognito: isIncognitoTab\(browserTabsStateRef\.current\.activeTabId\) \}\)/)
})

test('an incognito tab keeps no history, no preview and no cache', async () => {
  const app = await read('app/index.tsx')
  const record = app.slice(app.indexOf('function recordCompletedBrowserVisit'), app.indexOf('function onBrowserToggleTabView'))
  assert.match(record, /if \(isIncognitoTab\(tabId\)\) return/)
  assert.match(app, /\/\/ No picture of an incognito page is ever written to disk\.\s+if \(tab\?\.incognito\) return false/)
  assert.match(app, /cacheEnabled=\{!tabIncognito\}/)
  assert.match(app, /incognito=\{Platform\.OS === 'ios' && tabIncognito\}/)
  assert.match(app, /Platform\.OS === 'android' && tabIncognito \? \{ privateProfile: true \} : \{\}/)

  const menu = await read('app/settings/BrowserOverflowMenu.tsx')
  assert.match(menu, /label='New Incognito Tab'/)
  assert.match(menu, /<IncognitoIcon/)
})

// Android WebViews share one cookie jar. react-native-webview's own incognito
// prop clears every cookie in it, which would sign people out of every normal
// tab, so an incognito tab gets a WebView profile of its own instead.
test('Android gives incognito tabs their own WebView profile', async () => {
  const manager = downloadsPlugin.createWebViewManager('xyz.test.browser')
  assert.match(manager, /propName == "privateProfile"/)
  assert.match(manager, /WebViewFeature\.isFeatureSupported\(WebViewFeature\.MULTI_PROFILE\)/)
  assert.match(manager, /WebViewCompat\.setProfile\(webView, PRIVATE_PROFILE\)/)
  assert.match(manager, /store\.deleteProfile\(PRIVATE_PROFILE\)/)

  const app = await read('app/index.tsx')
  assert.doesNotMatch(app, /incognito=\{tabIncognito\}/)
  const plugin = await read('plugins/with-browser-downloads.js')
  assert.match(plugin, /androidx\.webkit:webkit:1\.14\.0/)
})
