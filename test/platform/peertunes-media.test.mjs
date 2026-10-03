import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

import {
  PEERTUNES_MEDIA_BRIDGE_SCRIPT,
  createPeerTunesMediaCommandScript,
  parsePeerTunesNowPlaying
} from '../../app/peertunes/peertunes-screen.mjs'
import { PAUSE_ALL_MEDIA_SCRIPT } from '../../app/browser-media.mjs'
import { isAppInBrowserTabs } from '../../app/browser-tabs.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// Enough of a page to run the bridge in: one audio element and a WebView
// bridge that records what the page says.
function createPage ({ mediaSession = true } = {}) {
  const posted = []
  const listeners = {}
  const audio = { paused: true, ended: false, currentSrc: 'blob:song', pause () { this.paused = true }, play () { this.paused = false; return Promise.resolve() } }
  class MediaMetadata {
    constructor (init = {}) { Object.assign(this, init) }
  }
  const session = mediaSession
    ? Object.create({
      setActionHandler () {},
      get metadata () { return this._metadata || null },
      set metadata (value) { this._metadata = value }
    })
    : undefined
  const navigator = mediaSession ? { mediaSession: session } : {}
  const window = {
    ReactNativeWebView: { postMessage: (message) => posted.push(JSON.parse(message)) },
    MediaMetadata: mediaSession ? MediaMetadata : undefined
  }
  const document = {
    addEventListener: (name, listener) => { (listeners[name] ||= []).push(listener) },
    querySelectorAll: () => [audio]
  }
  const context = vm.createContext({ window, navigator, document, setTimeout: (fn) => fn(), Object, JSON, String })
  vm.runInContext(PEERTUNES_MEDIA_BRIDGE_SCRIPT, context)
  const fire = (name) => (listeners[name] || []).forEach((listener) => listener())
  return { audio, context, fire, navigator, posted, window }
}

// A WebView never hands its audio to Android, so a play or pause from earbuds
// had nowhere to go. The page's own Media Session handlers take the buttons.
test('a button press reaches the handler the page set', () => {
  const page = createPage()
  const pressed = []
  page.navigator.mediaSession.setActionHandler('pause', () => pressed.push('pause'))
  page.navigator.mediaSession.setActionHandler('nexttrack', () => pressed.push('next'))

  vm.runInContext(createPeerTunesMediaCommandScript('pause'), page.context)
  vm.runInContext(createPeerTunesMediaCommandScript('nexttrack'), page.context)
  assert.deepEqual(pressed, ['pause', 'next'])
})

test('without a handler the buttons still play and pause the page', () => {
  const page = createPage()
  vm.runInContext(createPeerTunesMediaCommandScript('play'), page.context)
  assert.equal(page.audio.paused, false)
  vm.runInContext(createPeerTunesMediaCommandScript('pause'), page.context)
  assert.equal(page.audio.paused, true)
})

test('the page says what is playing, once per change', () => {
  const page = createPage()
  page.audio.paused = false
  page.navigator.mediaSession.metadata = new page.window.MediaMetadata({ title: 'Song', artist: 'Band' })
  page.fire('play')
  page.fire('playing')
  assert.deepEqual(page.posted, [{ type: 'peertunes-now-playing', playing: true, title: 'Song', artist: 'Band' }])

  page.audio.paused = true
  page.fire('pause')
  assert.equal(page.posted.at(-1).playing, false)
})

test('a WebView without Media Session gets enough of one for the page', () => {
  const page = createPage({ mediaSession: false })
  const pressed = []
  page.navigator.mediaSession.setActionHandler('pause', () => pressed.push('pause'))
  page.navigator.mediaSession.metadata = new page.window.MediaMetadata({ title: 'Song' })
  vm.runInContext(createPeerTunesMediaCommandScript('pause'), page.context)
  assert.deepEqual(pressed, ['pause'])
  assert.equal(page.posted.at(-1).title, 'Song')
})

test('only the four buttons become scripts, and the text is cleaned', () => {
  assert.equal(createPeerTunesMediaCommandScript('stop'), null)
  assert.equal(createPeerTunesMediaCommandScript('");alert(1);("'), null)
  assert.deepEqual(
    parsePeerTunesNowPlaying(JSON.stringify({ type: 'peertunes-now-playing', playing: 'yes', title: 'A\u0000B', artist: 'x'.repeat(500) })),
    { playing: false, title: 'AB', artist: 'x'.repeat(200) }
  )
  assert.equal(parsePeerTunesNowPlaying('{"type":"peertunes-haptic"}'), null)
  assert.equal(parsePeerTunesNowPlaying('not json'), null)
})

