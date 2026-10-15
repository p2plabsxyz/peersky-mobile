import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import b4a from 'b4a'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'

import { createLoopbackToken } from '../../backend/loopback-request.mjs'
import { HYPER_BRIDGE_SCRIPT, KEEP_SONGS_HEADER, createPeerTunesHttpServer } from '../../backend/peertunes/server.mjs'
import { MAX_KEEP_DRIVES, MAX_KEEP_SONGS_PER_REQUEST, createSongKeeper, songState, within } from '../../backend/peertunes/song-keeper.mjs'

// PeerTunes keeps a shared playlist on the phone song by song. A laptop that
// shared one was closed halfway and later only half the songs played, with
// nothing to say so. Each song now counts only once all of it is here, the
// rest says why, and asking again fetches what is still missing.

// A drive as the keeper sees one: entries it has, files fully here, songs
// whose first block is here, and the peers connected for it.
function fakeDrive ({ entries = [], local = [], started = [], peers = 0 } = {}) {
  const blocks = new Map(entries.map((path, index) => [path, { blockOffset: index * 10, blockLength: 10 }]))
  const startedBlocks = new Set(started.map((path) => blocks.get(path).blockOffset))
  const drive = {
    downloads: [],
    core: { peers: Array.from({ length: peers }, () => ({})) },
    blobs: { core: { peers: [], has: async (index) => startedBlocks.has(index) } },
    async entry (path, options) {
      drive.entryOptions = options
      if (!blocks.has(path)) throw new Error('BLOCK_NOT_AVAILABLE')
      return { key: path, value: { blob: blocks.get(path) } }
    },
    async getBlobs () { return drive.blobs },
    async has (path) { return local.includes(path) },
    download (path) {
      let finish
      const done = new Promise((resolve) => { finish = resolve })
      const download = { path, done: () => done, finish, destroyed: false, destroy () { download.destroyed = true; finish() } }
      drive.downloads.push(download)
      return download
    }
  }
  return drive
}

