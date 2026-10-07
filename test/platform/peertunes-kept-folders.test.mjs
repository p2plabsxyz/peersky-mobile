import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import {
  PEERTUNES_SCAN_BRIDGE_SCRIPT,
  keptFolderUrls,
  parsePeerTunesKeptFoldersRequest
} from '../../app/peertunes/peertunes-screen.mjs'

const require = createRequire(import.meta.url)
const { Library } = require('../../assets/peertunes/js/library.js')
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// Removing a folder in Settings, P2P Data takes the songs PeerTunes read from
// it out of PeerTunes. Before, they stayed listed with nothing behind them.
test('PeerTunes forgets a folder that was kept and no longer is', async (t) => {
  const asked = []
  globalThis.window = {
    peerskyKeptFolders: async (urls) => {
      asked.push(urls)
      return { ok: true, kept: urls.filter((url) => url !== 'hyper://c/removed/' && url !== 'hyper://d/never-kept/') }
    }
  }
  t.after(() => { delete globalThis.window })
  const lib = {
    sources: [
      { url: 'hyper://a/kept/', kept: true },
      { url: 'hyper://b/new/' },
      { url: 'hyper://c/removed/', kept: true },
      { url: 'hyper://d/never-kept/' },
      { url: 'https://example.com/songs/' }
    ],
    marked: [],
    forgotten: [],
    async _markKept (source) { source.kept = true; this.marked.push(source.url) },
    async forgetSource (url) { this.forgotten.push(url); return 3 }
  }
  assert.equal(await Library.prototype.syncKeptSources.call(lib), 3)
  assert.deepEqual(asked[0], ['hyper://a/kept/', 'hyper://b/new/', 'hyper://c/removed/', 'hyper://d/never-kept/'])
  assert.deepEqual(lib.forgotten, ['hyper://c/removed/'])
  // Kept now, so a later removal counts. One never kept is left alone.
  assert.deepEqual(lib.marked, ['hyper://b/new/'])
})

test('PeerTunes keeps every song when the host cannot say or is not PeerSky', async (t) => {
  t.after(() => { delete globalThis.window })
  const lib = {
    sources: [{ url: 'hyper://c/removed/', kept: true }],
    async _markKept () { throw new Error('not expected') },
    async forgetSource () { throw new Error('not expected') }
  }
  globalThis.window = {}
  assert.equal(await Library.prototype.syncKeptSources.call(lib), 0)
  globalThis.window = { peerskyKeptFolders: async () => ({ ok: false, error: 'busy' }) }
  assert.equal(await Library.prototype.syncKeptSources.call(lib), 0)
  globalThis.window = { peerskyKeptFolders: async () => { throw new Error('gone') } }
  assert.equal(await Library.prototype.syncKeptSources.call(lib), 0)
})

