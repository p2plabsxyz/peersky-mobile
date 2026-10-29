import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, test } from 'node:test'

import { parseHomeShortcut, parsePeerTunesWidgetTap } from '../../app/home-shortcuts.mjs'
import { P2P_APPS } from '../../app/internal-apps-registry.mjs'
import { createPeerTunesMediaCommandScript } from '../../app/peertunes/peertunes-screen.mjs'
import {
  BROWSER_WIDGET_KIND,
  MAX_WIDGET_BOOKMARKS,
  PEERTUNES_WIDGET_KIND,
  WIDGET_APP_GROUP,
  WIDGET_KEYS,
  readArtworkBase64,
  toPeerTunesWidgetState,
  toWidgetBookmarks
} from '../../app/widget-data.mjs'

const require = createRequire(import.meta.url)
const appJson = require('../../app.json')
const targetConfig = require('../../targets/widgets/expo-target.config.js')

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const store = await read('targets/widgets/_shared/PeerSkyWidgetStore.swift')
const intents = await read('targets/widgets/_shared/PeerTunesIntents.swift')
const browserWidget = await read('targets/widgets/BrowserWidget.swift')
const widgetBundle = await read('targets/widgets/PeerSkyWidgets.swift')
const assets = new URL('../../targets/widgets/Assets.xcassets/', import.meta.url)

// Width and height from a PNG or JPEG header.
function imageSize (bytes) {
  if (bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  for (let offset = 2; offset < bytes.length;) {
    const marker = bytes.readUInt16BE(offset)
    if (marker === 0xffc0 || marker === 0xffc2) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }
    }
    offset += 2 + bytes.readUInt16BE(offset + 2)
  }
  throw new Error('Not a PNG or JPEG')
}

