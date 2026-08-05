import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, test } from 'node:test'

const require = createRequire(import.meta.url)
const plugin = require('../../plugins/with-browser-downloads')

describe('Android content blocking', () => {
  test('registers the native module and preserves the custom WebView manager', () => {
    const application = 'PackageList(this).packages.apply {\n        }'
    const registered = plugin.addPackageRegistration(application)

    assert.match(registered, /add\(BrowserContentBlockingPackage\(\)\)/)
    assert.match(registered, /add\(BrowserDownloadsPackage\(\)\)/)
    assert.equal(plugin.addPackageRegistration(registered), registered)
  })

  test('generates bounded native list loading from tracked templates', () => {
    const moduleSource = plugin.createContentBlockingModule('xyz.test.browser')
    const engineSource = plugin.createAdBlockEngine('xyz.test.browser')

    assert.match(moduleSource, /^package xyz[.]test[.]browser/m)
    assert.match(moduleSource, /FILTER_DIRECTORY = "content-blocking"/)
    assert.match(moduleSource, /candidate[.]path[.]startsWith\(allowedPrefix\)/)
    assert.match(moduleSource, /Executors[.]newSingleThreadExecutor\(\)/)
    assert.match(engineSource, /System[.]loadLibrary\("peersky_adblock"\)/)
    assert.match(engineSource, /if \(!enabled \|\| !nativeAvailable \|\| !listsLoaded\) return false/)
  })

  test('intercepts only remote HTTP subresources through the native engine', () => {
    const clientSource = plugin.createWebViewClient('xyz.test.browser')
    const managerSource = plugin.createWebViewManager('xyz.test.browser')

    assert.match(clientSource, /class PeerSkyWebViewClient : RNCWebViewClient\(\)/)
    assert.match(clientSource, /if \(request[.]isForMainFrame\) return false/)
    assert.match(clientSource, /internal fun isRemoteHttpUrl/)
    assert.match(clientSource, /"10[.]0[.]2[.]2"/)
    assert.match(clientSource, /isRemoteHttpUrl\(Uri[.]parse\(pageUrl\)\)/)
    assert.match(clientSource, /PeerSkyAdBlockEngine[.]shouldBlock/)
    assert.match(clientSource, /MAX_FILTER_URL_LENGTH = 16 [*] 1024/)
    assert.match(clientSource, /WebResourceResponse\(/)
    assert.match(managerSource, /webViewClient = PeerSkyWebViewClient\(\)/)
  })

  test('generates behavioral coverage for remote and loopback URL classification', () => {
    const testSource = plugin.createWebViewClientTest('xyz.test.browser')

    assert.match(testSource, /assertTrue\(isRemoteHttpUrl\("https", "example[.]com"\)\)/)
    assert.match(testSource, /assertFalse\(isRemoteHttpUrl\("https", "localhost"\)\)/)
    assert.match(testSource, /assertFalse\(isRemoteHttpUrl\("https", "127[.]0[.]0[.]1"\)\)/)
    assert.match(testSource, /assertFalse\(isRemoteHttpUrl\("https", "10[.]0[.]2[.]2"\)\)/)
    assert.match(testSource, /assertFalse\(isRemoteHttpUrl\("https", "::1"\)\)/)
  })

  test('generates an incremental, reproducible Rust Android build', () => {
    const configured = plugin.addContentBlockingBuild('android {\n}\n')
    const reconfigured = plugin.addContentBlockingBuild(configured)
    const manifest = readFileSync(
      new URL('../../plugins/templates/content-blocker.Cargo.toml.template', import.meta.url),
      'utf8'
    )

    assert.equal(reconfigured, configured)
    assert.match(configured, /exclude 'target[/][*][*]'/)
    assert.match(configured, /outputs[.]files\(peerSkyAdblockLibraries\)/)
    assert.match(configured, /build', '--release', '--locked'/)
    assert.match(configured, /peerSkyCargoHome[.]exists\(\)/)
    assert.match(manifest, /adblock = \{ version = "=0[.]13[.]2"/)
    assert.match(
      readFileSync(new URL('../../plugins/templates/content-blocker.lib.rs.template', import.meta.url), 'utf8'),
      /http:\/\/ads[.]example\/banner[.]js/
    )
  })

  test('wires the single-flight initializer to the runtime coordinator', () => {
    const initializer = readFileSync(
      new URL('../../app/privacy/contentBlocking.ts', import.meta.url),
      'utf8'
    )
    const appSource = readFileSync(
      new URL('../../app/index.tsx', import.meta.url),
      'utf8'
    )

    assert.match(initializer, /createForcedUpdateCoordinator/)
    assert.match(initializer, /rulesReady && desiredEnabled/)
    assert.match(initializer, /initializeContentBlockingRuntime/)
    assert.match(initializer, /loadActiveState: loadFilterListState/)
    assert.match(initializer, /updateState: updateFilterLists/)
    assert.match(initializer, /activateState: activateFilterListState/)
    assert.match(initializer, /discardState: discardFilterListState/)
    assert.match(appSource, /!contentBlockingReady/)
    assert.match(appSource, /setContentBlockingAttempt/)
    assert.match(appSource, /for \(const webView of browserWebViewRefs[.]current[.]values\(\)\)/)
    assert.match(appSource, /await initializeContentBlocking\(\{ enabled: true \}\)/)
    assert.match(appSource, /setContentBlockingPreference\(true\)/)
  })
})
