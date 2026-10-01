import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import {
  INTERNAL_APPS,
  P2P_APPS,
  getRuntimeAppFromUrl,
  getRuntimeAppLaunchSuffix,
  getRuntimeAppTitle,
  getRuntimeAppUrl
} from '../../app/internal-apps-registry.mjs'
import {
  createPeerTunesPageUrl,
  isPeerTunesPageRequest,
  parsePeerTunesScanRequest,
  serializeScanResult
} from '../../app/peertunes/peertunes-screen.mjs'
import { buildPeerChatInviteUrl, parsePeerChatInvite } from '../../app/peerchat/peerchat-invite.mjs'

describe('internal app registry', () => {
  test('registers PeerTunes as a p2p app route', () => {
    const app = INTERNAL_APPS.find((item) => item.id === 'peertunes')

    assert.deepEqual(app, {
      id: 'peertunes',
      title: 'PeerTunes',
      url: 'peersky://p2p/peertunes/',
      icon: 'PT'
    })
    assert.equal(getRuntimeAppUrl('peertunes'), 'peersky://p2p/peertunes/')
    assert.equal(getRuntimeAppTitle('peertunes'), 'PeerTunes')
    assert.equal(new Set(INTERNAL_APPS.map((item) => item.id)).size, INTERNAL_APPS.length)
  })

  test('matches app urls with or without a trailing slash, query or fragment', () => {
    assert.equal(getRuntimeAppFromUrl('peersky://p2p/peertunes'), 'peertunes')
    assert.equal(getRuntimeAppFromUrl('peersky://p2p/peertunes/'), 'peertunes')
    assert.equal(getRuntimeAppFromUrl('PEERSKY://P2P/PeerTunes/'), 'peertunes')
    assert.equal(getRuntimeAppFromUrl('peersky://p2p/peertunes/#playlist=hyper%3A%2F%2Fabc%2Fmix%2F'), 'peertunes')
    assert.equal(getRuntimeAppFromUrl('peersky://p2p/peertunes/?src=hyper%3A%2F%2Fabc%2F'), 'peertunes')
    assert.equal(getRuntimeAppFromUrl('peersky://p2p/p2pmd/?x=1'), 'p2pmd')
    assert.equal(getRuntimeAppFromUrl('peersky://hyper'), 'hyper')
    assert.equal(getRuntimeAppFromUrl('peersky://p2p/peertunes-extra/'), null)
    assert.equal(getRuntimeAppFromUrl('https://example.com/#peersky://p2p/peertunes/'), null)
  })

  // Holesail is a runtime check for the tunnel P2PMD uses. Nobody opens it on
  // purpose, so peersky://p2p never lists it and a release build does not
  // answer its address at all.
  test('keeps Holesail out of the app list and out of release builds', () => {
    assert.deepEqual(P2P_APPS.map((app) => app.id), ['hyper', 'p2pmd', 'peerchat', 'peertunes'])
    assert.ok(INTERNAL_APPS.some((app) => app.id === 'holesail' && app.devOnly === true))

    assert.equal(getRuntimeAppFromUrl('peersky://holesail/'), null)
    assert.equal(getRuntimeAppFromUrl('peersky://holesail/', { devApps: false }), null)
    assert.equal(getRuntimeAppFromUrl('peersky://holesail/', { devApps: true }), 'holesail')
    // The apps people use answer either way.
    assert.equal(getRuntimeAppFromUrl('peersky://p2p/p2pmd/', { devApps: false }), 'p2pmd')
  })

  test('the p2p page and the home grid draw from the listed apps only', async () => {
    const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    const shell = await readFile(new URL('../../app/internal-apps.ts', import.meta.url), 'utf8')

    assert.match(app, /\{P2P_APPS\.map\(\(app\) => \(/)
    assert.match(app, /const BROWSER_HOME_SHORTCUTS = P2P_APPS/)
    assert.doesNotMatch(app, /INTERNAL_APPS\.map/)
    // Routing follows the build: a debug build still reaches Holesail.
    assert.match(shell, /getRuntimeAppFromRegistryUrl\(targetUrl, \{ devApps: __DEV__ \}\)/)
  })

  test('hands share link payloads to the app and drops anything unsafe', () => {
    assert.equal(getRuntimeAppLaunchSuffix('peersky://p2p/peertunes/#playlist=hyper%3A%2F%2Fabc%2Fmix%2F'), '#playlist=hyper%3A%2F%2Fabc%2Fmix%2F')
    assert.equal(getRuntimeAppLaunchSuffix('peersky://p2p/peertunes/?src=hyper%3A%2F%2Fabc%2F'), '?src=hyper%3A%2F%2Fabc%2F')
    assert.equal(getRuntimeAppLaunchSuffix('peersky://p2p/peertunes/'), '')
    assert.equal(getRuntimeAppLaunchSuffix(''), '')
    assert.equal(getRuntimeAppLaunchSuffix('peersky://p2p/peertunes/#a b'), '')
    assert.equal(getRuntimeAppLaunchSuffix('peersky://p2p/peertunes/#<script>'), '')
    assert.equal(getRuntimeAppLaunchSuffix(`peersky://p2p/peertunes/#${'x'.repeat(5000)}`), '')
  })
})

describe('PeerTunes screen helpers', () => {
  test('builds the page url on the loopback origin with the share payload', () => {
    assert.equal(createPeerTunesPageUrl('http://127.0.0.1:47317'), 'http://127.0.0.1:47317/')
    assert.equal(createPeerTunesPageUrl('http://127.0.0.1:47317/', '#playlist=x'), 'http://127.0.0.1:47317/#playlist=x')
    assert.equal(createPeerTunesPageUrl(null, '#playlist=x'), '')
  })

  test('only lets the app origin navigate inside the WebView', () => {
    const localUrl = 'http://127.0.0.1:47317'

    assert.equal(isPeerTunesPageRequest('http://127.0.0.1:47317/', localUrl), true)
    assert.equal(isPeerTunesPageRequest('http://127.0.0.1:47317/#playlist=x', localUrl), true)
    assert.equal(isPeerTunesPageRequest('about:blank', localUrl), true)
    assert.equal(isPeerTunesPageRequest('http://127.0.0.1:47318/', localUrl), false)
    assert.equal(isPeerTunesPageRequest('https://github.com/p2plabsxyz/peertunes', localUrl), false)
    assert.equal(isPeerTunesPageRequest('http://127.0.0.1:47317.evil.com/', localUrl), false)
    assert.equal(isPeerTunesPageRequest('http://127.0.0.1:47317/', null), false)
  })
})

test('treats a same-origin URL as a PeerTunes page whatever shape it takes', () => {
  const base = 'http://127.0.0.1:47317'

  // A prefix test used to reject these and eject the user out of the app.
  assert.equal(isPeerTunesPageRequest(`${base}?x=1`, base), true)
  assert.equal(isPeerTunesPageRequest(`${base}#frag`, base), true)
  assert.equal(isPeerTunesPageRequest(`${base}/`, base), true)
  assert.equal(isPeerTunesPageRequest('HTTP://127.0.0.1:47317/', base), true)
  assert.equal(isPeerTunesPageRequest('about:blank', base), true)

  // And it must still refuse anything that only looks like the origin.
  assert.equal(isPeerTunesPageRequest('http://127.0.0.1:47317.evil.com/', base), false)
  assert.equal(isPeerTunesPageRequest('http://127.0.0.1:47318/', base), false)
  assert.equal(isPeerTunesPageRequest('https://127.0.0.1:47317/', base), false)
  assert.equal(isPeerTunesPageRequest('https://evil.example/', base), false)
})

test('only accepts scan requests the bridge itself sent', () => {
  const good = JSON.stringify({ type: 'peertunes-scan-qr', requestId: 'scan-123-abc' })
  assert.equal(parsePeerTunesScanRequest(good), 'scan-123-abc')

  // Anything else the page posts must not open the camera.
  assert.equal(parsePeerTunesScanRequest(JSON.stringify({ type: 'other', requestId: 'scan-1' })), null)
  assert.equal(parsePeerTunesScanRequest(JSON.stringify({ type: 'peertunes-scan-qr' })), null)
  assert.equal(parsePeerTunesScanRequest(JSON.stringify({ type: 'peertunes-scan-qr', requestId: 'x'.repeat(200) })), null)
  assert.equal(parsePeerTunesScanRequest('not json'), null)
  assert.equal(parsePeerTunesScanRequest(''), null)
})

test('escapes scanned text before it goes back into the page', () => {
  // Whatever was on the QR code is injected as a JavaScript literal, so it has
  // to survive quotes and the two separators that are legal JSON but not legal
  // inside a JavaScript string.
  assert.equal(serializeScanResult('hyper://abc/Classic/'), '"hyper://abc/Classic/"')
  assert.equal(serializeScanResult(null), 'null')
  assert.equal(serializeScanResult('a"b'), '"a\\"b"')
  assert.equal(serializeScanResult('a\u2028b'), '"a\\u2028b"')
  assert.equal(serializeScanResult('a\u2029b'), '"a\\u2029b"')
})

test('round-trips PeerChat invite links and refuses anything else', () => {
  const key = 'a1b2c3d4'.repeat(8)
  const link = buildPeerChatInviteUrl(key)

  assert.equal(link, `peersky://p2p/peerchat/#room=${key}`)
  assert.equal(parsePeerChatInvite(link), key)

  // A scanned QR may hold the bare key rather than a link, and case varies.
  assert.equal(parsePeerChatInvite(key.toUpperCase()), key)
  assert.equal(parsePeerChatInvite(`#room=${key.toUpperCase()}`), key)

  // The browser shell hands PeerChat the fragment as a launch suffix.
  assert.equal(getRuntimeAppFromUrl(link), 'peerchat')
  assert.equal(parsePeerChatInvite(getRuntimeAppLaunchSuffix(link)), key)

  for (const bad of ['', 'peersky://p2p/peerchat/', 'peersky://p2p/peerchat/#room=nope', 'https://evil.example/#room=' + key.slice(0, 63), 'not a link']) {
    assert.equal(parsePeerChatInvite(bad), '', `${bad} should not parse`)
  }
  assert.equal(buildPeerChatInviteUrl('short'), '')
})

test('a link tapped inside a built-in app opens beside it, not over it', async () => {
  const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  const helper = app.slice(
    app.indexOf('function openBrowserUrlInNewTab'),
    app.indexOf('function onBrowserNewTab')
  )

  // Falls back to the current tab only when there is no room for another one,
  // so the link still opens rather than silently doing nothing.
  assert.match(helper, /createBrowserTab\(targetUrl\)/)
  assert.match(helper, /loadBrowserUrl\(targetUrl\)/)

  // PeerChat and PeerTunes both lose their state if the tab is taken over.
  const peerChat = app.slice(app.indexOf('<PeerChatScreen'), app.indexOf('requestedRoomKey='))
  assert.match(peerChat, /onOpenUrl=\{\(targetUrl\) => openBrowserUrlInNewTab\(targetUrl\)\}/)
  const peerTunes = app.slice(app.indexOf('<PeerTunesScreen'), app.indexOf('onStatus={setStatus}', app.indexOf('<PeerTunesScreen')))
  assert.match(peerTunes, /onOpenUrl=\{\(targetUrl\) => openBrowserUrlInNewTab\(targetUrl\)\}/)
})

test('a room is shared as an invite link, and a direct message has nothing to share', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  const start = screen.indexOf('async function shareRoom ()')
  const share = screen.slice(start, screen.indexOf('\n  }', start))

  // The bare key has to be pasted into Join Room by hand; the link just joins.
  assert.match(share, /buildPeerChatInviteUrl\(activeRoom[.]roomKey\)/)

  // There is nobody to invite into a one-to-one chat. The button becomes a
  // spacer rather than simply going: the title is centred between the two
  // action groups, and removing one shifted the name off centre. The spacer
  // comes first so search keeps the corner the share button had.
  assert.match(screen, /\{activeRoom[.]isDM && <View style=\{styles[.]headerAction\} \/>\}\s*\n\s*<Pressable[\s\S]{0,200}Find messages/)
  assert.match(screen, /\{!activeRoom[.]isDM && \(\s*<Pressable[\s\S]{0,300}Share room/)
})

test('creating or joining a room closes the panel behind it', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  for (const [name, next] of [
    ['function createRoom ()', 'async function joinRoomByKey'],
    ['async function joinRoomByKey', 'function isMemberBlocked'],
    ['function joinRoom ()', 'function showRoomActions']
  ]) {
    const body = screen.slice(screen.indexOf(name), screen.indexOf(next))
    assert.match(body, /setLandingAction\(null\)/, `${name} leaves the panel open`)
  }
})

// Tapping an invite before setting a name threw the request away: the effect
// cleared it and then failed the join, so the link did nothing once the welcome
// screen was finally done with.
test('an invite tapped without a username waits for the welcome screen', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  const effect = screen.slice(
    screen.indexOf('if (!requestedRoomKey || !isInitialized'),
    screen.indexOf('void joinRoomByKey(requestedRoomKey)')
  )

  assert.match(effect, /!profile\?\.username\) return/)
  // And it runs again once the name is set, or it would wait forever.
  assert.match(screen, /\[isInitialized, onRequestedRoomHandled, profile\?\.username, requestedRoomKey, rooms\]/)

  // The request is only cleared once it is actually being acted on.
  const clear = screen.indexOf('onRequestedRoomHandled()')
  const guard = screen.indexOf('!profile?.username) return')
  assert.ok(guard > -1 && clear > guard)
})