// Marked as soon as PeerSky keeps it, so removing it straight after, with
// PeerTunes still open, takes its songs too.
test('a folder counts as kept the moment PeerSky says it keeps it', async () => {
  const lib = {
    sources: [{ url: 'hyper://a/music/' }],
    marked: [],
    async _markKept (source) { source.kept = true; this.marked.push(source.url) }
  }
  await Library.prototype.markSourceKept.call(lib, 'hyper://a/music/')
  await Library.prototype.markSourceKept.call(lib, 'hyper://a/music/')
  await Library.prototype.markSourceKept.call(lib, 'hyper://unknown/')
  assert.deepEqual(lib.marked, ['hyper://a/music/'])
  const library = await read('assets/peertunes/js/library.js')
  assert.match(library, /\.then\(\(kept\) => \(kept && kept\.ok \? this\.markSourceKept\(url\) : null\)\)/)
  const ui = await read('assets/peertunes/js/ui.js')
  assert.match(ui, /if \(res && res\.ok\) \{\n {8}this\.lib\.markSourceKept\(url\)/)
})

test('forgetting a folder removes its songs and its empty playlist only', async () => {
  const lib = {
    tracks: new Map([
      ['1', { id: '1', kind: 'url', url: 'hyper://c/y/song.mp3' }],
      ['2', { id: '2', kind: 'url', url: 'hyper://c/yz/other.mp3' }],
      ['3', { id: '3', kind: 'file' }],
      ['4', { id: '4', kind: 'url', url: 'hyper://c/y/disc/two.mp3' }]
    ]),
    playlists: new Map([
      ['p1', { id: 'p1', sourceUrl: 'hyper://c/y/', trackIds: [] }],
      ['p2', { id: 'p2', sourceUrl: 'hyper://c/y/', trackIds: ['3'] }]
    ]),
    deleted: [],
    droppedPlaylists: [],
    droppedSources: [],
    async deleteTrack (id) { this.deleted.push(id); this.tracks.delete(id); return true },
    async deletePlaylist (id) { this.droppedPlaylists.push(id) },
    async _dropSource (url) { this.droppedSources.push(url) }
  }
  assert.equal(await Library.prototype.forgetSource.call(lib, 'hyper://c/y/'), 2)
  assert.deepEqual(lib.deleted, ['1', '4'])
  assert.deepEqual(lib.droppedPlaylists, ['p1'])
  assert.deepEqual(lib.droppedSources, ['hyper://c/y/'])
})

test('the host reports which of the page folders are still kept', () => {
  const items = [{ driveKey: 'AbC123', path: '/music/' }, { driveKey: 'f00', path: '/' }]
  assert.deepEqual(keptFolderUrls([
    'hyper://abc123/music/',
    'hyper://abc123/music/album/',
    'hyper://ABC123/music',
    'hyper://abc123/other/',
    'hyper://f00/anything/',
    'hyper://zzz/music/'
  ], items), ['hyper://abc123/music/', 'hyper://abc123/music/album/', 'hyper://ABC123/music', 'hyper://f00/anything/'])
  assert.deepEqual(keptFolderUrls(['hyper://abc123/music/'], null), [])
  assert.deepEqual(keptFolderUrls(['hyper://abc123/music/'], [{ path: '/music/' }]), [])
})

test('only a well formed folder check is read', () => {
  const ok = parsePeerTunesKeptFoldersRequest(JSON.stringify({
    type: 'peertunes-kept-folders',
    requestId: 'kept-123-abc',
    urls: ['hyper://a/', 'https://x/', 7, 'hyper://' + 'x'.repeat(3000)]
  }))
  assert.deepEqual(ok, { requestId: 'kept-123-abc', urls: ['hyper://a/'] })
  assert.equal(parsePeerTunesKeptFoldersRequest(JSON.stringify({ type: 'peertunes-kept-folders', requestId: 'scan-1', urls: [] })), null)
  assert.equal(parsePeerTunesKeptFoldersRequest(JSON.stringify({ type: 'peertunes-kept-folders', requestId: 'kept-1' })), null)
  assert.equal(parsePeerTunesKeptFoldersRequest('{"type":"peertunes-keep-offline"}'), null)
  assert.equal(parsePeerTunesKeptFoldersRequest('not json'), null)
})

// The page's reply channel turned every object into null, so Keep On This
// Device always said it could not, though the download had started.
test('the page gets objects back from keep and folder checks, and text from a scan', async () => {
  const sent = []
  const window = { ReactNativeWebView: { postMessage: (message) => sent.push(JSON.parse(message)) } }
  vm.runInNewContext(PEERTUNES_SCAN_BRIDGE_SCRIPT, { window })
  const keep = window.peerskyKeepOffline('hyper://a/music/')
  window.__peerskyResolveScan(sent[0].requestId, { ok: true, status: 'downloading' })
  assert.deepEqual({ ...await keep }, { ok: true, status: 'downloading' })

  const kept = window.peerskyKeptFolders(['hyper://a/music/'])
  assert.deepEqual(sent[1].urls, ['hyper://a/music/'])
  assert.equal(sent[1].type, 'peertunes-kept-folders')
  window.__peerskyResolveScan(sent[1].requestId, { ok: true, kept: ['hyper://a/music/'] })
  assert.deepEqual([...(await kept).kept], ['hyper://a/music/'])

  const scan = window.peerskyScanQr()
  window.__peerskyResolveScan(sent[2].requestId, 'hyper://scanned/')
  assert.equal(await scan, 'hyper://scanned/')
  const empty = window.peerskyScanQr()
  window.__peerskyResolveScan(sent[3].requestId, '')
  assert.equal(await empty, null)
})

test('PeerTunes checks its folders at start and when the app says folders changed', async () => {
  const main = await read('assets/peertunes/js/main.js')
  assert.match(main, /ui\.replaceAll\(ui\.rootScreen\(\)\);\n[\s\S]{0,200}PT\.syncKeptFolders\(\);/)
  assert.match(main, /PT\.syncKeptFolders = \(\) => library\.syncKeptSources\(\)/)
  const screen = await read('app/peertunes/PeerTunesScreen.tsx')
  assert.match(screen, /parsePeerTunesKeptFoldersRequest\(event\.nativeEvent\.data\)/)
  assert.match(screen, /answer = await onKeptFolders\(urls\)/)
  assert.match(screen, /window\.PT\.syncKeptFolders\(\)/)
  const index = await read('app/index.tsx')
  assert.match(index, /onKeptFolders=\{peerTunesKeptFolders\}/)
  assert.match(index, /offlineFoldersVersion=\{offlineFoldersVersion\}/)
})

// Deleting P2PMD's data in Settings, P2P Data left its Recent notes pointing
// at notes that were gone, and an open Hyperdrive screen kept showing its
// cleared recents until it was reopened.
test('deleting app data in P2P Data clears the lists that pointed at it', async () => {
  const storage = await read('app/settings/P2PStorage.tsx')
  assert.match(storage, /item\.id === 'p2pmd' && !onP2pmdDataDeleted\(\)/)
  assert.match(storage, /if \(command === RPC_HYPER_OFFLINE_REMOVE\) onOfflineFoldersChanged\(\)/)
  const clearAll = storage.slice(storage.indexOf('async function clearAllData'), storage.indexOf('async function refreshArchive'))
  assert.match(clearAll, /onOfflineFoldersChanged\(\)/)
  assert.match(clearAll, /!onP2pmdDataDeleted\(\)/)

  const settings = await read('app/settings/SettingsScreen.tsx')
  assert.match(settings, /onP2pmdDataDeleted=\{props\.onP2pmdDataDeleted\}/)
  assert.match(settings, /onOfflineFoldersChanged=\{props\.onOfflineFoldersChanged\}/)

  const index = await read('app/index.tsx')
  assert.match(index, /function forgetP2pmdRecents \(\) \{\n {4}if \(!saveP2pmdRoomHistory\(\[\]\)\) return false\n {4}p2pmdRoomHistoryRef\.current = \[\]\n {4}setP2pmdRoomHistory\(\[\]\)/)
  assert.match(index, /onP2pmdDataDeleted=\{forgetP2pmdRecents\}/)

  const store = await read('app/hyperdrive/recents-store.ts')
  assert.match(store, /if \(cleared\) for \(const listener of clearedListeners\) listener\(\)/)
  const hyperdrive = await read('app/hyperdrive/HyperdriveScreen.tsx')
  assert.match(hyperdrive, /onHyperdriveRecentsCleared\(\(\) => setRecents\(loadHyperdriveRecents\(\)\)\)/)
})
