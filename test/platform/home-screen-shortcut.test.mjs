import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Android puts a page on the home screen as a shortcut that opens it in
// PeerSky. iOS lets only Safari do that, so the menu there has no such item.

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8')

test('the menu offers it on Android, for websites and hyper:// sites, never in incognito', async () => {
  const app = await read('app/index.tsx')
  assert.match(app, /homeScreenActionAvailable=\{\s+Platform\.OS === 'android' &&\s+canUseReaderView\(browserCurrentUrl\) &&\s+!browserTabsState\.tabs\.some\(\(tab\) => tab\.id === browserTabsState\.activeTabId && tab\.incognito === true\)/)
  assert.match(app, /homeScreen\.addPage\(browserCurrentUrl, browserTitle, icon\)/)
  const menu = await read('app/settings/BrowserOverflowMenu.tsx')
  assert.match(menu, /label='Add to Home Screen'/)
})

test('the launcher is asked for a shortcut that opens the page as a link would', async () => {
  const module = await read('plugins/templates/PeerSkyHomeScreenModule.kt.template')
  assert.match(module, /ShortcutManagerCompat\.requestPinShortcut\(reactContext, shortcut, null\)/)
  assert.match(module, /Intent\(Intent\.ACTION_VIEW, Uri\.parse\(page\), reactContext, MainActivity::class\.java\)/)
  assert.match(module, /IconCompat\.createWithAdaptiveBitmap\(icon\)/)
  const pkg = await read('plugins/templates/BrowserContentBlockingPackage.kt.template')
  assert.match(pkg, /PeerSkyHomeScreenModule\(reactContext\)/)
  const plugin = await read('plugins/with-browser-downloads.js')
  assert.match(plugin, /'PeerSkyHomeScreenModule\.kt',\s+readAndroidTemplate\('PeerSkyHomeScreenModule\.kt\.template', packageName\)/)
  assert.match(plugin, /'PeerSkyHomeScreenModuleTest\.kt',/)
})
