import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import {
  formatViewerUrl,
  getFolderViewerRedirect,
  hyperUrlForViewer,
  isRawListingUrl,
  normalizeViewerUrl,
  parseViewerUrl,
  toViewerLocalPath,
  viewerTitle,
  viewerUrlFor
} from '../../app/hyperdrive/viewer-route.mjs'
import {
  DRIVE_VIEWER_LOCAL_URL,
  createDriveViewerConfig,
  createDriveViewerConfigScript,
  createDriveViewerPageUrl,
  isDriveViewerDownloadUrl,
  isDriveViewerOrigin,
  isDriveViewerPageRequest,
  isRunToken,
  parseDriveViewerDownloadUrl,
  parseDriveViewerMessage,
  viewerStringKeys
} from '../../app/hyperdrive/drive-viewer.mjs'
import { catalogEntries, registerCatalogs, setLanguage } from '../../app/i18n/i18n.mjs'
import { nextHyperdriveViewerEpoch, parseBrowserPreferences } from '../../app/settings/browser-preferences.mjs'
import { getProxiedHyperUrl } from '../../app/downloads/browser-downloads.mjs'
import { buildViewerRuntime, missingViewerFiles, sourceDir } from '../../scripts/generate-hyperdrive-viewer-runtime.mjs'
import {
  collectStrings,
  collectViewerStrings,
  scanSource,
  VIEWER_I18N_IMPORT,
  viewerSourceFiles,
  withoutComments
} from '../../scripts/i18n.mjs'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const json = (path) => JSON.parse(read(path))

const Z32 = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u'
const HEX = 'ab'.repeat(32)
const LOCAL = 'http://127.0.0.1:47318'
// This run's secret, as the viewer's server makes one.
const TOKEN = 'c0ffee12'.repeat(8)