describe('home screen widgets', () => {
  test('list the newest bookmarks they can open', () => {
    const bookmarks = toWidgetBookmarks([
      { url: 'https://a.example/', title: 'A', createdAt: 1 },
      { url: 'https://www.b.example/x', title: '', createdAt: 3 },
      { url: 'javascript:alert(1)', title: 'Nope', createdAt: 9 },
      { url: 'hyper://drive/', title: 'Drive', createdAt: 2 },
      { url: 'https://c.example/', title: ' C\u0000 ', createdAt: 4 }
    ])
    assert.equal(MAX_WIDGET_BOOKMARKS, 3)
    assert.deepEqual(bookmarks, [
      { title: 'C', url: 'https://c.example/' },
      { title: 'b.example', url: 'https://www.b.example/x' },
      { title: 'Drive', url: 'hyper://drive/' }
    ])
    assert.deepEqual(toWidgetBookmarks(null), [])
  })

  // The buttons only work while the player page is open to take them.
  test('show PeerTunes as playing only while its page is open', () => {
    assert.deepEqual(
      toPeerTunesWidgetState({ playing: true, title: 'Song\u0007', artist: 'Band', album: 'LP', id: 'u1x2y3' }),
      { live: true, playing: true, title: 'Song', artist: 'Band', album: 'LP', id: 'u1x2y3' }
    )
    assert.deepEqual(
      toPeerTunesWidgetState({ playing: true, title: 'Song', id: 'u1x2y3' }, { live: false }),
      { live: false, playing: false, title: 'Song', artist: '', album: '', id: 'u1x2y3' }
    )
    // Only a plain id goes into the tap's link.
    assert.equal(toPeerTunesWidgetState({ title: 'Song', id: 'u1&song=x' }).id, '')
    assert.equal(toPeerTunesWidgetState({ title: 'Song' }).id, '')
  })

  // Tapped with PeerSky closed, the widget opened PeerTunes on the list the
  // song was played from. Its link now carries the song, which PeerTunes
  // opens in Now Playing, and the app's own link handling still reads it as
  // a plain PeerTunes address.
  test('open PeerTunes on the song they show', async () => {
    const widget = await read('targets/widgets/PeerTunesWidget.swift')
    assert.match(widget, /\.widgetURL\(WidgetLinks\.peerTunes\(showing: song\)\)/)
    assert.match(widgetBundle, /private static let peerTunesApp = open\("peersky:\/\/p2p\/peertunes\/"\)/)
    assert.match(widgetBundle, /static func peerTunes\(showing song: PeerSkyWidgetStore\.NowPlaying\?\) -> URL \{\s+guard let song else \{ return peerTunesApp \}/)
    assert.match(widgetBundle, /URL\(string: "\\\(peerTunesApp\.absoluteString\)&song=\\\(id\)"\)/)
    assert.match(store, /var id: String\?/)

    // What that Swift writes, read the way the app reads it.
    const app = `peersky://shortcut/open?url=${encodeURIComponent('peersky://p2p/peertunes/')}`
    assert.deepEqual(parseHomeShortcut(`${app}&song=u1x2y3`), { name: 'open', target: 'peersky://p2p/peertunes/' })
    assert.deepEqual(parsePeerTunesWidgetTap(`${app}&song=u1x2y3`), { song: 'u1x2y3' })
  })

  test('take only the small cover the page makes', () => {
    assert.equal(readArtworkBase64('data:image/jpeg;base64,QUJD'), 'QUJD')
    assert.equal(readArtworkBase64('data:image/png;base64,QUI='), 'QUI=')
    assert.equal(readArtworkBase64('data:image/svg+xml;base64,QUJD'), null)
    assert.equal(readArtworkBase64('https://example.com/cover.jpg'), null)
    assert.equal(readArtworkBase64(`data:image/jpeg;base64,${'A'.repeat(300 * 1024)}`), null)
  })

  test('read what the app writes, from the same App Group', () => {
    assert.deepEqual(appJson.expo.ios.entitlements['com.apple.security.application-groups'], [WIDGET_APP_GROUP])
    assert.deepEqual(
      targetConfig(appJson.expo).entitlements['com.apple.security.application-groups'],
      [WIDGET_APP_GROUP]
    )
    assert.match(store, new RegExp(`static let appGroup = "${WIDGET_APP_GROUP.replaceAll('.', '\\.')}"`))
    assert.match(store, new RegExp(`static let browserKind = "${BROWSER_WIDGET_KIND}"`))
    assert.match(store, new RegExp(`static let peerTunesKind = "${PEERTUNES_WIDGET_KIND}"`))
    assert.match(store, new RegExp(`bookmarksKey = "${WIDGET_KEYS.bookmarks}"`))
    assert.match(store, new RegExp(`nowPlayingKey = "${WIDGET_KEYS.nowPlaying}"`))
    assert.match(store, new RegExp(`artworkKey = "${WIDGET_KEYS.artwork}"`))

    // Field for field what JavaScript writes and Swift decodes.
    const fields = (name) => [...store.slice(store.indexOf(`struct ${name}`)).split('}')[0].matchAll(/(?:let|var) (\w+): /g)].map((match) => match[1])
    assert.deepEqual(fields('NowPlaying'), Object.keys(toPeerTunesWidgetState({})))
    assert.deepEqual(fields('Bookmark'), Object.keys(toWidgetBookmarks([{ url: 'https://a.example/', title: 'A' }])[0]))
  })

  test('show the apps the start page shows, opening through links the app reads', async () => {
    const apps = [...browserWidget.matchAll(/WidgetApp\(id: "([^"]+)", title: "([^"]+)", image: "([^"]+)", url: "([^"]+)"\)/g)]
      .map(([, id, title, image, url]) => ({ id, title, image, url }))
    assert.deepEqual(apps.map(({ id, title, url }) => ({ id, title, url })), P2P_APPS.map(({ id, title, url }) => ({ id, title, url })))

    const imagesets = await readdir(assets)
    for (const name of ['PeerSkyIcon', 'Wallpaper', ...apps.map((app) => app.image)]) {
      assert.ok(imagesets.includes(`${name}.imageset`), name)
    }

    assert.match(widgetBundle, /static let search = URL\(string: "peersky:\/\/shortcut\/search"\)!/)
    assert.deepEqual(parseHomeShortcut('peersky://shortcut/search'), { name: 'search' })
    assert.match(widgetBundle, /CharacterSet\(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-\._~"\)/)
    assert.match(widgetBundle, /URL\(string: "peersky:\/\/shortcut\/open\?url=\\\(encoded\)"\)/)
  })

  // DuckDuckGo-style lock screen buttons, each with a link the app reads.
  test('put five buttons on the lock screen, each opening what it says', async () => {
    const lock = await read('targets/widgets/LockScreenWidgets.swift')
    const widgets = [...lock.matchAll(/struct (\w+): Widget \{[\s\S]*?lockScreenButton\(kind: "(\w+)", link: WidgetLinks\.(\w+), label: "([^"]+)"\)[\s\S]*?\.configurationDisplayName\("([^"]+)"\)/g)]
      .map(([, type, kind, link, label, name]) => ({ type, kind, link, label, name }))
    assert.deepEqual(widgets.map(({ link }) => link), ['privateSearch', 'burn', 'bookmarks', 'p2pSites', 'clearP2PData'])
    for (const widget of widgets) {
      assert.match(widgetBundle, new RegExp(`\\n {4}${widget.type}\\(\\)\\n`), `${widget.type} is in the bundle`)
      assert.equal(widget.label, widget.name, 'VoiceOver reads the name the gallery shows')
    }
    assert.equal(new Set(widgets.map(({ kind }) => kind)).size, widgets.length)

    // What each link reads as in the app.
    const links = Object.fromEntries([...widgetBundle.matchAll(/static let (privateSearch|burn|bookmarks|clearP2PData) = URL\(string: "([^"]+)"\)!/g)].map(([, name, url]) => [name, url]))
    assert.deepEqual(parseHomeShortcut(links.privateSearch), { name: 'private-search' })
    assert.deepEqual(parseHomeShortcut(links.burn), { name: 'burn' })
    assert.deepEqual(parseHomeShortcut(links.bookmarks), { name: 'bookmarks' })
    assert.deepEqual(parseHomeShortcut(links.clearP2PData), { name: 'clear-p2p-data' })
    assert.match(widgetBundle, /static let p2pSites = open\("peersky:\/\/p2p\/"\)/)

    // Round, on the lock screen's own glass, with nothing behind it.
    assert.match(lock, /\.supportedFamilies\(\[\.accessoryCircular\]\)/)
    assert.match(lock, /AccessoryWidgetBackground\(\)/)
    assert.match(lock, /\.containerBackground\(for: \.widget\) \{ Color\.clear \}/)
    assert.match(lock, /\.widgetURL\(link\)/)
  })

  // The icons of the app's own buttons, one picture each.
  test('show the app\'s own icons on the lock screen buttons', async () => {
    const lock = await read('targets/widgets/LockScreenWidgets.swift')
    const icons = Object.fromEntries([...lock.matchAll(/lockScreenButton\(kind: "(\w+)".*\n\s+(?:AppIcon\(name: "(\w+)"\)|Image\(systemName: "([\w.]+)"\))\n/g)]
      .map(([, kind, asset, symbol]) => [kind, asset || symbol]))
    assert.deepEqual(icons, {
      PeerSkyPrivateSearch: 'IncognitoIcon',
      PeerSkyBurn: 'FireIcon',
      PeerSkyBookmarks: 'BookmarksIcon',
      PeerSkyP2PSites: 'point.3.connected.trianglepath.dotted',
      PeerSkyClearP2PData: 'TrashIcon'
    })
    assert.doesNotMatch(lock, /ZStack\(alignment/, 'nothing laid over an icon')

    // Copied unchanged from the icons the app draws, and tinted like a symbol.
    for (const [asset, file] of [['IncognitoIcon', 'incognito'], ['FireIcon', 'fire'], ['BookmarksIcon', 'bookmarks'], ['TrashIcon', 'trash']]) {
      const copy = await readFile(new URL(`${asset}.imageset/${file}.svg`, assets))
      assert.ok(copy.equals(await readFile(new URL(`../../assets/icons/bootstrap/${file}.svg`, import.meta.url))), asset)
      const contents = JSON.parse(await readFile(new URL(`${asset}.imageset/Contents.json`, assets), 'utf8'))
      assert.equal(contents.properties['template-rendering-intent'], 'template', asset)
    }
    assert.match(lock, /Image\(name\)\n\s+\.renderingMode\(\.template\)/)
  })

  test('send the PeerTunes buttons to the app as the page\'s own commands', async () => {
    const sent = [...intents.matchAll(/@available\(iOS 17\.0, \*\)\nstruct (\w+): AudioPlaybackIntent \{[\s\S]*?PeerTunesWidgetCommand\.send\("(\w+)"\)/g)]
      .map(([, name, command]) => [name, command])
    assert.deepEqual(sent, [
      ['PeerTunesPlayIntent', 'play'],
      ['PeerTunesPauseIntent', 'pause'],
      ['PeerTunesNextIntent', 'nexttrack'],
      ['PeerTunesPreviousIntent', 'previoustrack']
    ])
    for (const [, command] of sent) assert.ok(createPeerTunesMediaCommandScript(command), command)

    const module = await read('plugins/templates/PeerSkyAudioRoute.m.template')
    assert.match(intents, /Notification\.Name\("PeerSkyMediaCommand"\)/)
    assert.match(module, /PeerSkyMediaCommandName = @"PeerSkyMediaCommand"/)
  })

  // WidgetKit refuses to draw a widget holding an image much over a million
  // pixels: the wallpaper at 1200 wide left every size blank.
  test('keep every picture small enough for WidgetKit to draw', async () => {
    for (const imageset of await readdir(assets)) {
      if (!imageset.endsWith('.imageset')) continue
      for (const file of await readdir(new URL(`${imageset}/`, assets))) {
        if (!/\.(png|jpe?g)$/i.test(file)) continue
        const { width, height } = imageSize(await readFile(new URL(`${imageset}/${file}`, assets)))
        assert.ok(width * height < 1_000_000, `${file} is ${width}x${height}`)
      }
    }
  })

  test('build for iOS 17 beside the app, and say why they read user defaults', async () => {
    assert.ok(appJson.expo.plugins.includes('@bacons/apple-targets'))
    const config = targetConfig(appJson.expo)
    assert.equal(config.type, 'widget')
    assert.equal(config.deploymentTarget, '17.0')
    assert.ok(config.frameworks.includes('AppIntents'))

    // Its own pod: the plugin's storage module asks for iOS 16.4, past what
    // the app supports, so autolinking left it out. Not named after the
    // target either, whose Swift module would answer the import first.
    const podspec = await read('modules/peersky-widget-storage/ios/PeerSkyWidgetStorage.podspec')
    assert.match(podspec, /s\.platforms\s+= \{ :ios => '16\.0' \}/)
    assert.notEqual('PeerSkyWidgetStorage', config.name)

    const privacy = await read('targets/widgets/PrivacyInfo.xcprivacy')
    assert.match(privacy, /NSPrivacyAccessedAPICategoryUserDefaults<\/string>\s+<key>NSPrivacyAccessedAPITypeReasons<\/key>\s+<array>\s+<string>1C8F\.1<\/string>/)
    const defaults = appJson.expo.ios.privacyManifests.NSPrivacyAccessedAPITypes
      .find((entry) => entry.NSPrivacyAccessedAPIType === 'NSPrivacyAccessedAPICategoryUserDefaults')
    assert.ok(defaults.NSPrivacyAccessedAPITypeReasons.includes('1C8F.1'))
  })

  // apple-targets 5.0.0 crashed on any prebuild without --clean once the
  // widget target existed: unhooking the old configuration list cleared the
  // target's own pointer to it, and the next line read it. Patched on install.
  test('update the widget target on a prebuild without --clean', async () => {
    const packageJson = JSON.parse(await read('package.json'))
    assert.equal(packageJson.scripts.postinstall, 'patch-package')
    const version = JSON.parse(await read('node_modules/@bacons/apple-targets/package.json')).version
    const patch = await read(`patches/@bacons+apple-targets+${version}.patch`)
    assert.match(patch, /const existingConfigurationList = targetToUpdate\.props\.buildConfigurationList;/)
    const installed = await read('node_modules/@bacons/apple-targets/build/with-xcode-changes.js')
    assert.match(installed, /ref\.removeReference\(existingConfigurationList\.uuid\);\s+\}\);\s+existingConfigurationList\.removeFromProject\(\);/)
  })

  test('keep the large widget\'s list and the player state current', async () => {
    const app = await read('app/index.tsx')
    assert.match(app, /if \(browserBookmarksReady\) updateBrowserWidget\(browserBookmarks\)/)
    assert.match(app, /useEffect\(\(\) => \{\s+idlePeerTunesWidget\(\)\s+\}, \[\]\)/)
    const widgets = await read('app/widgets.ts')
    assert.match(widgets, /requireOptionalNativeModule<[\s\S]*?>\('PeerSkyWidgetStorage'\)/)
  })

  // A song comes in as a report without its cover and then one with it. A
  // reload for each meant the second could be refused in the background, so
  // the cover only showed after pressing next. One reload once they settle.
  test('reload the widget once the reports for a song settle, not for each', async () => {
    const widgets = await read('app/widgets.ts')
    const reload = widgets.slice(widgets.indexOf('function reload'), widgets.indexOf('/** The bookmarks'))
    assert.match(widgets, /const RELOAD_SETTLE_MS = 400/)
    assert.match(reload, /if \(pending\) clearTimeout\(pending\)/)
    assert.match(reload, /setTimeout\(\(\) => \{\s+pendingReloads\.delete\(kind\)\s+try \{\s+widgets\.reload\(kind\)/)
    // Every caller goes through it.
    assert.equal((widgets.match(/widgets\??\.reload\(/g) || []).length, 1)
  })
})
