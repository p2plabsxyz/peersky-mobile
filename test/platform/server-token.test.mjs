import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { createResetIdScript, createServerTokenScript } from '../../app/server-token.mjs'
import { isPeerTunesDataRequest } from '../../app/peertunes/peertunes-screen.mjs'
import { createLoopbackToken } from '../../backend/loopback-request.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// PeerTunes' server and an open P2PMD note answer only requests with their
// run's token. Any app on the phone can fetch their pages, so the token is in
// none of them: the app hands it to its own WebView before the page loads.

test('the page is handed its token, and nothing that is not one', () => {
  const token = createLoopbackToken()
  const window = {}
  vm.runInNewContext(createServerTokenScript(token), { window })
  assert.equal(window.peerskyServerToken, token)

  for (const value of [null, undefined, '', token.toUpperCase(), token.slice(1), `${token}"; alert(1); "`, `</script>${token}`]) {
    const page = {}
    vm.runInNewContext(createServerTokenScript(value), { window: page })
    assert.equal(page.peerskyServerToken, '', String(value))
  }
})

test('PeerTunes waits for its token, hands it over first, and loads again with a new one', async () => {
  const screen = await read('app/peertunes/PeerTunesScreen.tsx')
  assert.match(screen, /if \(!localUrl \|\| !serverToken\) \{\s*return \(\s*<AppLoading/)
  assert.match(screen, /injectedJavaScriptBeforeContentLoaded=\{`\$\{createServerTokenScript\(serverToken\)\}\\n\$\{createResetIdScript\(resetId\)\}\\n\$\{PEERTUNES_BEFORE_LOAD_SCRIPT\}`\}/)
  assert.match(screen, /if \(tokenRun\.token !== serverToken\) setTokenRun\(\{ token: serverToken, run: tokenRun\.run \+ 1 \}\)/)
  assert.match(screen, /key=\{`\$\{pageUrl\}:\$\{reloadNonce\}:\$\{tokenRun\.run\}`\}/)

  const app = await read('app/index.tsx')
  assert.match(app, /if \(!response\.ok \|\| !response\.localUrl \|\| !response\.token\) \{/)
  assert.match(app, /setPeertunesToken\(response\.token\)/)
  assert.match(app, /serverToken=\{peertunesToken\}/)
})

// The drive reads carry the token in their address. Loaded as a page, one
// could end up in a download with it, so PeerTunes never loads one or hands
// one to a tab.
test('PeerTunes never opens the server\'s drive reads as a page', async () => {
  const localUrl = 'http://127.0.0.1:47317'
  assert.equal(isPeerTunesDataRequest(`${localUrl}/hyper/asset?url=x&token=y`, localUrl), true)
  assert.equal(isPeerTunesDataRequest(`${localUrl}/hyper/keep?url=x`, localUrl), true)
  assert.equal(isPeerTunesDataRequest(`${localUrl}/x/../hyper/asset`, localUrl), true)
  assert.equal(isPeerTunesDataRequest(`${localUrl}/`, localUrl), false)
  assert.equal(isPeerTunesDataRequest(`${localUrl}/#playlist=hyper%3A%2F%2Fabc%2F`, localUrl), false)
  assert.equal(isPeerTunesDataRequest('about:blank', localUrl), false)
  assert.equal(isPeerTunesDataRequest('https://example.com/hyper/asset', localUrl), false)

  const screen = await read('app/peertunes/PeerTunesScreen.tsx')
  assert.match(screen, /onShouldStartLoadWithRequest=\{\(request\) => \{\s*if \(isPeerTunesDataRequest\(request\.url, localUrl\)\) return false/)
  assert.match(screen, /onOpenWindow=\{\(event\) => \{\s*if \(isPeerTunesDataRequest\(event\.nativeEvent\.targetUrl, localUrl\)\) return/)
})

test('the P2PMD editor gets its room\'s token, and loads again with a new one', async () => {
  const app = await read('app/index.tsx')
  assert.match(app, /injectedJavaScriptBeforeContentLoaded=\{`\$\{createServerTokenScript\(p2pmdRoom\.token\)\}\\n\$\{p2pmdThemeScript\(browserIsDark\)\}`\}/)
  // The nonce is in the editor's address, which keys its WebView.
  assert.match(app, /\[p2pmdRoom\?\.key, p2pmdRoom\?\.role, p2pmdUrl, p2pmdRoom\?\.token\]/)
  assert.match(app, /key=\{`\$\{p2pmdEditorBaseUrl\}:/)

  const room = await read('backend/p2pmd/room.mjs')
  // Hosting: the tunnel puts the server's token on what comes in through it.
  assert.match(room, /startHolesailLive\(\{[^}]*token: serverResult\.token\s*\}\)/)
  // Joining: a token of its own for the local port, and the ready check uses it.
  assert.match(room, /const token = createLoopbackToken\(\)\s+const holesailResult = await connectOnNotePort\(\{ key, udp, log, token \}\)/)
  assert.match(room, /path: `\/status\?token=\$\{token\}`/)
  // Either way the room the app gets back has the token for its editor.
  assert.match(room, /role: 'host',[\s\S]*?\n\s+token: serverResult\.token\n\s+\}/)
  assert.match(room, /role: 'client',[\s\S]*?\n\s+token\n\s+\}/)
})

// PeerTunes keeps its songs in the page's own storage, out of reach of Clear
// all P2P data, so it is told the device's reset id and empties its library
// when the id is a new one (p2p-reset.mjs).
test('PeerTunes is handed the reset id, and nothing that is not one', async () => {
  const id = 'ab'.repeat(16)
  const page = {}
  vm.runInNewContext(createResetIdScript(id), { window: page })
  assert.equal(page.peerskyResetId, id)
  for (const value of [null, undefined, '', id.toUpperCase(), id.slice(1), `${id}"; alert(1); "`]) {
    const other = {}
    vm.runInNewContext(createResetIdScript(value), { window: other })
    assert.equal(other.peerskyResetId, '', String(value))
  }

  const app = await read('app/index.tsx')
  assert.match(app, /setPeertunesResetId\(typeof response\.resetId === 'string' \? response\.resetId : ''\)/)
  assert.match(app, /resetId=\{peertunesResetId\}/)
  const router = await read('backend/rpc/router.mjs')
  assert.match(router, /resetId: readP2pResetId\(getDefaultIdentityStoragePath\(\)\)/)
})