describe('Hyperdrive viewer addresses', () => {
  test('a viewer address names a view, a drive and a folder', () => {
    assert.deepEqual(parseViewerUrl(`peersky://p2p/hyperdrive/photos/${Z32}/2024/Goa/`), {
      view: 'photos', host: Z32, path: '/2024/Goa/', auto: false, hash: ''
    })
    assert.deepEqual(parseViewerUrl(`peersky://p2p/hyperdrive/files/${HEX}/`), {
      view: 'files', host: HEX, path: '/', auto: false, hash: ''
    })
    assert.deepEqual(parseViewerUrl('peersky://p2p/hyperdrive/videos/agregore.mauve.moe/Shows/Season%201/?auto'), {
      view: 'videos', host: 'agregore.mauve.moe', path: '/Shows/Season 1/', auto: true, hash: ''
    })
    // The fragment is the viewer's: what is open inside it.
    assert.equal(parseViewerUrl(`peersky://p2p/hyperdrive/photos/${Z32}/#album=/2024/Goa/`).hash, '#album=/2024/Goa/')
    assert.equal(parseViewerUrl(`peersky://p2p/hyperdrive/photos/${Z32}/#item=/a%20b.jpg&places`).hash, '#item=/a%20b.jpg&places')
  })

  test('the host is lower-cased, the folder ends in a slash, and nothing else is changed', () => {
    const route = parseViewerUrl(`PEERSKY://p2p/hyperdrive/Photos/${Z32.toUpperCase()}/A%20B//c`)
    assert.equal(route.view, 'photos')
    assert.equal(route.host, Z32)
    assert.equal(route.path, '/A B/c/')
    assert.equal(parseViewerUrl(`peersky://p2p/hyperdrive/files/${Z32}`).path, '/')
    // Other query keys are no business of the address.
    assert.equal(parseViewerUrl(`peersky://p2p/hyperdrive/files/${Z32}/?raw&x=1`).auto, false)
    assert.equal(parseViewerUrl(`peersky://p2p/hyperdrive/files/${Z32}/?x=1&auto`).auto, true)
    // A fragment the viewer could not have written is dropped.
    assert.equal(parseViewerUrl(`peersky://p2p/hyperdrive/files/${Z32}/#<script>`).hash, '')
  })

  test('anything else is not a viewer address', () => {
    for (const url of [
      'peersky://p2p/hyperdrive/',
      'peersky://p2p/hyperdrive/files/',
      `peersky://p2p/hyperdrive/music/${Z32}/`,
      `peersky://p2p/hyperdrive/viewer/${Z32}/`,
      `peersky://p2p/peertunes/files/${Z32}/`,
      `hyper://${Z32}/`,
      'peersky://p2p/hyperdrive/files/bad_host/',
      'peersky://p2p/hyperdrive/files/-bad.example/',
      `peersky://p2p/hyperdrive/files/${Z32}/../secret/`,
      `peersky://p2p/hyperdrive/files/${Z32}/%2e%2e/secret/`,
      `peersky://p2p/hyperdrive/files/${Z32}/a%2Fb/`,
      `peersky://p2p/hyperdrive/files/${Z32}/a%5Cb/`,
      `peersky://p2p/hyperdrive/files/${Z32}/%E0%A4%A/`,
      `peersky://p2p/hyperdrive/files/${Z32}/${'a'.repeat(9000)}/`,
      '',
      null
    ]) {
      assert.equal(parseViewerUrl(url), null, String(url).slice(0, 80))
    }
  })

  test('an address is written one way, each segment encoded', () => {
    assert.equal(
      formatViewerUrl({ view: 'photos', host: Z32, path: '/My Photos/Ünïcødé ?#/', auto: true, hash: '#places' }),
      `peersky://p2p/hyperdrive/photos/${Z32}/My%20Photos/%C3%9Cn%C3%AFc%C3%B8d%C3%A9%20%3F%23/?auto#places`
    )
    const url = `peersky://p2p/hyperdrive/photos/${Z32}/My%20Photos/2024/?auto#album=/2024/`
    assert.equal(normalizeViewerUrl(url), url)
    assert.equal(normalizeViewerUrl(`peersky://p2p/hyperdrive/files/${Z32}/My Photos`), `peersky://p2p/hyperdrive/files/${Z32}/My%20Photos/`)
    assert.equal(normalizeViewerUrl('https://example.com/'), null)
  })

  test('the WebView loads the same path from the viewer\'s server', () => {
    assert.equal(
      toViewerLocalPath(`peersky://p2p/hyperdrive/videos/${Z32}/Shows/Season%201/?auto#item=/Shows/x.mkv`),
      `/hyperdrive/videos/${Z32}/Shows/Season%201/?auto#item=/Shows/x.mkv`
    )
    assert.equal(toViewerLocalPath(`hyper://${Z32}/`), null)
    assert.equal(
      createDriveViewerPageUrl(`${LOCAL}/`, `peersky://p2p/hyperdrive/files/${Z32}/a/`),
      `${LOCAL}/hyperdrive/files/${Z32}/a/`
    )
    assert.equal(createDriveViewerPageUrl(null, `peersky://p2p/hyperdrive/files/${Z32}/`), null)
    assert.equal(createDriveViewerPageUrl(LOCAL, 'peersky://p2p/hyperdrive/'), null)
  })

  test('a hyper:// folder has a viewer address that lets the viewer pick the view', () => {
    assert.equal(viewerUrlFor(`hyper://${Z32}/`), `peersky://p2p/hyperdrive/files/${Z32}/?auto`)
    assert.equal(viewerUrlFor(`hyper://${Z32.toUpperCase()}/My%20Photos/2024`), `peersky://p2p/hyperdrive/files/${Z32}/My%20Photos/2024/?auto`)
    assert.equal(viewerUrlFor(`hyper://${Z32}/My Photos/`), `peersky://p2p/hyperdrive/files/${Z32}/My%20Photos/?auto`)
    assert.equal(viewerUrlFor(`hyper://${HEX}/a/?noResolve#top`), `peersky://p2p/hyperdrive/files/${HEX}/a/?auto`)
    assert.equal(viewerUrlFor('hyper://agregore.mauve.moe'), 'peersky://p2p/hyperdrive/files/agregore.mauve.moe/?auto')
    assert.equal(viewerUrlFor(`hyper://${Z32}/a/`, { view: 'photos', auto: false }), `peersky://p2p/hyperdrive/photos/${Z32}/a/`)
    assert.equal(viewerUrlFor(`hyper://${Z32}/%E0%A4%A/`), null)
    assert.equal(viewerUrlFor(`hyper://${Z32}/../a/`), null)
    assert.equal(viewerUrlFor('https://example.com/'), null)
    assert.equal(hyperUrlForViewer(parseViewerUrl(`peersky://p2p/hyperdrive/files/${Z32}/My%20Photos/`)), `hyper://${Z32}/My%20Photos/`)
  })

  test('a tab showing the viewer is named after the folder, or the drive at its root', () => {
    assert.equal(viewerTitle(parseViewerUrl(`peersky://p2p/hyperdrive/photos/${Z32}/2024/Goa/`)), 'Goa')
    assert.equal(viewerTitle(parseViewerUrl(`peersky://p2p/hyperdrive/photos/${Z32}/`)), 'ybndrf…ot1u')
    assert.equal(viewerTitle(parseViewerUrl('peersky://p2p/hyperdrive/files/agregore.mauve.moe/')), 'agregore.mauve.moe')
  })
})