function keeperFor (drives, { now = () => 0, mayDownload } = {}) {
  const refreshed = []
  const opened = new Set()
  const keeper = createSongKeeper({
    openDrive: async (address, task) => {
      opened.add(address)
      const drive = typeof drives === 'function' ? drives(address) : drives[address]
      if (!drive) throw new Error('The drive did not open in time.')
      return task(drive)
    },
    refreshNetwork: async (url) => { refreshed.push(url) },
    mayDownload,
    now
  })
  return { keeper, refreshed, opened }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

async function waitFor (check, ms = 10000) {
  const until = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > until) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('PeerTunes song keeper', () => {
  it('calls a song saved only once all of it is on the phone', async () => {
    const drive = fakeDrive({
      entries: ['/mix/01 One.mp3', '/mix/02 Two.mp3', '/mix/03 Three.mp3'],
      local: ['/mix/01 One.mp3'],
      started: ['/mix/02 Two.mp3'],
      peers: 1
    })
    const { keeper } = keeperFor({ 'hyper://abc/': drive })
    const answer = await keeper.keep([
      'hyper://abc/mix/01%20One.mp3',
      'hyper://abc/mix/02%20Two.mp3',
      'hyper://abc/mix/03%20Three.mp3',
      'hyper://abc/mix/04%20Four.mp3'
    ])
    assert.deepEqual(answer, {
      ok: true,
      saved: ['hyper://abc/mix/01%20One.mp3'],
      // Part of it is here and someone has the rest.
      saving: ['hyper://abc/mix/02%20Two.mp3'],
      waiting: []
    })
    // Not started yet, or not even listed yet: still to come, in no list.
    // Only what is already on the phone is read for the check.
    assert.deepEqual(drive.entryOptions, { wait: false, update: false })
    assert.deepEqual(drive.downloads.map((download) => download.path).sort(), ['/mix/02 Two.mp3', '/mix/03 Three.mp3', '/mix/04 Four.mp3'])
  })

  // The laptop that shared it was closed: nobody has the rest right now.
  it('says a song waits when nobody who has it is online, and looks for them again now and then', async () => {
    let clock = 0
    const drive = fakeDrive({ entries: ['/a.mp3', '/b.mp3'], local: ['/a.mp3'], started: ['/b.mp3'], peers: 0 })
    const { keeper, refreshed } = keeperFor({ 'hyper://abc/': drive }, { now: () => clock })

    const answer = await keeper.keep(['hyper://abc/a.mp3', 'hyper://abc/b.mp3'])
    assert.deepEqual(answer.saved, ['hyper://abc/a.mp3'])
    assert.deepEqual(answer.waiting, ['hyper://abc/b.mp3'])
    await settle()
    assert.deepEqual(refreshed, ['hyper://abc/b.mp3'])

    clock = 10 * 1000
    await keeper.keep(['hyper://abc/b.mp3'])
    await settle()
    assert.equal(refreshed.length, 1, 'not on every check')

    clock = 31 * 1000
    await keeper.keep(['hyper://abc/b.mp3'])
    await settle()
    assert.equal(refreshed.length, 2)
  })

  it('fetches a missing song once at a time, and again after a try that ended short', async () => {
    const drive = fakeDrive({ entries: ['/b.mp3'], peers: 1 })
    const { keeper } = keeperFor({ 'hyper://abc/': drive })
    await keeper.keep(['hyper://abc/b.mp3'])
    await keeper.keep(['hyper://abc/b.mp3'])
    assert.equal(drive.downloads.length, 1)
    assert.equal(keeper.downloading, 1)

    drive.downloads[0].finish()
    await settle()
    assert.equal(keeper.downloading, 0)
    await keeper.keep(['hyper://abc/b.mp3'])
    assert.equal(drive.downloads.length, 2, 'still missing, so it is fetched again')
  })

  // Download only on Wi-Fi, on cellular: the folder downloads wait, and the
  // songs did not.
  it('starts nothing on cellular with Download only on Wi-Fi, stops what was going, and says the rest waits', async () => {
    let wifi = true
    const drive = fakeDrive({ entries: ['/a.mp3', '/b.mp3', '/c.mp3'], local: ['/a.mp3'], started: ['/b.mp3'], peers: 1 })
    const { keeper, refreshed } = keeperFor({ 'hyper://abc/': drive }, { mayDownload: () => wifi })
    await keeper.keep(['hyper://abc/b.mp3'])
    assert.equal(keeper.downloading, 1)

    wifi = false
    const answer = await keeper.keep(['hyper://abc/a.mp3', 'hyper://abc/b.mp3', 'hyper://abc/c.mp3'])
    assert.deepEqual(answer, { ok: true, saved: ['hyper://abc/a.mp3'], saving: [], waiting: ['hyper://abc/b.mp3', 'hyper://abc/c.mp3'] })
    assert.equal(drive.downloads[0].destroyed, true)
    assert.equal(drive.downloads.length, 1, 'nothing new started')
    assert.equal(keeper.downloading, 0)
    await settle()
    assert.deepEqual(refreshed, [], 'not even looked for')

    wifi = true
    await keeper.keep(['hyper://abc/b.mp3', 'hyper://abc/c.mp3'])
    assert.equal(drive.downloads.length, 3, 'back on Wi-Fi, both start')
  })

  it(`opens no more than ${MAX_KEEP_DRIVES} separate drives, however many a playlist names`, async () => {
    const { keeper, opened } = keeperFor((address) => fakeDrive({ entries: ['/a.mp3'], peers: 1 }))
    const songs = Array.from({ length: MAX_KEEP_DRIVES + 30 }, (_, index) => `hyper://${String(index).padStart(52, 'a')}/a.mp3`)
    for (let at = 0; at < songs.length; at += MAX_KEEP_SONGS_PER_REQUEST) await keeper.keep(songs.slice(at, at + MAX_KEEP_SONGS_PER_REQUEST))
    assert.equal(opened.size, MAX_KEEP_DRIVES)
    // One it already holds is still checked.
    await keeper.keep([songs[0]])
    assert.equal(opened.size, MAX_KEEP_DRIVES)
  })

  it('looks a song up by the name the drive stores it under', async () => {
    const drive = fakeDrive({ entries: ['/Why%3F.mp3'], local: ['/Why%3F.mp3'], peers: 1 })
    const { keeper } = keeperFor({ 'hyper://abc/': drive })
    const answer = await keeper.keep(['hyper://abc/Why%3F.mp3'])
    assert.deepEqual(answer.saved, ['hyper://abc/Why%3F.mp3'])
  })

  it('skips what is not a song in a drive, and asks about a few at a time', async () => {
    const drive = fakeDrive({ entries: [], peers: 1 })
    const { keeper } = keeperFor({ 'hyper://abc/': drive })
    const answer = await keeper.keep(['https://example.com/a.mp3', 'hyper://abc/folder/', 'hyper://abc/../x.mp3', 7, null])
    assert.deepEqual(answer, { ok: true, saved: [], saving: [], waiting: [] })
    assert.equal(drive.downloads.length, 0)

    const many = Array.from({ length: 30 }, (_, index) => `hyper://abc/${index}.mp3`)
    await keeper.keep(many)
    assert.equal(drive.downloads.length, MAX_KEEP_SONGS_PER_REQUEST)
    assert.deepEqual(await keeper.keep('nope'), { ok: true, saved: [], saving: [], waiting: [] })
  })

  it('leaves out a song whose drive would not open, rather than calling it saved', async () => {
    const { keeper } = keeperFor({})
    assert.deepEqual(await keeper.keep(['hyper://gone/a.mp3']), { ok: true, saved: [], saving: [], waiting: [] })
  })

  it('never waits on the network to say where a song stands', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const stuck = new Promise(() => {})
    const drive = {
      core: { peers: [{}] },
      blobs: null,
      entry: async () => ({ value: { blob: { blockOffset: 0, blockLength: 1 } } }),
      getBlobs: () => stuck,
      has: () => stuck
    }
    const state = songState(drive, '/a.mp3')
    await settle()
    t.mock.timers.tick(4000)
    // The header the blobs need is not here: not saved, and someone has it.
    assert.equal(await state, 'queued')
  })

  // The same checks on real drives: one that shares the songs, as a laptop
  // would, and the phone's copy of it.
  it('follows songs on a real drive as they arrive, and once the sharer is gone', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'peertunes-keep-'))
    const laptopStore = new Corestore(join(root, 'laptop'))
    const phoneStore = new Corestore(join(root, 'phone'))
    t.after(async () => {
      await Promise.allSettled([laptopStore.close(), phoneStore.close()])
      await rm(root, { recursive: true, force: true })
    })
    const laptop = new Hyperdrive(laptopStore)
    await laptop.ready()
    for (const [index, name] of ['01 One.mp3', '02 Two.mp3', '03 Three.mp3'].entries()) {
      await laptop.put(`/mix/${name}`, b4a.alloc(300 * 1024, index + 1))
    }
    const phone = new Hyperdrive(phoneStore, laptop.key)
    await phone.ready()

    // Nothing here, nobody connected.
    assert.equal(await songState(phone, '/mix/01 One.mp3'), 'waiting')

    const left = laptopStore.replicate(true)
    const right = phoneStore.replicate(false)
    left.pipe(right).pipe(left)
    await waitFor(() => phone.core.peers.length > 0)

    const { keeper } = keeperFor({ [`hyper://${b4a.toString(laptop.key, 'hex')}/`]: phone })
    const url = (name) => `hyper://${b4a.toString(laptop.key, 'hex')}/mix/${encodeURIComponent(name)}`
    // Asking starts the songs coming. Two of them make it.
    await keeper.keep([url('01 One.mp3'), url('02 Two.mp3')])
    await waitFor(async () => (await keeper.keep([url('01 One.mp3'), url('02 Two.mp3')])).saved.length === 2)
    assert.equal(await songState(phone, '/mix/02 Two.mp3'), 'saved')

    // Then the laptop is closed, before the third one came.
    left.destroy()
    right.destroy()
    await waitFor(() => phone.core.peers.length === 0)
    const answer = await keeper.keep([url('01 One.mp3'), url('03 Three.mp3')])
    assert.deepEqual(answer.saved, [url('01 One.mp3')])
    assert.deepEqual(answer.waiting, [url('03 Three.mp3')])
  })

  it('gives up on a wait after a while, and on a failure at once', async () => {
    assert.equal(await within(new Promise(() => {}), 10), undefined)
    assert.equal(await within(Promise.resolve(3), 10), 3)
    assert.equal(await within(Promise.reject(new Error('x')), 10), undefined)
  })
})

