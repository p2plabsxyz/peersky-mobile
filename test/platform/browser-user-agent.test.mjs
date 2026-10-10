import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Pages are told this is a browser, as Chrome and Safari tell them, not an
// app with a page inside it. Sites served such apps cut-down pages, asked to
// be opened elsewhere, or refused to sign in.

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8')

test('Android sends Chrome\'s reduced user agent and no WebView brand', async () => {
  const manager = await read('plugins/templates/PeerSkyWebViewManager.kt.template')
  assert.match(manager, /"Mozilla\/5\.0 \(Linux; Android 10; K\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) " \+\s+"Chrome\/\$major\.0\.0\.0\$mobile Safari\/537\.36"/)
  assert.match(manager, /val brands = metadata\.brandVersionList\.filter \{ it\.brand != WEBVIEW_BRAND \}/)
  // Every new WebView, and again whenever desktop view is turned off.
  assert.match(manager, /val wrapper = super\.createViewInstance\(context\)\s+presentAsBrowser\(wrapper\.webView\)/)
  assert.match(manager, /if \(\(value as\? String\)\.isNullOrEmpty\(\)\) presentAsBrowser\(view\.webView\)/)
  const unitTest = await read('plugins/templates/BrowserDownloadsModuleTest.kt.template')
  assert.match(unitTest, /fun presentsTheWebViewAsChrome\(\)/)
})

test('iOS names Safari after the engine, in Safari\'s own words', async () => {
  const manager = await read('plugins/templates/PeerSkyWebViewManager.m.template')
  assert.match(manager, /\[NSString stringWithFormat:@"Version\/%@ Mobile\/15E148 Safari\/604\.1", version\]/)
  assert.match(manager, /\[NSString stringWithFormat:@"Version\/%@ Safari\/605\.1\.15", version\]/)
  assert.match(manager, /configuration\.applicationNameForUserAgent = PeerSkyBrowserApplicationName\(\);/)
})