describe('Opening a hyper:// folder in the viewer', () => {
  const listing = (overrides = {}) => ({
    ok: true,
    status: 200,
    body: '[\n\t"IMG_1.jpg",\n\t"2024/"\n]',
    headers: { 'content-type': 'application/json', link: `<hyper://${Z32}/photos/>; rel="canonical"` },
    ...overrides
  })

  test('a folder that came back as a list of names opens in the viewer instead', () => {
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/photos/`, listing()), `peersky://p2p/hyperdrive/files/${Z32}/photos/?auto`)
    // The address keeps the host it was asked under, not the canonical one.
    assert.equal(getFolderViewerRedirect(`hyper://${HEX}/photos/`, listing()), `peersky://p2p/hyperdrive/files/${HEX}/photos/?auto`)
    // An empty drive is a folder too.
    assert.equal(
      getFolderViewerRedirect(`hyper://${Z32}/`, listing({ body: '[]', headers: { 'content-type': 'application/json' } })),
      `peersky://p2p/hyperdrive/files/${Z32}/?auto`
    )
  })

  test('a folder served as its README, or another index file that is no web page, opens in the viewer too', () => {
    // As hypercore-fetch serves one in place of the folder's list, naming it
    // in the canonical link. The viewer shows it under the list.
    const readme = (folder, file, overrides = {}) => listing({
      body: '# Docs',
      headers: { 'content-type': 'text/markdown; charset=utf-8', link: `<hyper://${Z32}${folder}${file}>; rel="canonical"` },
      ...overrides
    })
    for (const file of ['README.md', 'README.org', 'index.md', 'index.gmi', 'index.gemini', 'index.org', 'readme.MD', 'Index.Org']) {
      assert.equal(getFolderViewerRedirect(`hyper://${Z32}/docs/`, readme('/docs/', file)), `peersky://p2p/hyperdrive/files/${Z32}/docs/?auto`, file)
    }
    // The drive's top, under a name, a hex key and a folder with spaces.
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/`, readme('/', 'README.md')), `peersky://p2p/hyperdrive/files/${Z32}/?auto`)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}`, readme('/', 'README.md')), `peersky://p2p/hyperdrive/files/${Z32}/?auto`)
    assert.equal(getFolderViewerRedirect('hyper://docs.example.org/', readme('/', 'README.md')), 'peersky://p2p/hyperdrive/files/docs.example.org/?auto')
    assert.equal(getFolderViewerRedirect(`hyper://${HEX}/`, readme('/', 'README.md')), `peersky://p2p/hyperdrive/files/${HEX}/?auto`)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/My%20Docs/`, readme('/My%20Docs/', 'README.md')), `peersky://p2p/hyperdrive/files/${Z32}/My%20Docs/?auto`)
    // Whatever the browser made of the file: a folder is never a download.
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/docs/`, readme('/docs/', 'README.org', { body: undefined, downloadUrl: 'http://127.0.0.1:1/asset' })), `peersky://p2p/hyperdrive/files/${Z32}/docs/?auto`)

    // A website stays one.
    for (const file of ['index.html', 'index.htm', 'INDEX.HTML']) {
      assert.equal(getFolderViewerRedirect(`hyper://${Z32}/site/`, listing({
        body: '<!doctype html><title>Site</title>',
        headers: { 'content-type': 'text/html; charset=utf-8', link: `<hyper://${Z32}/site/${file}>; rel="canonical"` }
      })), null, file)
    }
    // The README's own address, and ?raw and ?noResolve, show what came back.
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/docs/README.md`, readme('/docs/', 'README.md')), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/docs/?raw`, readme('/docs/', 'README.md')), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/docs/?noResolve`, readme('/docs/', 'README.md')), null)
    // Only an index file of that folder, by its own name.
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/docs/`, readme('/docs/sub/', 'README.md')), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/docs/`, readme('/other/', 'README.md')), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/docs/`, readme('/docs/', 'README.txt')), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/docs/`, readme('/docs/', 'README.markdown')), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/docs/`, readme('/docs/', 'notes.md')), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/docs/`, readme('/docs/', 'README.md', { ok: false })), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/docs/`, readme('/docs/', 'README.md', { headers: { 'content-type': 'text/markdown' } })), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/docs/`, readme('/docs/', '%E0%A4%A.md')), null)
  })

  test('a site, a file and the raw listing show as before', () => {
    // A JSON file is a file.
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/data.json`, listing({
      body: '[1, 2]',
      headers: { 'content-type': 'application/json', link: `<hyper://${Z32}/data.json>; rel="canonical"` }
    })), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/data.json`, listing({ headers: { 'content-type': 'application/json' } })), null)
    // ?raw keeps the list of names reachable, and so does hypercore-fetch's
    // own ?noResolve.
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/photos/?raw`, listing()), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/photos/?noResolve`, listing()), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/photos/?noResolve&raw=1`, listing()), null)
    assert.equal(isRawListingUrl(`hyper://${Z32}/photos/?raw`), true)
    assert.equal(isRawListingUrl(`hyper://${Z32}/photos/?draw`), false)
    // A failure, a download and media go their own ways.
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/photos/`, listing({ ok: false })), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/a.zip`, listing({ downloadUrl: 'http://127.0.0.1:1/asset' })), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/a.jpg`, listing({ mediaUrl: 'http://127.0.0.1:1/asset' })), null)
    assert.equal(getFolderViewerRedirect(`hyper://${Z32}/photos/`, listing({ body: '{"not":"a list"}' })), null)
    assert.equal(getFolderViewerRedirect('https://example.com/', listing()), null)
  })

  test('the browser sends a listed folder to the viewer, in the same tab, before drawing the list', () => {
    const app = read('app/index.tsx')
    const load = app.slice(app.indexOf('async function loadHyperBrowserUrl'), app.indexOf('function openBrowserHome'))
    assert.ok(load.indexOf('getFolderViewerRedirect(nextUrl, response)') > -1)
    assert.ok(load.indexOf('getFolderViewerRedirect(nextUrl, response)') < load.indexOf('createHyperBrowserHtml('))
    assert.ok(load.indexOf('getFolderViewerRedirect(nextUrl, response)') < load.indexOf('if (response.downloadUrl)'))
    // P2P Data's link to a drive's files opens the viewer's Files view, where
    // it used to ask for the list with noResolve.
    const storage = read('app/settings/P2PStorage.tsx')
    assert.match(storage, /viewerUrlFor\(url, \{ view: 'files', auto: false \}\) \|\| getHyperDriveListingUrl\(url\)/)
    assert.equal((storage.match(/onOpenUrl\(driveFilesUrl\((?:item|drive)\.url\)\)/g) || []).length, 2)
    assert.doesNotMatch(storage, /onOpenUrl\(getHyperDriveListingUrl/)
    assert.match(load, /openDriveViewer\(viewerUrl, shouldCommit\)/)
    // A viewer address typed, restored, or brought by a link opens it too.
    const loadUrl = app.slice(app.indexOf('async function loadBrowserUrl'), app.indexOf('async function loadRestoredBrowserUrl'))
    assert.match(loadUrl, /const viewerUrl = normalizeViewerUrl\(nextUrl\)\n {4}if \(viewerUrl\) \{\n {6}openDriveViewer\(viewerUrl\)/)
    const restore = app.slice(app.indexOf('async function loadRestoredBrowserUrl'), app.indexOf('async function loadHyperBrowserUrl'))
    assert.match(restore, /openDriveViewer\(viewerUrl, false\)/)
    assert.match(app, /getRuntimeAppFromUrl\(url\) !== null \|\| parseViewerUrl\(url\) !== null/)
    assert.match(app, /parseViewerUrl\(pendingRestoredUrl\) !== null/)
    // The viewer's moves change the tab's address in place.
    assert.match(app, /if \(entry\.url !== url\) replaceBrowserEntry\(url, entry\.source\)/)
  })
})

