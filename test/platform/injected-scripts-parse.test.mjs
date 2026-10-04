import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

import { createBrowserAccessibilityScript } from '../../app/browser-accessibility.mjs'
import { createForceDarkRemovalScript, createForceDarkScript } from '../../app/browser-force-dark.mjs'
import { createBrowserMediaLongPressScript } from '../../app/browser-media.mjs'
import { createBrowserPrintScript } from '../../app/browser-print.mjs'
import { combineBrowserInjectedScripts, createBrowserFaviconScript } from '../../app/bookmarks/browser-favicon.mjs'
import { createHyperBridgeScript } from '../../app/hyper-bridge.mjs'
import { createHyperBridgeSettleScript } from '../../app/hyper-bridge-host.mjs'
import { PEERTUNES_SCAN_BRIDGE_SCRIPT } from '../../app/peertunes/peertunes-screen.mjs'
import { createBrowserContentBlockingScript } from '../../app/privacy/browserContentBlockingScript.mjs'

// Every script below is written as a template literal and handed to a WebView
// as text. One escape too few, a \n meant for the page that became a real line
// break, and the page sees a syntax error. The browser joins its scripts into
// one, so that error took all of them down on every page, and nothing said so.
const TOKEN = 'a'.repeat(32)

const scripts = {
  'hyper bridge': createHyperBridgeScript(TOKEN),
  'hyper bridge reply': createHyperBridgeSettleScript(TOKEN, 1, {
    status: 200,
    body: `line\nbreak${String.fromCharCode(0x2028)}`
  }),
  accessibility: createBrowserAccessibilityScript({
    applyTextScale: true,
    enforceManualPageZoom: true,
    websiteTextScale: 120
  }),
  'accessibility, desktop view': createBrowserAccessibilityScript({
    applyTextScale: false,
    desktopView: true,
    enforceManualPageZoom: false,
    websiteTextScale: 100
  }),
  'content blocking': createBrowserContentBlockingScript({
    bridgeToken: TOKEN,
    enabled: true,
    youtubeAdBlockingEnabled: true
  }),
  'force dark': createForceDarkScript(true),
  'force dark removal': createForceDarkRemovalScript(),
  favicon: createBrowserFaviconScript(),
  'media long press': createBrowserMediaLongPressScript({ token: TOKEN }),
  print: createBrowserPrintScript(TOKEN),
  'PeerTunes bridge': PEERTUNES_SCAN_BRIDGE_SCRIPT
}

for (const [name, script] of Object.entries(scripts)) {
  test(`the ${name} script parses`, () => {
    assert.doesNotThrow(() => new vm.Script(script), name)
  })

  // A \u0000 written once in a template literal is a real NUL in the script.
  // Node reads past it. Android cuts the prop there, so the joined scripts all
  // ended in the middle of a regex and none of them ran in a browser tab.
  test(`the ${name} script carries no raw control characters`, () => {
    const raw = Array.from(script, (character) => character.charCodeAt(0))
      .filter((code) => (code < 32 && ![9, 10, 13].includes(code)) || (code >= 0x7f && code <= 0x9f))
    assert.deepEqual(raw, [], name)
  })
}

test('the scripts the browser injects before a page loads parse as one', () => {
  const combined = combineBrowserInjectedScripts(
    scripts['hyper bridge'],
    scripts.accessibility,
    scripts['content blocking'],
    scripts['media long press']
  )
  assert.doesNotThrow(() => new vm.Script(combined))
})