test('the Android media session sends the buttons back as commands', async () => {
  const module = await read('plugins/templates/PeerSkyAudioRouteModule.kt.template')
  for (const [callback, command] of [['onPlay', 'play'], ['onPause', 'pause'], ['onStop', 'pause'], ['onSkipToNext', 'nexttrack'], ['onSkipToPrevious', 'previoustrack']]) {
    assert.match(module, new RegExp(`override fun ${callback}\\(\\) = command\\("${command}"\\)`))
  }
  assert.match(module, /PlaybackState\.ACTION_PLAY_PAUSE/)
  assert.match(module, /session\.isActive = true/)
  // iOS hands a WebView's media to the system itself.
  const screen = await read('app/peertunes/PeerTunesScreen.tsx')
  assert.match(screen, /Platform\.OS === 'android'\s+\? `\$\{PEERTUNES_SCAN_BRIDGE_SCRIPT\}\\n\$\{PEERTUNES_MEDIA_BRIDGE_SCRIPT\}`\s+: PEERTUNES_SCAN_BRIDGE_SCRIPT/)
  assert.match(screen, /audioRoute\?\.setNowPlaying\?\.\(nowPlaying\.playing, nowPlaying\.title, nowPlaying\.artist\)/)
  assert.match(screen, /DeviceEventEmitter\.addListener\('PeerSkyMediaCommand'/)
})

// PeerTunes plays from a player kept out of sight, so switching tabs does not
// stop it. It was kept for the whole session, and closing its tab or burning
// every tab left the music playing with nothing to stop it.
test('closing PeerTunes stops the music', async () => {
  const tab = (id, sources) => ({ id, history: sources.map((source) => ({ source })) })
  const state = {
    tabs: [
      tab('a', [{ kind: 'home' }, { kind: 'app', app: 'peertunes' }]),
      tab('b', [{ kind: 'web', uri: 'https://example.com/' }])
    ]
  }
  assert.equal(isAppInBrowserTabs(state, 'peertunes'), true)
  assert.equal(isAppInBrowserTabs({ tabs: [state.tabs[1]] }, 'peertunes'), false)
  assert.equal(isAppInBrowserTabs({ tabs: [] }, 'peertunes'), false)

  const app = await read('app/index.tsx')
  assert.match(app, /if \(peertunesMounted && !isAppInBrowserTabs\(browserTabsState, 'peertunes'\)\) setPeertunesMounted\(false\)/)
})

// Android keeps the app running for PeerChat after a swipe away. Whatever was
// still playing is paused then.
test('a swipe away pauses PeerTunes and every tab', async () => {
  const service = await read('plugins/templates/PeerChatBackgroundService.kt.template')
  const removed = service.slice(service.indexOf('override fun onTaskRemoved'), service.indexOf('override fun onBind'))
  assert.match(removed, /sendBroadcast\(Intent\("\$packageName\.TASK_REMOVED"\)\.setPackage\(packageName\)\)/)
  // Before the check that keeps PeerChat running, so it happens either way.
  assert.ok(removed.indexOf('sendBroadcast') < removed.indexOf('if (!isWanted(this)) return'))

  const module = await read('plugins/templates/PeerSkyAudioRouteModule.kt.template')
  assert.match(module, /ContextCompat\.RECEIVER_NOT_EXPORTED/)
  assert.match(module, /emitDeviceEvent\(TASK_REMOVED_EVENT, null\)/)

  const screen = await read('app/peertunes/PeerTunesScreen.tsx')
  assert.match(screen, /addListener\('PeerSkyTaskRemoved', \(\) => \{\s+webViewRef\.current\?\.injectJavaScript\(PAUSE_ALL_MEDIA_SCRIPT\)/)
  const app = await read('app/index.tsx')
  assert.match(app, /addListener\('PeerSkyTaskRemoved', \(\) => \{\s+for \(const webView of browserWebViewRefs\.current\.values\(\)\) \{\s+webView\?\.injectJavaScript\(PAUSE_ALL_MEDIA_SCRIPT\)/)

  const paused = []
  const context = vm.createContext({ document: { querySelectorAll: () => [{ pause: () => paused.push(1) }, { pause: () => paused.push(2) }] } })
  vm.runInContext(PAUSE_ALL_MEDIA_SCRIPT, context)
  assert.deepEqual(paused, [1, 2])
})