describe('Messages between the viewer and the app', () => {
  const message = (value) => parseDriveViewerMessage(JSON.stringify(value))

  test('route, download, open, copy and share come through cleaned', () => {
    assert.deepEqual(message({ type: 'route', url: `peersky://p2p/hyperdrive/photos/${Z32}/2024/`, title: 'Goa\n2024' }), {
      type: 'route', url: `peersky://p2p/hyperdrive/photos/${Z32}/2024/`, title: 'Goa2024'
    })
    assert.deepEqual(message({ type: 'route', url: `peersky://p2p/hyperdrive/photos/${Z32}/2024/` }).title, '2024')
    assert.deepEqual(message({ type: 'download', url: `hyper://${Z32}/2024/IMG_1.jpg`, name: 'IMG_1.jpg' }), {
      type: 'download', url: `hyper://${Z32}/2024/IMG_1.jpg`, name: 'IMG_1.jpg'
    })
    assert.equal(message({ type: 'download', url: `hyper://${Z32}/2024/My%20Photo.jpg` }).name, 'My Photo.jpg')
    assert.deepEqual(message({ type: 'open', url: `hyper://${Z32}/site/` }), { type: 'open', url: `hyper://${Z32}/site/` })
    assert.deepEqual(message({ type: 'open', url: 'https://example.com/a' }), { type: 'open', url: 'https://example.com/a' })
    assert.deepEqual(message({ type: 'copy', text: `hyper://${Z32}/a.jpg` }), { type: 'copy', text: `hyper://${Z32}/a.jpg` })
    assert.deepEqual(message({ type: 'share', url: `hyper://${Z32}/a.jpg`, name: 'a.jpg' }), { type: 'share', url: `hyper://${Z32}/a.jpg`, name: 'a.jpg' })
  })

  test('anything else is dropped', () => {
    for (const value of [
      { type: 'route', url: `hyper://${Z32}/` },
      { type: 'route', url: 'https://example.com/' },
      { type: 'download', url: `hyper://${Z32}/folder/` },
      { type: 'download', url: `hyper://${Z32}` },
      { type: 'download', url: 'https://example.com/a.jpg' },
      { type: 'open', url: 'javascript:alert(1)' },
      { type: 'open', url: 'file:///etc/passwd' },
      { type: 'open', url: 'peersky://p2p/peerchat/' },
      { type: 'open', url: 'https://exa mple.com/' },
      { type: 'open', url: `hyper://${Z32}/a b.jpg` },
      { type: 'copy', text: '' },
      { type: 'copy', text: 'x'.repeat(20000) },
      { type: 'share', url: 'https://example.com/' },
      { type: 'eval', code: '1' },
      null,
      []
    ]) {
      assert.equal(message(value), null, JSON.stringify(value).slice(0, 80))
    }
    assert.equal(parseDriveViewerMessage('{not json'), null)
    assert.equal(parseDriveViewerMessage(JSON.stringify({ type: 'copy', text: 'x'.repeat(70 * 1024) })), null)
    assert.equal(parseDriveViewerMessage({ type: 'copy', text: 'x' }), null)
  })

  test('only the viewer\'s own origin is listened to, and only its pages load in its WebView', () => {
    // iOS says which page, Android only the origin.
    assert.equal(isDriveViewerOrigin(`${LOCAL}/hyperdrive/photos/${Z32}/`, LOCAL), true)
    assert.equal(isDriveViewerOrigin(LOCAL, `${LOCAL}/`), true)
    assert.equal(isDriveViewerOrigin('HTTP://127.0.0.1:47318/x', LOCAL), true)
    for (const url of [
      'http://127.0.0.1:47317/',
      'http://localhost:47318/',
      'https://127.0.0.1:47318/',
      'http://evil@127.0.0.1:47318/',
      'http://127.0.0.1:47318.evil.com/',
      `hyper://${Z32}/`,
      'about:blank',
      '',
      null
    ]) {
      assert.equal(isDriveViewerOrigin(url, LOCAL), false, String(url))
    }

    assert.equal(isDriveViewerPageRequest(`${LOCAL}/hyperdrive/videos/${Z32}/#item=/x.mkv`, LOCAL), true)
    assert.equal(isDriveViewerPageRequest('about:blank', LOCAL), true)
    // A drive's file, or the listing, never takes the viewer's place.
    assert.equal(isDriveViewerPageRequest(`${LOCAL}/hyper/asset?url=hyper%3A%2F%2Fx%2Fevil.html`, LOCAL), false)
    assert.equal(isDriveViewerPageRequest(`${LOCAL}/api/list?url=x`, LOCAL), false)
    assert.equal(isDriveViewerPageRequest(`${LOCAL}/hyperdrive/viewer/app.js`, LOCAL), false)
    assert.equal(isDriveViewerPageRequest(`https://example.com/hyperdrive/files/${Z32}/`, LOCAL), false)
  })

  test('a download goes through the viewer\'s server, and a retry finds the file and its name in it', () => {
    // As signViewerDownload in the backend writes one.
    const file = `hyper://${Z32}/2024/IMG%201.jpg`
    const url = `${LOCAL}/hyper/asset?url=${encodeURIComponent(file)}&download=1&name=IMG%201.jpg&sig=${'5'.repeat(64)}`
    assert.equal(isDriveViewerDownloadUrl(url), true)
    assert.equal(getProxiedHyperUrl(url), file)
    // A retry asks the server to sign the same download again.
    assert.deepEqual(parseDriveViewerDownloadUrl(url), { url: file, name: 'IMG 1.jpg' })
    assert.deepEqual(parseDriveViewerDownloadUrl(`${LOCAL}/hyper/asset?url=${encodeURIComponent(file)}&download=1`), { url: file, name: '' })
    assert.equal(parseDriveViewerDownloadUrl(`${LOCAL}/hyper/asset?url=${encodeURIComponent(file)}`), null)
    assert.equal(parseDriveViewerDownloadUrl(`${LOCAL}/hyper/asset?url=${encodeURIComponent('https://example.com/a.jpg')}&download=1`), null)
    assert.equal(isDriveViewerDownloadUrl(`${LOCAL}/hyperdrive/files/${Z32}/`), false)
    assert.equal(isDriveViewerDownloadUrl('http://127.0.0.1:47317/hyper/asset?url=x'), false)
    assert.equal(DRIVE_VIEWER_LOCAL_URL, LOCAL)
  })

  test('the viewer is told the platform, the language, its strings, the theme, incognito and the epoch before it runs', () => {
    assert.deepEqual(createDriveViewerConfig({ platform: 'ios', language: 'mr', strings: { Photos: 'फोटो' }, dark: true, incognito: true, epoch: 1760400000000, token: TOKEN }), {
      platform: 'ios',
      language: 'mr',
      strings: { Photos: 'फोटो' },
      dark: true,
      incognito: true,
      epoch: 1760400000000,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      token: TOKEN
    })
    assert.deepEqual(createDriveViewerConfig({ platform: 'web', epoch: -1, token: 'not a secret' }), {
      platform: 'android', language: 'en', strings: {}, dark: false, incognito: false, epoch: 0, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, token: ''
    })

    const script = createDriveViewerConfigScript({ platform: 'android', language: 'ar', strings: { 'A\u2028B': 'C\u2029D' }, dark: false, incognito: false, epoch: 3, token: TOKEN }, { localUrl: `${LOCAL}/` })
    assert.doesNotMatch(script, /[\u2028\u2029]/)
    const window = { location: { origin: LOCAL } }
    // eslint-disable-next-line no-new-func
    new Function('window', script)(window)
    assert.deepEqual(window.peerskyViewer.strings, { 'A\u2028B': 'C\u2029D' })
    assert.equal(window.peerskyViewer.epoch, 3)
    assert.equal(window.peerskyViewer.token, TOKEN)

    // On any other page the script sets nothing, so the secret goes nowhere else.
    for (const origin of ['http://127.0.0.1:47317', 'https://example.com', 'null']) {
      const other = { location: { origin } }
      // eslint-disable-next-line no-new-func
      new Function('window', script)(other)
      assert.equal(other.peerskyViewer, undefined, origin)
    }
  })

  test('this run\'s secret goes to the viewer\'s page alone: never the address bar, the clipboard, a tab or the share sheet', () => {
    assert.equal(isRunToken(TOKEN), true)
    assert.equal(isRunToken(TOKEN.toUpperCase()), false)
    assert.equal(isRunToken('abc'), false)

    const secret = { secret: TOKEN }
    const message = (value, options = secret) => parseDriveViewerMessage(JSON.stringify(value), options)
    const route = `peersky://p2p/hyperdrive/photos/${Z32}/2024/`

    // A message that carries it is refused whole.
    for (const value of [
      { type: 'route', url: `${route}?token=${TOKEN}` },
      { type: 'route', url: `${route}#item=/a.jpg&token=${TOKEN}` },
      { type: 'route', url: route, title: TOKEN },
      { type: 'download', url: `hyper://${Z32}/a.jpg?token=${TOKEN}`, name: 'a.jpg' },
      { type: 'open', url: `${LOCAL}/hyper/asset?url=${encodeURIComponent(`hyper://${Z32}/a.jpg`)}&token=${TOKEN}` },
      { type: 'open', url: `https://example.com/?t=${TOKEN.toUpperCase()}` },
      { type: 'copy', text: `${LOCAL}/api/list?token=${TOKEN}` },
      { type: 'share', url: `hyper://${Z32}/a.jpg`, name: TOKEN }
    ]) {
      assert.equal(message(value), null, JSON.stringify(value).slice(0, 90))
    }
    // Escaped in the JSON, it is still the secret.
    const escaped = Array.from(TOKEN, (character) => `\\u00${character.charCodeAt(0).toString(16)}`).join('')
    assert.equal(parseDriveViewerMessage(`{"type":"copy","text":"${escaped}"}`, secret), null)

    // The same messages without it go through, as before.
    assert.deepEqual(message({ type: 'route', url: route, title: '2024' }), { type: 'route', url: route, title: '2024' })
    assert.deepEqual(message({ type: 'copy', text: `hyper://${Z32}/a.jpg` }), { type: 'copy', text: `hyper://${Z32}/a.jpg` })

    // Even unchecked, a query on a viewer address never reaches the address bar.
    assert.equal(message({ type: 'route', url: `${route}?auto&token=${TOKEN}` }, {}).url, `${route}?auto`)
    assert.ok(!createDriveViewerPageUrl(LOCAL, `${route}?token=${TOKEN}`).includes(TOKEN))
  })

  test('the app keeps the secret to the viewer\'s page, and has the server sign downloads', () => {
    const screen = read('app/hyperdrive/DriveViewerScreen.tsx')
    // In the config script, and as what nothing sent out may carry.
    assert.match(screen, /epoch,\n {4}token\n {2}\}, \{ localUrl: localUrl \|\| undefined \}\)/)
    assert.match(screen, /parseDriveViewerMessage\(event\.nativeEvent\.data, \{ secret: token \}\)/)
    assert.match(screen, /parseDriveViewerMessage\(JSON\.stringify\(\{ type: 'open', url: targetUrl \}\), \{ secret: token \}\)/)
    // A server started again, with a new secret, loads the viewer again.
    assert.match(screen, /\$\{server\?\.run \|\| 0\}/)
    // Never in a tab's address, its history, a download, a share or the
    // clipboard: the app only keeps it, to hand it to the page.
    const app = read('app/index.tsx')
    const start = app.slice(app.indexOf('async function ensureDriveViewerServer'), app.indexOf('function onDriveViewerRoute'))
    const lines = start.split('\n').filter((text) => /\.token\b/.test(text))
    assert.equal(lines.length, 3)
    for (const line of lines) {
      assert.match(line, /isRunToken\(response\.token\)|token: String\(response\.token\)|current\.token === running\.token/, line.trim())
    }
    assert.doesNotMatch(app, /driveViewerServer\??\.token/)
    assert.match(app, /server=\{driveViewerServer\}/)
    // A download, and a retry of one, is signed by the server for its file.
    const download = app.slice(app.indexOf('async function onDriveViewerDownload'), app.indexOf('function showBrowserError'))
    assert.doesNotMatch(download, /token/i)
    assert.match(download, /callRpc\(RPC_HYPERDRIVE_VIEWER_DOWNLOAD, \{ url: hyperUrl, name \}\)/)
    assert.match(download, /startBrowserDownload\(response\.downloadUrl, tabId\)/)
    const retry = app.slice(app.indexOf('async function retryBrowserDownload'), app.indexOf('async function openHyperdriveItem'))
    assert.doesNotMatch(retry, /token/i)
    assert.match(retry, /parseDriveViewerDownloadUrl\(retryUrl\)/)
    assert.match(retry, /callRpc\(RPC_HYPERDRIVE_VIEWER_DOWNLOAD, viewerDownload\)/)
    // The server never says it either.
    assert.doesNotMatch(read('backend/hyperdrive-viewer/server.mjs'), /console\.\w+\([^)]*token/)
  })

  test('the viewer gets only its own strings from the catalog in force', () => {
    assert.deepEqual(viewerStringKeys({ strings: ['Photos', 'Videos'], plurals: [{ one: '{count} photo', other: '{count} photos' }] }), ['Photos', 'Videos', '{count} photos'])
    assert.deepEqual(viewerStringKeys(null), [])

    registerCatalogs({
      de: () => ({
        Photos: 'Fotos',
        Save: 'Speichern',
        '{count} photos': { one: '{count} Foto', other: '{count} Fotos', bad: 7 },
        Empty: ''
      })
    })
    try {
      assert.deepEqual(catalogEntries(['Photos', '{count} photos']), {})
      setLanguage('de')
      assert.deepEqual(catalogEntries(['Photos', '{count} photos', 'Empty', 'Missing', 'constructor']), {
        Photos: 'Fotos',
        '{count} photos': { one: '{count} Foto', other: '{count} Fotos' }
      })
    } finally {
      setLanguage('en')
    }
  })

  test('the screen hands the viewer that config, and listens to its origin only', () => {
    const screen = read('app/hyperdrive/DriveViewerScreen.tsx')
    assert.match(screen, /import viewerStrings from '\.\.\/i18n\/viewer-strings\.json'/)
    assert.match(screen, /strings: catalogEntries\(VIEWER_STRING_KEYS\)/)
    assert.match(screen, /injectedJavaScriptBeforeContentLoaded=\{configScript\}/)
    assert.match(screen, /if \(!isDriveViewerOrigin\(event\.nativeEvent\.url, localUrl\)\) return\n {8}const message = parseDriveViewerMessage\(event\.nativeEvent\.data, \{ secret: token \}\)/)
    assert.match(screen, /if \(isDriveViewerPageRequest\(request\.url, localUrl\)\) return true/)
    // Android's incognito prop empties every tab's cookies.
    assert.match(screen, /incognito=\{Platform\.OS === 'ios' && incognito\}/)
    assert.match(screen, /cacheEnabled=\{false\}/)
  })
})