describe('PeerTunes keep endpoint', () => {
  const TOKEN = createLoopbackToken()
  // What the PeerTunes page's own fetch sends.
  const asPage = { [KEEP_SONGS_HEADER]: '1', 'Sec-Fetch-Site': 'same-origin' }
  const keepUrl = (localUrl, query, token = TOKEN) => `${localUrl}/hyper/keep?${query}${token === null ? '' : `&token=${token}`}`

  async function withServer (keepSongs, run) {
    const server = createPeerTunesHttpServer({ httpImpl: http, fetch: async () => ({ ok: false, status: 404 }), keepSongs, token: TOKEN })
    const localUrl = await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
    })
    try {
      await run(localUrl)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }

  it('answers which songs are on the phone, from the keeper', async () => {
    const asked = []
    const keepSongs = async (urls) => {
      asked.push(urls)
      return { ok: true, saved: [urls[0]], saving: [], waiting: [urls[1]] }
    }
    await withServer(keepSongs, async (localUrl) => {
      const a = 'hyper://abc/mix/01 One.mp3'
      const b = 'hyper://abc/mix/02 Two.mp3'
      const response = await fetch(keepUrl(localUrl, `url=${encodeURIComponent(a)}&url=${encodeURIComponent(b)}`), { headers: asPage })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
      assert.deepEqual(await response.json(), { ok: true, saved: [a], saving: [], waiting: [b] })
      // The token is not a song.
      assert.deepEqual(asked, [[a, b]])
    })
  })

  it('refuses a check with no songs, too many, or a write', async () => {
    await withServer(async () => ({ ok: true }), async (localUrl) => {
      assert.equal((await fetch(`${localUrl}/hyper/keep?token=${TOKEN}`, { headers: asPage })).status, 400)
      const many = Array.from({ length: MAX_KEEP_SONGS_PER_REQUEST + 1 }, (_, index) => `url=hyper%3A%2F%2Fabc%2F${index}.mp3`).join('&')
      assert.equal((await fetch(keepUrl(localUrl, many), { headers: asPage })).status, 400)
      assert.equal((await fetch(keepUrl(localUrl, 'url=hyper%3A%2F%2Fabc%2Fa.mp3'), { method: 'POST', body: 'x', headers: asPage })).status, 405)
      const head = await fetch(keepUrl(localUrl, 'url=hyper%3A%2F%2Fabc%2Fa.mp3'), { method: 'HEAD', headers: asPage })
      assert.equal(head.status, 405)
    })
    await withServer(null, async (localUrl) => {
      assert.equal((await fetch(keepUrl(localUrl, 'url=hyper%3A%2F%2Fabc%2Fa.mp3'), { headers: asPage })).status, 404)
    })
  })

  // A tab the app opened for a page, an <img> on a page an older WebView
  // loads, or a page on another origin.
  it('starts nothing for a tab, an image or another page, which cannot send the header', async () => {
    let asked = 0
    await withServer(async () => { asked++; return { ok: true } }, async (localUrl) => {
      const keep = keepUrl(localUrl, 'url=hyper%3A%2F%2Fabc%2Fa.mp3')
      assert.equal((await fetch(keep, { headers: { 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'navigate' } })).status, 403)
      assert.equal((await fetch(keep)).status, 403)
      assert.equal((await fetch(keep, { headers: { ...asPage, Origin: 'https://site.example' } })).status, 403)
      assert.equal((await fetch(keep, { headers: { ...asPage, 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
      assert.equal((await fetch(keep, { headers: { [KEEP_SONGS_HEADER]: 'yes' } })).status, 403)
    })
    assert.equal(asked, 0)
  })

  // Another app on the phone can send the header, and no Origin or
  // Sec-Fetch-Site at all. It opened drives and started downloads.
  it('starts nothing for a request without this run\'s token, header or not', async () => {
    let asked = 0
    await withServer(async () => { asked++; return { ok: true } }, async (localUrl) => {
      const query = 'url=hyper%3A%2F%2Fabc%2Fa.mp3'
      for (const token of [null, '', '0'.repeat(TOKEN.length), createLoopbackToken(), TOKEN.slice(1)]) {
        assert.equal((await fetch(keepUrl(localUrl, query, token), { headers: { [KEEP_SONGS_HEADER]: '1' } })).status, 403, String(token))
        assert.equal((await fetch(keepUrl(localUrl, query, token), { headers: asPage })).status, 403, String(token))
      }
      assert.equal((await fetch(keepUrl(localUrl, query, null), { headers: { ...asPage, 'X-PeerSky-Token': TOKEN } })).status, 403)
      assert.equal(asked, 0)
      assert.equal((await fetch(keepUrl(localUrl, query), { headers: { [KEEP_SONGS_HEADER]: '1' } })).status, 200)
    })
    assert.equal(asked, 1)
  })

  it('gives the page a keep function that asks a few songs at a time and adds up the answers', async () => {
    const script = HYPER_BRIDGE_SCRIPT.replace(/^<script>/, '').replace(/<\/script>$/, '')
    const requested = []
    const window = { peerskyServerToken: TOKEN }
    const context = vm.createContext({
      window,
      encodeURIComponent,
      Promise,
      Error,
      fetch: async (url, init) => {
        requested.push(url)
        assert.equal(init?.headers?.[KEEP_SONGS_HEADER], '1')
        const urls = new URL(url, 'http://127.0.0.1').searchParams.getAll('url')
        return { ok: true, json: async () => ({ ok: true, saved: urls.slice(0, 1), saving: urls.slice(1, 2), waiting: [] }) }
      }
    })
    vm.runInContext(script, context)
    assert.equal(typeof window.peerskyKeepSongs, 'function')

    const songs = Array.from({ length: 23 }, (_, index) => `hyper://abc/${index} & co.mp3`)
    const answer = await window.peerskyKeepSongs(songs)
    assert.equal(requested.length, 3)
    assert.ok(requested.every((url) => url.startsWith('/hyper/keep?url=')))
    // The page's token, added as the page asks.
    assert.ok(requested.every((url) => new URL(url, 'http://127.0.0.1').searchParams.get('token') === TOKEN))
    assert.ok(requested[0].includes(encodeURIComponent(songs[0])))
    assert.equal(answer.ok, true)
    assert.deepEqual([...answer.saved], [songs[0], songs[10], songs[20]])
    assert.deepEqual([...answer.saving], [songs[1], songs[11], songs[21]])

    // A server that cannot answer gives null, as a host without it would.
    context.fetch = async () => ({ ok: false, status: 404 })
    assert.equal(await window.peerskyKeepSongs(songs), null)
  })

  it('asks the server the page came from, with the page\'s token', async () => {
    const asked = []
    await withServer(async (urls) => { asked.push(urls); return { ok: true, saved: urls, saving: [], waiting: [] } }, async (localUrl) => {
      const window = { peerskyServerToken: TOKEN }
      vm.runInNewContext(HYPER_BRIDGE_SCRIPT.replace(/^<script>/, '').replace(/<\/script>$/, ''), {
        window,
        encodeURIComponent,
        // Same origin, as from the page.
        fetch: (url, init) => fetch(`${localUrl}${url}`, { ...init, headers: { ...init.headers, 'Sec-Fetch-Site': 'same-origin' } })
      })
      const answer = await window.peerskyKeepSongs(['hyper://abc/a.mp3', 'hyper://abc/b.mp3'])
      assert.equal(answer.ok, true)
      assert.deepEqual([...answer.saved], ['hyper://abc/a.mp3', 'hyper://abc/b.mp3'])
    })
    assert.deepEqual(asked, [['hyper://abc/a.mp3', 'hyper://abc/b.mp3']])
  })
})
