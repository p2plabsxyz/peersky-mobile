import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// iOS showed a hyper:// page as about:blank: WebKit renders a page from a
// string only under an address whose scheme it can load, so the app gave it no
// address and only a <base> tag. Scripts that read location, or keep anything
// per site, got about:blank. The browser's WebView now handles hyper://.
test('the iOS browser WebView handles hyper://, answering a page its own address', async () => {
  const manager = await read('plugins/templates/PeerSkyWebViewManager.m.template')
  // Registered once on every browser WebView's configuration.
  assert.match(manager, /if \(!\[configuration urlSchemeHandlerForURLScheme:@"hyper"\]\) \{\s+\[configuration setURLSchemeHandler:PeerSkySharedHyperSchemeHandler\(\) forURLScheme:@"hyper"\];/)
  assert.match(manager, /@interface PeerSkyHyperSchemeHandler : NSObject <WKURLSchemeHandler>/)
  // Only the page itself, for the address it was loaded under, is served:
  // the string the app fetched, nothing read from anywhere else.
  assert.match(manager, /if \(\[request\.URL isEqual:request\.mainDocumentURL\]\) \{/)
  assert.match(manager, /html = \[\(PeerSkyWebViewImpl \*\)view hyperPageForURL:request\.URL\];/)
  assert.match(manager, /id html = self\.source\[@"html"\];\s+id base = self\.source\[@"baseUrl"\];/)
  assert.match(manager, /return \[PeerSkyWithoutFragment\(baseURL\) isEqualToString:PeerSkyWithoutFragment\(url\)\] \? html : nil;/)
  // Anything else is not there, as on Android, and is answered at once.
  assert.match(manager, /statusCode:html \? 200 : 404/)
  assert.match(manager, /\[task didFinish\];/)
})

test('a hyper:// page is shown under its own address on both platforms', async () => {
  const app = await read('app/index.tsx')
  assert.match(app, /baseUrl: entry\.source\.kind === 'hyper' \? entry\.source\.baseUrl : undefined/)
  assert.doesNotMatch(app, /entry\.source\.kind === 'hyper' && Platform\.OS !== 'ios'/)
  // The page's own load is let through, and nothing else changes.
  assert.match(app, /currentUrl: expectedEntry\.source\.kind === 'hyper' \? expectedEntry\.source\.baseUrl : '',\s+navigationType: request\.navigationType,/)
})

// WebKit lists no website data for a scheme it does not know, so a burn could
// not clear what a hyper:// site stored on disk. Its pages keep their storage
// in a store of their own for the run of the app, and a burn lets it go.
test('a hyper:// page keeps its storage apart, in memory, and a burn drops it', async () => {
  const manager = await read('plugins/templates/PeerSkyWebViewManager.m.template')
  assert.match(manager, /RCT_EXPORT_VIEW_PROPERTY\(hyperSession, BOOL\)/)
  assert.match(manager, /if \(!PeerSkyHyperSessionStore\) PeerSkyHyperSessionStore = \[WKWebsiteDataStore nonPersistentDataStore\];/)
  // Incognito wins: an incognito hyper:// tab keeps to the incognito store.
  assert.match(manager, /configuration\.websiteDataStore = PeerSkyIncognitoStoreForSession\(self\.incognitoSession\);\s+\} else if \(self\.hyperSession\) \{\s+configuration\.websiteDataStore = PeerSkyHyperSessionStoreShared\(\);/)
  assert.match(manager, /PeerSkyIncognitoSession = nil;\s+PeerSkyHyperSessionStore = nil;/)

  const app = await read('app/index.tsx')
  assert.match(app, /Platform\.OS === 'ios' && entry\.source\.kind === 'hyper' \? \{ hyperSession: true \} : \{\}/)
})