describe('The viewer\'s cache epoch', () => {
  test('is a browser preference, none until the viewer first opens', () => {
    assert.equal(parseBrowserPreferences({}).hyperdriveViewerEpoch, 0)
    assert.equal(parseBrowserPreferences({ hyperdriveViewerEpoch: 1760400000000 }).hyperdriveViewerEpoch, 1760400000000)
    for (const value of [-5, 1.5, '17', null, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(parseBrowserPreferences({ hyperdriveViewerEpoch: value }).hyperdriveViewerEpoch, 0, String(value))
    }
  })

  test('moves on to a value it never had before', () => {
    assert.equal(nextHyperdriveViewerEpoch(0, 1760400000000), 1760400000000)
    // A clock set back still moves it forward.
    assert.equal(nextHyperdriveViewerEpoch(1760400000000, 1700000000000), 1760400000001)
    assert.equal(nextHyperdriveViewerEpoch('x', 5.7), 5)
    assert.ok(nextHyperdriveViewerEpoch(0) > 1700000000000)
  })

  test('moves on with Burn, Clear all P2P data, Remove my data and a restore', () => {
    const app = read('app/index.tsx')
    const burn = app.slice(app.indexOf('function burnBrowserTabs'), app.indexOf('function onBrowserCloseAllTabs'))
    assert.match(burn, /bumpHyperdriveViewerEpoch\(\)/)
    // Clear all P2P data, Remove my data and a restore all put up the restart
    // screen first.
    assert.match(app, /onRestartRequired=\{\(\) => \{[^}]*setRestartRequired\(true\)[\s\S]{0,300}bumpHyperdriveViewerEpoch\(\)\n {12}\}\}/)
    assert.match(read('app/settings/P2PStorage.tsx'), /onRestartRequired\(\)\n[\s\S]{0,120}clearChatFileCopies\(\)\n[\s\S]{0,80}RPC_HYPER_STORAGE_CLEAR_ALL/)
    const linkDevice = read('app/settings/LinkDevice.tsx')
    assert.match(linkDevice, /onRestartRequired\(\)/)
    assert.match(linkDevice, /if \(command === RPC_IDENTITY_CONFIRM_RESTORE\) bumpSavedHyperdriveViewerEpoch\(\)/)
    assert.match(linkDevice, /replaceData\(RPC_IDENTITY_REMOVE/)
    assert.match(linkDevice, /replaceData\(RPC_IDENTITY_CONFIRM_RESTORE/)
    // A phone with no epoch, as Remove my data leaves it, gets one before the
    // viewer opens.
    assert.match(app, /if \(browserPreferencesReady && !browserPreferences\.hyperdriveViewerEpoch\) bumpHyperdriveViewerEpoch\(\)/)
    assert.match(app, /epoch=\{browserPreferences\.hyperdriveViewerEpoch\}/)
    const hook = read('app/settings/useBrowserPreferences.ts')
    assert.match(hook, /hyperdriveViewerEpoch: nextHyperdriveViewerEpoch\(preferencesRef\.current\.hyperdriveViewerEpoch\)/)
    assert.match(hook, /hyperdriveViewerEpoch: nextHyperdriveViewerEpoch\(saved\.hyperdriveViewerEpoch\)/)
  })
})

describe('The viewer\'s files and strings in the app', () => {
  test('backend/hyperdrive-viewer/viewer-runtime.mjs is what assets/hyperdrive-viewer makes', async () => {
    assert.equal(read('backend/hyperdrive-viewer/viewer-runtime.mjs'), await buildViewerRuntime(), 'run npm run generate:hyperdrive-viewer-runtime')
    const { default: assets } = await import('../../backend/hyperdrive-viewer/viewer-runtime.mjs')
    const files = []
    const walk = (dir, prefix = '') => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`)
        else if (!['LICENSE', 'NOTICE'].includes(entry.name) && !entry.name.endsWith('.md')) files.push(`${prefix}${entry.name}`)
      }
    }
    walk(sourceDir)
    assert.deepEqual(Object.keys(assets).sort(), files.sort())
  })

  test('the runtime keeps text as text and anything else as base64, in a fixed order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'viewer-runtime-'))
    try {
      mkdirSync(join(dir, 'lib'))
      mkdirSync(join(dir, 'data'))
      writeFileSync(join(dir, 'index.html'), '<!doctype html>')
      writeFileSync(join(dir, 'lib', 'b.js'), 'export {}')
      writeFileSync(join(dir, 'lib', 'a.js'), 'export {}')
      writeFileSync(join(dir, 'icon.png'), Buffer.from([1, 2, 3]))
      writeFileSync(join(dir, 'data', 'NOTICE'), 'credits')
      writeFileSync(join(dir, 'VIEWER-API.md'), '# Writing a view')
      writeFileSync(join(dir, '.DS_Store'), 'x')
      const source = await buildViewerRuntime(dir)
      const assets = JSON.parse(/const viewerAssets = (.*)\n/.exec(source)[1])
      assert.deepEqual(Object.keys(assets), ['icon.png', 'index.html', 'lib/a.js', 'lib/b.js'])
      assert.deepEqual(assets['icon.png'], { encoding: 'base64', content: 'AQID' })
      assert.deepEqual(assets['index.html'], { encoding: 'utf8', content: '<!doctype html>' })
      assert.equal(await buildViewerRuntime(dir), source)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the sync says which of the files the viewer loads are not in the copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'viewer-missing-'))
    try {
      mkdirSync(join(dir, 'lib'))
      writeFileSync(join(dir, 'index.html'), '<link rel="stylesheet" href="/hyperdrive/viewer/style.css" /><script type="module" src="/hyperdrive/viewer/app.js"></script>')
      writeFileSync(join(dir, 'app.js'), "import { a } from '/hyperdrive/viewer/lib/a.js'\nimport { b } from '/hyperdrive/viewer/lib/b.js'\n")
      writeFileSync(join(dir, 'style.css'), "body { background: url('/hyperdrive/viewer/icons/x.svg') }")
      writeFileSync(join(dir, 'lib', 'a.js'), 'export const a = 1')
      assert.deepEqual(await missingViewerFiles(dir), ['icons/x.svg', 'lib/b.js'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the Bare bundle carries the viewer, and the linter leaves the copy alone', () => {
    const pkg = json('package.json')
    assert.match(pkg.scripts['bundle:bare'], /npm run generate:hyperdrive-viewer-runtime && bare-pack/)
    assert.equal(pkg.scripts['generate:hyperdrive-viewer-runtime'], 'node scripts/generate-hyperdrive-viewer-runtime.mjs')
    assert.ok(pkg.standard.ignore.includes('assets/hyperdrive-viewer/**'))
    assert.ok(pkg.standard.ignore.includes('backend/hyperdrive-viewer/viewer-runtime.mjs'))
    const router = read('backend/rpc/router.mjs')
    assert.match(router, /if \(req\.command === RPC_HYPERDRIVE_VIEWER_START\) \{\n {6}replyJson\(req, await startHyperdriveViewerServer\(\)\)/)
    assert.match(router, /if \(req\.command === RPC_HYPERDRIVE_VIEWER_DOWNLOAD\) \{\n {6}replyJson\(req, await createHyperdriveViewerDownload\(parseJsonMessage\(req\.data\)\)\)/)
    const main = read('backend/main.mjs')
    assert.match(main, /await stopHyperdriveViewerServer\(\)/)
    assert.match(main, /console\.error\('\[hyperdrive viewer\] Failed to stop the loopback server on beforeExit:'/)
  })

  test('the scanner reads the viewer\'s t(), tp() and msg() when a file imports its i18n.js', () => {
    for (const from of ["'/hyperdrive/viewer/i18n.js'", "'./i18n.js'", "'../i18n.js'"]) {
      const head = `import { t, tp, msg } from ${from}\n`
      assert.match(head, VIEWER_I18N_IMPORT, from)
      const found = scanSource(head + [
        "t('Photos')",
        "tp({ one: '{count} photo', other: '{count} photos' }, n)",
        "msg('Albums')",
        "el.textContent = t('Try again')"
      ].join('\n'), 'assets/hyperdrive-viewer/ui.js', { viewer: true })
      assert.deepEqual(found.strings, ['Photos', 'Albums', 'Try again'], from)
      assert.deepEqual(found.plurals, [{ one: '{count} photo', other: '{count} photos' }], from)
      assert.deepEqual(found.problems, [], from)
    }

    const bad = scanSource("import { t } from '/hyperdrive/viewer/i18n.js'\nt('Hello ' + name)", 'assets/hyperdrive-viewer/ui.js', { viewer: true })
    assert.equal(bad.problems.length, 1)
    assert.match(bad.problems[0], /^assets\/hyperdrive-viewer\/ui\.js:2 /)

    // The app's import does not count in the viewer, nor the viewer's in the app.
    assert.deepEqual(scanSource("import { t } from '../i18n/i18n.mjs'\nt('x')", 'v.js', { viewer: true }).strings, [])
    assert.deepEqual(scanSource("import { t } from '/hyperdrive/viewer/i18n.js'\nt('x')", 'a.tsx').strings, [])
  })

  // The viewer's own notes say how to call t('...'), and a note is not a call.
  test('the scanner skips comments, and keeps strings, templates and regular expressions whole', () => {
    const head = "import { t } from '/hyperdrive/viewer/i18n.js'\n"
    const found = scanSource(head + [
      "// Call them as plain t('...') with one string literal",
      '/* t(text, values), tp({ one, other }, count) */',
      "const a = t('Photos') // t('Not this')",
      "const url = 'https://example.com/' + t('Videos')",
      "const re = /\\/\\//g; const b = t('Albums')",
      // A template, put together here so the linter does not take it for one.
      'const tpl = `// $' + "{t('Places')}`",
      "return /t\\('x'\\)/.test(s) ? t('Files') : x / 2 / t('Size')"
    ].join('\n'), 'assets/hyperdrive-viewer/app.js', { viewer: true })
    assert.deepEqual(found.problems, [])
    assert.deepEqual(found.strings, ['Photos', 'Videos', 'Albums', 'Places', 'Files', 'Size'])

    // Every character keeps its place, so line numbers still point right.
    const source = 'a // b\n/* c\nd */ e'
    assert.equal(withoutComments(source), 'a     \n    \n     e')
    for (const file of viewerSourceFiles()) {
      const text = readFileSync(file, 'utf8')
      assert.equal(withoutComments(text).length, text.length, file)
    }
  })

  test('viewer-strings.json lists what the viewer shows, and strings.json has it too', () => {
    const files = viewerSourceFiles()
    assert.ok(files.every((file) => !file.includes(`${join('hyperdrive-viewer', 'data')}`)))
    const viewer = collectViewerStrings()
    assert.deepEqual(viewer.problems, [])
    assert.deepEqual(json('app/i18n/viewer-strings.json'), { strings: viewer.strings, plurals: viewer.plurals }, 'run node scripts/i18n.mjs --write')
    const all = collectStrings()
    for (const text of viewer.strings) assert.ok(all.strings.includes(text), text)
    for (const forms of viewer.plurals) assert.ok(all.plurals.some((item) => item.other === forms.other), forms.other)
  })
})
