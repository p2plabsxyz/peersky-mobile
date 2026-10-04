import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// WebKit hands an address an app claims to that app on any load it allows, so
// a GitHub link that opened a new tab opened the GitHub app and the tab both.
test('only a tapped link opens an app, and its new tab opens only when no app took it', async () => {
  const manager = await readFile(new URL('../../plugins/templates/PeerSkyWebViewManager.m.template', import.meta.url), 'utf8')
  assert.match(manager, /BOOL tapped = navigationAction\.navigationType == WKNavigationTypeLinkActivated;/)
  assert.match(manager, /if \(tapped && https && navigationAction\.targetFrame == nil\) \{/)
  assert.match(manager, /options:@\{ UIApplicationOpenURLOptionUniversalLinksOnly: @YES \}/)
  assert.match(manager, /if \(opened \|\| !strongSelf\) \{\s+decisionHandler\(WKNavigationActionPolicyCancel\);/)
  // Anything else, a tab opened, restored or typed, loads here without
  // trying an app first.
  assert.match(manager, /decisionHandler\(policy == WKNavigationActionPolicyAllow && !tapped \? PeerSkyAllowWithoutOpeningApp : policy\);/)
  assert.match(manager, /PeerSkyAllowWithoutOpeningApp = \(WKNavigationActionPolicy\)\(WKNavigationActionPolicyAllow \+ 2\);/)
})
