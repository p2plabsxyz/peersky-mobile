import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

import {
  PEERTUNES_MEDIA_BRIDGE_SCRIPT,
  PEERTUNES_MEDIA_REPORT_SCRIPT,
  createPeerTunesMediaCommandScript,
  parsePeerTunesNowPlaying
} from '../../app/peertunes/peertunes-screen.mjs'
import { PAUSE_ALL_MEDIA_SCRIPT } from '../../app/browser-media.mjs'
import { isAppInBrowserTabs } from '../../app/browser-tabs.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// Enough of a page to run the bridge in: one audio element, a WebView bridge
// that records what the page says, and images and a canvas for the cover.
function createPage ({ mediaSession = true, canvasFails = false } = {}) {
  const posted = []
  const listeners = {}
  const images = []
  class Image {
    constructor () { images.push(this) }
  }
  const drawn = []
  const canvas = {
    getContext: () => ({ drawImage: (...args) => drawn.push(args) }),
    toDataURL: () => {
      if (canvasFails) throw new Error('SecurityError')
      return 'data:image/jpeg;base64,Q09WRVI='
    }
  }
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
    createElement: (tag) => tag === 'canvas' ? canvas : null,
    querySelectorAll: () => [audio]
  }
  const context = vm.createContext({ window, navigator, document, Image, Math, setTimeout: (fn) => fn(), Object, JSON, String })
  vm.runInContext(PEERTUNES_MEDIA_BRIDGE_SCRIPT, context)
  const fire = (name) => (listeners[name] || []).forEach((listener) => listener())
  return { audio, canvas, context, drawn, fire, images, navigator, posted, window }
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
  assert.deepEqual(page.posted, [{ type: 'peertunes-now-playing', playing: true, title: 'Song', artist: 'Band', album: '', artwork: '' }])

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

// The home screen widget cannot load the page's own address for the cover,
// so the page draws it small and hands it across as text.
test('the cover goes across as a small square picture, made once for each cover', () => {
  const page = createPage()
  page.navigator.mediaSession.metadata = new page.window.MediaMetadata({
    title: 'Song',
    album: 'Record',
    artwork: [{ src: 'blob:cover' }]
  })
  page.fire('play')
  // The picture is not drawn yet: the song goes first, without it.
  assert.equal(page.posted.at(-1).artwork, '')
  assert.equal(page.posted.at(-1).album, 'Record')
  assert.equal(page.images.length, 1)
  assert.equal(page.images[0].src, 'blob:cover')

  Object.assign(page.images[0], { naturalWidth: 600, naturalHeight: 400 })
  page.images[0].onload()
  assert.equal(page.posted.at(-1).artwork, 'data:image/jpeg;base64,Q09WRVI=')
  // The middle square of a wide cover, drawn at 256.
  assert.deepEqual(page.drawn[0].slice(1), [100, 0, 400, 400, 0, 0, 256, 256])
  assert.equal(page.canvas.width, 256)

  page.fire('pause')
  assert.equal(page.images.length, 1)
})

test('a cover the page may not read goes across as nothing', () => {
  const page = createPage({ canvasFails: true })
  page.navigator.mediaSession.metadata = new page.window.MediaMetadata({ title: 'Song', artwork: [{ src: 'https://elsewhere/cover.jpg' }] })
  page.fire('play')
  Object.assign(page.images[0], { naturalWidth: 300, naturalHeight: 300 })
  page.images[0].onload()
  assert.equal(page.posted.at(-1).artwork, '')
})

// A widget button shows its change before the page acts on it. Asked, the
// page says what it is doing even when nothing changed.
test('the page says what is playing again when asked', () => {
  const page = createPage()
  page.navigator.mediaSession.metadata = new page.window.MediaMetadata({ title: 'Song' })
  page.fire('play')
  const before = page.posted.length
  page.fire('play')
  assert.equal(page.posted.length, before)
  vm.runInContext(PEERTUNES_MEDIA_REPORT_SCRIPT, page.context)
  assert.equal(page.posted.length, before + 1)
})

test('only the four buttons become scripts, and the text is cleaned', () => {
  assert.equal(createPeerTunesMediaCommandScript('stop'), null)
  assert.equal(createPeerTunesMediaCommandScript('");alert(1);("'), null)
  assert.deepEqual(
    parsePeerTunesNowPlaying(JSON.stringify({ type: 'peertunes-now-playing', playing: 'yes', title: 'A\u0000B', artist: 'x'.repeat(500), album: 'LP' })),
    { playing: false, title: 'AB', artist: 'x'.repeat(200), album: 'LP', artwork: '' }
  )
  assert.equal(
    parsePeerTunesNowPlaying(JSON.stringify({ type: 'peertunes-now-playing', artwork: 'x'.repeat(400 * 1024) })).artwork,
    ''
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
  // On both: Android's media session and the iOS widget read what it says.
  const screen = await read('app/peertunes/PeerTunesScreen.tsx')
  assert.match(screen, /const PEERTUNES_BEFORE_LOAD_SCRIPT = `\$\{PEERTUNES_SCAN_BRIDGE_SCRIPT\}\\n\$\{PEERTUNES_MEDIA_BRIDGE_SCRIPT\}`/)
  assert.match(screen, /audioRoute\?\.setNowPlaying\?\.\(nowPlaying\.playing, nowPlaying\.title, nowPlaying\.artist\)\s+updatePeerTunesWidget\(nowPlaying\)/)
  assert.match(screen, /mediaCommandEvents\.addListener\('PeerSkyMediaCommand'/)
})

// iOS sends the widget's buttons through the module, which only passes on
// events while something listens through it.
test('the iOS widget buttons reach the page as the same commands', async () => {
  const screen = await read('app/peertunes/PeerTunesScreen.tsx')
  assert.match(screen, /Platform\.OS === 'ios' && NativeModules\.PeerSkyAudioRoute\s+\? new NativeEventEmitter\(NativeModules\.PeerSkyAudioRoute\)\s+: DeviceEventEmitter/)
  assert.match(screen, /forgetPeerTunesWidgetState\(\)[\s\S]{0,200}injectJavaScript\(PEERTUNES_MEDIA_REPORT_SCRIPT\)/)
  assert.match(screen, /audioRoute\?\.clearNowPlaying\?\.\(\)\s+idlePeerTunesWidget\(\)/)

  const module = await read('plugins/templates/PeerSkyAudioRoute.m.template')
  assert.match(module, /@interface PeerSkyAudioRoute : RCTEventEmitter <RCTBridgeModule>/)
  assert.match(module, /static NSString \*const PeerSkyMediaCommandName = @"PeerSkyMediaCommand";/)
  assert.match(module, /- \(void\)startObserving\s*\{\s*\[\[NSNotificationCenter defaultCenter\] addObserver:self/)
  assert.match(module, /\[self sendEventWithName:PeerSkyMediaCommandName body:command\]/)
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
