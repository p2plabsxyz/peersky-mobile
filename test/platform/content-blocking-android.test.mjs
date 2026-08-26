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
    assert.match(moduleSource, /catch \(error: RejectedExecutionException\)/)
    assert.match(moduleSource, /pendingLoads[.]toList\(\)[.]also \{ pendingLoads[.]clear\(\) \}/)
    assert.match(moduleSource, /ERR_FILTER_LOAD_CANCELLED/)
    assert.match(moduleSource, /setYoutubeAdBlockingEnabled/)
    assert.match(moduleSource, /if \(removePendingLoad\(promise\)\) promise[.]resolve\(true\)/)
    assert.match(engineSource, /System[.]loadLibrary\("peersky_adblock"\)/)
    assert.match(engineSource, /checkNotNull\(nativeLoadLists\(easyListPath, easyPrivacyPath\)\)/)
    assert.match(engineSource, /\): String[?]/)
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
    assert.match(clientSource, /object PeerSkyYoutubeAdBlocker/)
    assert.doesNotMatch(clientSource, /!enabled \|\| !PeerSkyAdBlockEngine[.]enabled/)
    assert.match(clientSource, /isYoutubeAdBreakRequest/)
    assert.match(clientSource, /requestPath == "\/youtubei\/v1\/player\/ad_break"/)
    assert.match(clientSource, /host == "youtube[.]com"/)
    assert.match(clientSource, /host == "youtube-nocookie[.]com"/)
    assert.match(clientSource, /MAX_FILTER_URL_LENGTH = 16 [*] 1024/)
    assert.match(clientSource, /if \(shouldBlock\(request\)\) return blockedResponse\(\)/)
    assert.match(clientSource, /class PeerSkyContentBlockerBridge/)
    assert.match(clientSource, /@JavascriptInterface/)
    assert.match(clientSource, /if \(!isAuthorizedToken\(expectedToken[.]get\(\), token\)\) return false/)
    assert.match(clientSource, /"xhr", "xmlhttprequest", "fetch" -> "xhr"/)
    assert.match(clientSource, /204/)
    assert.match(clientSource, /No Content/)
    assert.match(clientSource, /ByteArrayInputStream\(ByteArray\(0\)\)/)
    assert.match(managerSource, /addJavascriptInterface\(/)
    assert.match(managerSource, /PeerSkyContentBlocker/)
    assert.match(managerSource, /@ReactProp\(name = "contentBlockingToken"\)/)
    assert.match(managerSource, /setToken\(token[?][.]takeIf\(::isValidToken\)\)/)
    assert.match(
      managerSource,
      /super[.]addEventEmitters\(context, view\)[\s\S]*webViewClient = PeerSkyWebViewClient\(\)/
    )
  })

  test('generates behavioral coverage for remote and loopback URL classification', () => {
    const testSource = plugin.createWebViewClientTest('xyz.test.browser')

    assert.match(testSource, /assertTrue\(isRemoteHttpUrl\("https", "example[.]com"\)\)/)
    assert.match(testSource, /assertFalse\(isRemoteHttpUrl\("https", "localhost"\)\)/)
    assert.match(testSource, /assertFalse\(isRemoteHttpUrl\("https", "127[.]0[.]0[.]1"\)\)/)
    assert.match(testSource, /assertFalse\(isRemoteHttpUrl\("https", "10[.]0[.]2[.]2"\)\)/)
    assert.match(testSource, /assertFalse\(isRemoteHttpUrl\("https", "::1"\)\)/)
    assert.match(testSource, /identifiesOnlyThePinnedYoutubeAdBreakRequest/)
    assert.match(testSource, /"www[.]youtube-nocookie[.]com"/)
    assert.match(testSource, /"youtube[.]com[.]evil[.]test"/)
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

  test('pins Rust and prepares only EAS Android builds', () => {
    const toolchain = readFileSync(
      new URL('../../rust-toolchain.toml', import.meta.url),
      'utf8'
    )
    const setup = readFileSync(
      new URL('../../scripts/setup-content-blocking.mjs', import.meta.url),
      'utf8'
    )
    const packageJson = JSON.parse(readFileSync(
      new URL('../../package.json', import.meta.url),
      'utf8'
    ))

    assert.match(toolchain, /channel = "1[.]88[.]0"/)
    assert.match(toolchain, /aarch64-linux-android/)
    assert.match(toolchain, /x86_64-linux-android/)
    assert.match(setup, /EAS_BUILD_PLATFORM !== 'android'/)
    assert.equal(
      packageJson.scripts['eas-build-pre-install'],
      'node scripts/setup-content-blocking.mjs --eas && node scripts/update-content-blocking-snapshot.mjs'
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
    assert.match(initializer, /if \(ready\) notifyReadyListeners\(\)/)
    assert.match(initializer, /initializeContentBlockingRuntime/)
    assert.match(initializer, /loadActiveState: loadFilterListState/)
    assert.match(initializer, /updateState: updateFilterLists/)
    assert.match(initializer, /activateState: activateFilterListState/)
    assert.match(initializer, /discardState: discardFilterListState/)
    assert.match(appSource, /!contentBlockingReady/)
    assert.match(appSource, /onReady: \(\) =>/)
    assert.match(appSource, /Browsing without ad and tracker protection/)
    assert.doesNotMatch(appSource, /setContentBlockingAttempt/)
    assert.match(appSource, /for \(const webView of browserWebViewRefs[.]current[.]values\(\)\)/)
    assert.match(appSource, /if \(!protectionEnabled\) \{\s+applyContentBlockingEnabled\(false\)\s+setContentBlockingReady\(true\)\s+return/)
    assert.match(appSource, /const rulesReady = applyContentBlockingEnabled\(true\)/)
    assert.match(appSource, /if \(!rulesReady\) \{\s+const initialized = await initializeContentBlocking\(\{ enabled: true \}\)/)
    assert.match(appSource, /setContentBlockingPreference\(true\)/)
  })

  test('injects native-backed fetch and XHR cancellation on Android', () => {
    const scriptSource = readFileSync(
      new URL('../../app/privacy/browserContentBlockingScript.mjs', import.meta.url),
      'utf8'
    )
    const appSource = readFileSync(
      new URL('../../app/index.tsx', import.meta.url),
      'utf8'
    )

    assert.match(scriptSource, /window[.]PeerSkyContentBlocker/)
    assert.match(scriptSource, /bridge[.]shouldBlock\([^,]+, requestUrl, documentUrl, 'xhr', method\)/)
    assert.match(scriptSource, /YOUTUBE_AD_BREAK_PATH/)
    assert.match(scriptSource, /Promise[.]reject\(new TypeError\('Failed to fetch'\)\)/)
    assert.match(scriptSource, /XMLHttpRequest[.]prototype[.]send/)
    assert.match(scriptSource, /dispatchEvent\(new ProgressEvent\('error'\)\)/)
    assert.match(scriptSource, /MAX_BROWSER_URL_LENGTH/)
    assert.match(appSource, /createBrowserContentBlockingScript/)
    assert.match(appSource, /contentBlockingToken: browserPreferences[.]contentBlockingEnabled/)
    assert.match(appSource, /injectedJavaScriptBeforeContentLoaded=\{browserBeforeContentScript\}/)
  })
})
