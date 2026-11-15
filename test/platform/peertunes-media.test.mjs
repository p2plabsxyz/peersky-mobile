import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'

import {
  PEERTUNES_MEDIA_BRIDGE_SCRIPT,
  PEERTUNES_MEDIA_REPORT_SCRIPT,
  createPeerTunesMediaCommandScript,
  createPeerTunesNowPlayingScript,
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
  assert.deepEqual(page.posted, [{ type: 'peertunes-now-playing', playing: true, title: 'Song', artist: 'Band', album: '', id: '', artwork: '' }])

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

// The widget's tap asks PeerTunes for this song, so the page says which one
// it is, by its id in PeerTunes.
test('the page says which song is playing by its PeerTunes id', () => {
  const page = createPage()
  page.window.PeerTunes = { player: { current: () => ({ id: 'u15hrfys1q' }) } }
  page.navigator.mediaSession.metadata = new page.window.MediaMetadata({ title: 'Song' })
  page.fire('play')
  assert.equal(page.posted.at(-1).id, 'u15hrfys1q')

  page.window.PeerTunes.player.current = () => ({ id: 'u1"; alert(1)' })
  page.fire('pause')
  assert.equal(page.posted.at(-1).id, '')
  page.window.PeerTunes.player.current = () => { throw new Error('not ready') }
  page.navigator.mediaSession.metadata = new page.window.MediaMetadata({ title: 'Other' })
  assert.equal(page.posted.at(-1).id, '')
})

test('a widget tap reaches the page as a request for Now Playing with its song', () => {
  const opened = []
  const window = { PeerTunes: { openNowPlaying: (song) => opened.push(song) } }
  vm.runInNewContext(createPeerTunesNowPlayingScript('u15hrfys1q'), { window })
  vm.runInNewContext(createPeerTunesNowPlayingScript(''), { window })
  vm.runInNewContext(createPeerTunesNowPlayingScript('"); alert(1); ("'), { window })
  assert.deepEqual(opened, ['u15hrfys1q', '', ''])
  // A page that is not PeerTunes, or not ready, is left alone.
  assert.doesNotThrow(() => vm.runInNewContext(createPeerTunesNowPlayingScript('u1'), { window: {} }))
})

// Tapped with PeerSky closed, PeerTunes opened on the list the song was played
// from. The tap is heard before the screen exists and handed to the page once
// it has loaded, and again if it loads once more soon after.
test('PeerTunes hands the widget song to its page once the page has loaded', async () => {
  const screen = await read('app/peertunes/PeerTunesScreen.tsx')
  assert.match(screen, /^Linking\.addEventListener\('url', \(event\) => hearWidgetTap\(event\.url\)\)$/m)
  assert.match(screen, /^void Linking\.getInitialURL\(\)\.then\(hearWidgetTap\)/m)
  assert.match(screen, /const tap = parsePeerTunesWidgetTap\(url\)/)
  assert.match(screen, /onLoadStart=\{\(\) => \{ pageLoadedRef\.current = false \}\}/)
  assert.match(screen, /pageLoadedRef\.current = true\s+showWidgetSong\(\)/)
  assert.match(screen, /if \(!tap \|\| !pageLoadedRef\.current\) return/)
  assert.match(screen, /injectJavaScript\(createPeerTunesNowPlayingScript\(tap\.song\)\)/)
  assert.match(screen, /const WIDGET_TAP_MS = 60 \* 1000/)
})

test('only the four buttons become scripts, and the text is cleaned', () => {
  assert.equal(createPeerTunesMediaCommandScript('stop'), null)
  assert.equal(createPeerTunesMediaCommandScript('");alert(1);("'), null)
  assert.deepEqual(
    parsePeerTunesNowPlaying(JSON.stringify({ type: 'peertunes-now-playing', playing: 'yes', title: 'A\u0000B', artist: 'x'.repeat(500), album: 'LP', id: 'u1 2' })),
    { playing: false, title: 'AB', artist: 'x'.repeat(200), album: 'LP', id: '', artwork: '' }
  )
  assert.equal(parsePeerTunesNowPlaying(JSON.stringify({ type: 'peertunes-now-playing', id: 'u15hrfys1q' })).id, 'u15hrfys1q')
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
  assert.match(screen, /const PEERTUNES_BEFORE_LOAD_SCRIPT = \[\n\s+PEERTUNES_SCAN_BRIDGE_SCRIPT,\n\s+PEERTUNES_MEDIA_BRIDGE_SCRIPT,\n/)
  assert.match(screen, /audioRoute\?\.setNowPlaying\?\.\(\s+nowPlaying\.playing,\s+nowPlaying\.title,\s+nowPlaying\.artist,\s+nowPlaying\.album,\s+readArtworkBase64\(nowPlaying\.artwork\) \?\? ''\s+\)\s+updatePeerTunesWidget\(nowPlaying\)/)
  assert.match(screen, /mediaCommandEvents\.addListener\('PeerSkyMediaCommand'/)
})

// On Android a song stopped once PeerSky was in the background: Android froze
// the app about a minute after another app came to the front. A media playback
// service now holds it up while a song plays, and shows the song with its
// buttons on the lock screen.
test('Android keeps a song playing in the background, with the song on the lock screen', async () => {
  const require = createRequire(import.meta.url)
  const { addPeerTunesPlaybackManifest } = require('../../plugins/with-audio-route.js')
  const manifest = addPeerTunesPlaybackManifest({ application: [{ service: [{ $: { 'android:name': '.Other' } }] }] })
  assert.deepEqual(
    manifest['uses-permission'].map((entry) => entry.$['android:name']),
    ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK']
  )
  assert.deepEqual(manifest.application[0].service.at(-1).$, {
    'android:name': '.PeerTunesPlaybackService',
    'android:exported': 'false',
    'android:foregroundServiceType': 'mediaPlayback'
  })
  assert.equal(manifest.application[0].service.length, 2)
  // Run twice, as a prebuild over a prebuild does: still one of each.
  const again = addPeerTunesPlaybackManifest(manifest)
  assert.equal(again.application[0].service.length, 2)
  assert.equal(again['uses-permission'].length, 2)

  const service = await read('plugins/templates/PeerTunesPlaybackService.kt.template')
  assert.match(service, /startForeground\(NOTIFICATION_ID, notification\(\), ServiceInfo\.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK\)/)
  // Never started again by Android with nothing to play.
  assert.match(service, /return START_NOT_STICKY/)
  assert.doesNotMatch(service, /START_STICKY\b(?!_)/)
  // Paused for a while, it lets go of the foreground and keeps the
  // notification. Not at once: the page says it stopped at the end of each
  // song, and Android does not let an app in the background come back into
  // the foreground for the next one.
  assert.match(service, /if \(!PeerTunesNowPlaying\.playing && intent\?\.action != ACTION_PLAY\) demoteSoon\(PAUSE_GRACE_MS\)/)
  assert.match(service, /service\?\.refresh\(\)\s+service\?\.demoteSoon\(PAUSE_GRACE_MS\)\s+\}/)
  const grace = service.match(/PAUSE_GRACE_MS = ([0-9_]+)L/)
  assert.ok(grace && Number(grace[1].replaceAll('_', '')) >= 15_000, 'too short to cover the gap between two songs')
  assert.match(service, /stopForeground\(STOP_FOREGROUND_DETACH\)/)
  // Already in the foreground, a song that plays only brings the
  // notification up to date, so nothing asks Android for a start it can refuse.
  assert.match(service, /if \(service != null && service\.inForeground\) \{[\s\S]{0,120}service\.refresh\(\)\s+return/)
  // The lock screen and the shade show the media session, buttons and all.
  assert.match(service, /style\.setMediaSession\(it\)/)
  assert.match(service, /\.setCategory\(Notification\.CATEGORY_TRANSPORT\)/)
  assert.match(service, /\.setOngoing\(playing\)/)
  for (const label of ['peertunes_play', 'peertunes_pause', 'peertunes_previous', 'peertunes_next', 'peertunes_playback_channel']) {
    assert.match(service, new RegExp(`R\\.string\\.${label}\\b`))
  }
  // A swipe from Recents closes the page, so the song and the notice go too.
  assert.match(service, /override fun onTaskRemoved[\s\S]{0,200}TASK_REMOVED_ACTION[\s\S]{0,120}finish\(\)/)
  // A notification left from an ended run plays nothing and goes.
  assert.match(service, /if \(controls == null\) \{[\s\S]{0,120}finish\(\)/)

  const module = await read('plugins/templates/PeerSkyAudioRouteModule.kt.template')
  assert.match(module, /PeerTunesNowPlaying\.playing = playing[\s\S]{0,300}PeerTunesPlaybackService\.sync\(reactApplicationContext\)/)
  assert.match(module, /private fun releaseMediaSession\(\) \{\s+PeerTunesPlaybackService\.stop\(\)/)
  assert.match(module, /it\.setSessionActivity\(PeerTunesPlaybackService\.openPeerTunes\(reactApplicationContext\)\)/)
  assert.match(module, /putBitmap\(MediaMetadata\.METADATA_KEY_ART, cover\)/)

  // The buttons reach the page with the app in the background: the session
  // runs the command in PeerTunes' WebView itself, where a script sent
  // through React Native waited until the app was on screen again. Once.
  assert.match(module, /webView\.evaluateJavascript\("window\.__peerskyMediaCommand && window\.__peerskyMediaCommand\(\\"\$name\\"\); true;", null\)\s+reactApplicationContext\.emitDeviceEvent\(COMMAND_SENT_EVENT, name\)/)
  assert.match(module, /if \(webView == null\) \{\s+reactApplicationContext\.emitDeviceEvent\(COMMAND_EVENT, name\)/)
  const screen = await read('app/peertunes/PeerTunesScreen.tsx')
  assert.match(screen, /audioRoute\?\.setPeerTunesView\?\.\(findNodeHandle\(webViewBoxRef\.current\) \?\? 0\)/)
  // Not the WebView's ref, which React Native cannot name: that crashed the
  // app as the page loaded. A view around it that is never flattened away.
  assert.doesNotMatch(screen, /findNodeHandle\(webViewRef/)
  assert.match(screen, /<View ref=\{webViewBoxRef\} collapsable=\{false\} style=\{styles\.webViewBox\}>\s+<WebView/)
  assert.match(screen, /DeviceEventEmitter\.addListener\('PeerSkyMediaCommandSent', afterCommand\)/)
  const sentHandler = screen.slice(screen.indexOf("'PeerSkyMediaCommandSent'"), screen.indexOf("'PeerSkyMediaCommandSent'") + 60)
  assert.doesNotMatch(sentHandler, /injectJavaScript/)
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
