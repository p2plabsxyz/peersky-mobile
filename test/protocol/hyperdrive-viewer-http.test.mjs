import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import * as commands from '../../backend/rpc/commands.mjs'
import { HYPERDRIVE_VIEWER_LOOPBACK_PORT } from '../../backend/hyperdrive-viewer/constants.mjs'
import {
  createHyperdriveViewerHttpServer,
  isViewerPagePath,
  resolveViewerAsset,
  safeProxyContentType,
  sendError,
  signViewerDownload
} from '../../backend/hyperdrive-viewer/server.mjs'
import { signHyperAssetUrl } from '../../backend/hyper/assets.mjs'
import { isUsableNotePort } from '../../backend/p2pmd/note-ports.mjs'

const KEY = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u'
// This run's secret, as the server makes one: 32 random bytes in hex.
const TOKEN = '0123456789abcdef'.repeat(4)
const withToken = (path, token = TOKEN) => `${path}${path.includes('?') ? '&' : '?'}token=${token}`
const PHOTO_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66])
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// The viewer's own files are being written elsewhere; the server is tested
// with a small stand-in of the same layout.
const ASSETS = {
  'index.html': { encoding: 'utf8', content: '<!doctype html><title>Viewer</title><script type="module" src="/hyperdrive/viewer/app.js"></script>' },
  'app.js': { encoding: 'utf8', content: "import { t } from '/hyperdrive/viewer/i18n.js'\n" },
  'style.css': { encoding: 'utf8', content: 'body { margin: 0 }\n' },
  'lib/kinds.js': { encoding: 'utf8', content: 'export const KINDS = {}\n' },
  'data/places.js': { encoding: 'utf8', content: 'export default "Pune\\tIN\\t18.520\\t73.856\\n"\n' },
  'icons/folder.png': { encoding: 'base64', content: PNG_BYTES.toString('base64') }
}

describe('Hyperdrive viewer loopback server', () => {
  let server
  let localUrl
  let fetchCalls
  let listCalls
  let listAnswer

  beforeEach(async () => {
    fetchCalls = []
    listCalls = []
    listAnswer = null
    server = createHyperdriveViewerHttpServer({
      httpImpl: http,
      fetch: createFakeHyperFetch(fetchCalls),
      listFolder: async (url, options) => {
        listCalls.push({ url, options })
        return typeof listAnswer === 'function' ? listAnswer(url, options) : listAnswer
      },
      token: TOKEN,
      assets: ASSETS
    })
    localUrl = await listen(server)
  })

  afterEach(async () => {
    await closeServer(server)
  })

  it('serves the viewer page for each view, whatever folder the address names', async () => {
    for (const path of [
      `/hyperdrive/files/${KEY}/`,
      `/hyperdrive/photos/${KEY}/2024/Goa/?auto`,
      '/hyperdrive/videos/agregore.mauve.moe/Shows/Season%201/',
      '/hyperdrive/files'
    ]) {
      const response = await fetch(`${localUrl}${path}`)
      assert.equal(response.status, 200, path)
      assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8', path)
      assert.equal(await response.text(), ASSETS['index.html'].content, path)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
      // The page shows private drives, so no other page may frame it.
      assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'none'")
      assert.equal(response.headers.get('x-frame-options'), 'DENY')
    }
  })

  it('serves the viewer\'s files under /hyperdrive/viewer/ with their content types', async () => {
    const cases = [
      ['/hyperdrive/viewer/app.js', 'text/javascript; charset=utf-8'],
      ['/hyperdrive/viewer/style.css', 'text/css; charset=utf-8'],
      ['/hyperdrive/viewer/lib/kinds.js', 'text/javascript; charset=utf-8'],
      ['/hyperdrive/viewer/data/places.js', 'text/javascript; charset=utf-8']
    ]
    for (const [path, contentType] of cases) {
      const response = await fetch(`${localUrl}${path}`)
      const body = await response.text()
      assert.equal(response.status, 200, path)
      assert.equal(response.headers.get('content-type'), contentType, path)
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path)
      assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(body), path)
      assert.equal(body, ASSETS[path.slice('/hyperdrive/viewer/'.length)].content, path)
      assert.equal(response.headers.get('x-frame-options'), null, path)
    }

    const icon = await fetch(`${localUrl}/hyperdrive/viewer/icons/folder.png`)
    assert.equal(icon.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await icon.arrayBuffer()), PNG_BYTES)
  })

  it('answers HEAD with headers only', async () => {
    for (const path of [`/hyperdrive/photos/${KEY}/`, '/hyperdrive/viewer/app.js']) {
      const response = await fetch(`${localUrl}${path}`, { method: 'HEAD' })
      assert.equal(response.status, 200, path)
      assert.ok(Number(response.headers.get('content-length')) > 0, path)
      assert.equal(await response.text(), '', path)
    }
  })

  it('refuses unknown files and every path that leaves the bundle', async () => {
    for (const path of [
      '/',
      '/index.html',
      '/hyperdrive/',
      '/hyperdrive/viewer/',
      '/hyperdrive/viewer/lib/',
      '/hyperdrive/viewer/nope.js',
      '/hyperdrive/viewer/index.html/',
      '/hyperdrive/viewer/%2e%2e/package.json',
      '/hyperdrive/viewer/lib%2F..%2Fapp.js',
      '/hyperdrive/viewer/%E0%A4%A',
      `/hyperdrive/music/${KEY}/`,
      '/hyperdrive/filesx/'
    ]) {
      const response = await rawRequest(localUrl, path)
      assert.equal(response.status, 404, path)
    }
  })

  it('takes nothing but reads', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const page = await fetch(`${localUrl}/hyperdrive/files/${KEY}/`, { method, body: 'x' })
      assert.equal(page.status, 405, method)
      const list = await fetch(`${localUrl}/api/list?url=${encodeURIComponent(`hyper://${KEY}/`)}`, { method, body: 'x' })
      assert.equal(list.status, 405, method)
    }
    const preflight = await fetch(`${localUrl}/api/list`, { method: 'OPTIONS' })
    assert.equal(preflight.status, 204)
    assert.deepEqual(listCalls, [])
  })

  it('refuses requests that another site made', async () => {
    // With the secret, so it is the origin that is refused.
    const listPath = withToken(`/api/list?url=${encodeURIComponent(`hyper://${KEY}/`)}&recursive=1`)
    const assetPath = withToken(`/hyper/asset?url=${encodeURIComponent(`hyper://${KEY}/IMG_1.jpg`)}`)
    for (const path of [`/hyperdrive/photos/${KEY}/`, listPath, assetPath]) {
      // A fetch from a website sends its own Origin.
      assert.equal((await requestWithHeaders(localUrl, path, { origin: 'https://evil.example' })).status, 403, path)
      // An <img> or an <iframe> from a website sends none, but says cross-site.
      assert.equal((await requestWithHeaders(localUrl, path, { 'sec-fetch-site': 'cross-site' })).status, 403, path)
      // A name that resolves to 127.0.0.1 is a rebinding attack.
      assert.equal((await requestWithHeaders(localUrl, path, { host: 'evil.example' })).status, 403, path)
      // Another server on this phone may serve a page someone else wrote.
      assert.equal((await requestWithHeaders(localUrl, path, { origin: 'http://127.0.0.1:47317' })).status, 403, path)
    }
    assert.deepEqual(fetchCalls, [])
    assert.deepEqual(listCalls, [])

    const own = await requestWithHeaders(localUrl, `/hyperdrive/photos/${KEY}/`, { origin: localUrl })
    assert.equal(own.status, 200)
    const sameOrigin = await requestWithHeaders(localUrl, '/hyperdrive/viewer/app.js', { 'sec-fetch-site': 'same-origin' })
    assert.equal(sameOrigin.status, 200)
    // The app opening the page, or the phone's downloads fetching a file.
    const fromTheApp = await requestWithHeaders(localUrl, `/hyperdrive/files/${KEY}/`, { 'sec-fetch-site': 'none' })
    assert.equal(fromTheApp.status, 200)
  })

  it('checks the drive address before reading anything', async () => {
    assert.equal((await fetch(`${localUrl}${withToken('/hyper/asset')}`)).status, 400)
    const web = await fetch(`${localUrl}${withToken(`/hyper/asset?url=${encodeURIComponent('https://example.com/a.jpg')}`)}`)
    assert.equal(web.status, 400)
    assert.match(await web.text(), /Only hyper:\/\/ URLs are supported/)
    assert.equal((await fetch(`${localUrl}${withToken(`/hyper/asset?url=${encodeURIComponent(`hyper://${KEY}/..%2F..%2Fetc`)}`)}`)).status, 400)
    // hypercore-fetch would read a drive of its own choosing for no host.
    assert.equal((await fetch(`${localUrl}${withToken(`/hyper/asset?url=${encodeURIComponent('hyper:///IMG_1.jpg')}`)}`)).status, 400)
    assert.deepEqual(fetchCalls, [])
  })

  it('streams a drive\'s files with Range and HEAD', async () => {
    const assetUrl = `${localUrl}${withToken(`/hyper/asset?url=${encodeURIComponent(`hyper://${KEY}/2024/IMG_1.jpg`)}`)}`
    const full = await fetch(assetUrl)
    assert.equal(full.status, 200)
    assert.equal(full.headers.get('content-type'), 'image/jpeg')
    assert.equal(full.headers.get('accept-ranges'), 'bytes')
    assert.deepEqual(new Uint8Array(await full.arrayBuffer()), PHOTO_BYTES)
    assert.equal(fetchCalls[0].url, `hyper://${KEY}/2024/IMG_1.jpg`)

    const partial = await fetch(assetUrl, { headers: { Range: 'bytes=0-3' } })
    assert.equal(partial.status, 206)
    assert.equal(partial.headers.get('content-range'), `bytes 0-3/${PHOTO_BYTES.length}`)
    assert.deepEqual(new Uint8Array(await partial.arrayBuffer()), PHOTO_BYTES.subarray(0, 4))
    assert.equal(readHeader(fetchCalls[1].options.headers, 'range'), 'bytes=0-3')

    const head = await fetch(assetUrl, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-length'), String(PHOTO_BYTES.length))
    assert.equal(await head.text(), '')

    assert.equal((await fetch(`${localUrl}${withToken(`/hyper/asset?url=${encodeURIComponent(`hyper://${KEY}/missing.jpg`)}`)}`)).status, 404)
  })

  it('keeps a drive\'s files from running as pages, from other sites and from the disk cache', async () => {
    const cases = [
      ['evil.html', 'application/octet-stream'],
      ['logo.svg', 'application/octet-stream'],
      ['feed.xml', 'application/octet-stream'],
      ['paper.pdf', 'application/octet-stream'],
      ['notes.md', 'application/octet-stream'],
      ['IMG_1.jpg', 'image/jpeg'],
      ['clip.mp4', 'video/mp4'],
      ['song.mp3', 'audio/mpeg'],
      ['notes.txt', 'text/plain; charset=utf-8'],
      ['IMG_1.jpg.json', 'application/json'],
      ['Movie.en.vtt', 'text/vtt']
    ]
    for (const [name, contentType] of cases) {
      const response = await fetch(`${localUrl}${withToken(`/hyper/asset?url=${encodeURIComponent(`hyper://${KEY}/${name}`)}`)}`)
      await response.arrayBuffer()
      assert.equal(response.status, 200, name)
      assert.equal(response.headers.get('content-type'), contentType, name)
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff', name)
      assert.equal(response.headers.get('content-security-policy'), 'sandbox', name)
      assert.equal(response.headers.get('access-control-allow-origin'), null, name)
      // A private drive's file must not land in the WebView's disk cache.
      assert.equal(response.headers.get('cache-control'), 'no-store', name)
    }
  })

  it('saves a download under the name the file has in the drive', async () => {
    const download = signViewerDownload({ localUrl, token: TOKEN, url: `hyper://${KEY}/2024/IMG_1.jpg`, name: 'Goa beach.jpg' })
    const response = await fetch(download)
    await response.arrayBuffer()
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-disposition'), /^attachment; filename="Goa beach\.jpg"/)
  })

  // What a download record keeps: an address signed for its one file, which
  // holds no key to anything else and is worth nothing after a restart.
  it('takes a download signed for its one file, and nothing else with that signature', async () => {
    const photo = `hyper://${KEY}/2024/IMG_1.jpg`
    const download = signViewerDownload({ localUrl, token: TOKEN, url: photo, name: 'IMG_1.jpg' })
    assert.equal(
      download,
      `${localUrl}/hyper/asset?url=${encodeURIComponent(photo)}&download=1&name=IMG_1.jpg&sig=${signHyperAssetUrl(TOKEN, photo)}`
    )
    // The record never holds the run's secret.
    assert.ok(!download.includes(TOKEN))
    assert.doesNotMatch(download, /[?&]token=/)

    const saved = await fetch(download)
    assert.equal(saved.status, 200)
    assert.deepEqual(new Uint8Array(await saved.arrayBuffer()), PHOTO_BYTES)
    fetchCalls.length = 0

    const sig = signHyperAssetUrl(TOKEN, photo)
    const refused = [
      // The photo's signature on another file of the drive, or another drive.
      `/hyper/asset?url=${encodeURIComponent(`hyper://${KEY}/notes.txt`)}&download=1&sig=${sig}`,
      `/hyper/asset?url=${encodeURIComponent(`hyper://${'ab'.repeat(32)}/2024/IMG_1.jpg`)}&download=1&sig=${sig}`,
      // Not a download: the signature is for saving the file only.
      `/hyper/asset?url=${encodeURIComponent(photo)}&sig=${sig}`,
      // A wrong one, one from the last run, and the right one changed.
      `/hyper/asset?url=${encodeURIComponent(photo)}&download=1&sig=${'0'.repeat(64)}`,
      `/hyper/asset?url=${encodeURIComponent(photo)}&download=1&sig=${signHyperAssetUrl('f'.repeat(64), photo)}`,
      `/hyper/asset?url=${encodeURIComponent(photo)}&download=1&sig=${sig.toUpperCase()}`,
      `/hyper/asset?url=${encodeURIComponent(photo)}&download=1&sig=${sig.slice(1)}`,
      // A signature is not the secret: it lists nothing.
      `/api/list?url=${encodeURIComponent(`hyper://${KEY}/`)}&recursive=1&sig=${signHyperAssetUrl(TOKEN, `hyper://${KEY}/`)}`
    ]
    for (const path of refused) {
      const response = await rawRequest(localUrl, path)
      assert.equal(response.status, 403, path)
    }
    assert.deepEqual(fetchCalls, [])
    assert.deepEqual(listCalls, [])

    // Only a drive's file is signed.
    assert.equal(signViewerDownload({ localUrl, token: TOKEN, url: `hyper://${KEY}/2024/` }), null)
    assert.equal(signViewerDownload({ localUrl, token: TOKEN, url: 'https://example.com/a.jpg' }), null)
    assert.equal(signViewerDownload({ localUrl, token: TOKEN, url: 'hyper:///a.jpg' }), null)
  })

  // Another app on the phone reaches 127.0.0.1 too, and sends no Origin.
  it('reads a drive only for a request that carries this run\'s secret', async () => {
    listAnswer = { ok: true, entries: [], truncated: false, private: true, writable: true }
    const listPath = `/api/list?url=${encodeURIComponent(`hyper://${KEY}/`)}&recursive=1`
    const assetPath = `/hyper/asset?url=${encodeURIComponent(`hyper://${KEY}/2024/IMG_1.jpg`)}`
    const downloadPath = `${assetPath}&download=1&name=IMG_1.jpg`
    const wrong = [
      null,
      '',
      'f'.repeat(64),
      TOKEN.slice(0, 63),
      `${TOKEN}0`,
      TOKEN.toUpperCase()
    ]

    for (const path of [listPath, assetPath, downloadPath]) {
      for (const token of wrong) {
        const target = token === null ? path : withToken(path, token)
        const response = await rawRequest(localUrl, target)
        assert.equal(response.status, 403, `${path} with ${token}`)
      }
      const head = await rawRequest(localUrl, path, 'HEAD')
      assert.equal(head.status, path === listPath ? 405 : 403, `HEAD ${path}`)
    }
    // Refused before anything was read or listed.
    assert.deepEqual(fetchCalls, [])
    assert.deepEqual(listCalls, [])

    const listed = await fetch(`${localUrl}${withToken(listPath)}`)
    assert.equal(listed.status, 200)
    assert.equal((await listed.json()).private, true)
    const photo = await fetch(`${localUrl}${withToken(assetPath)}`)
    assert.equal(photo.status, 200)
    assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), PHOTO_BYTES)
    const saved = await fetch(`${localUrl}${withToken(downloadPath)}`)
    assert.equal(saved.status, 200)
    await saved.arrayBuffer()
    // The secret only lets a request in. It is not passed on to the drive.
    assert.ok(fetchCalls.every((call) => !call.url.includes(TOKEN)))
    assert.ok(listCalls.every((call) => !call.url.includes(TOKEN)))
  })

  it('serves the page and the viewer\'s own files with no secret', async () => {
    for (const path of [`/hyperdrive/photos/${KEY}/?auto`, '/hyperdrive/viewer/app.js', '/hyperdrive/viewer/data/places.js']) {
      const response = await rawRequest(localUrl, path)
      assert.equal(response.status, 200, path)
    }
  })

  it('lists a folder in the shape the viewer reads', async () => {
    listAnswer = {
      ok: true,
      entries: [
        { path: '/2024/IMG_1.jpg', size: 10, mtime: 1700000000000 },
        { path: '/2024/clip.mp4', size: 2048, mtime: null }
      ],
      truncated: false,
      private: true,
      writable: false
    }
    const hyperUrl = `hyper://${KEY}/2024/`
    const response = await fetch(`${localUrl}${withToken(`/api/list?url=${encodeURIComponent(hyperUrl)}&recursive=1`)}`, {
      headers: { Accept: 'application/json' }
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), {
      entries: listAnswer.entries,
      truncated: false,
      private: true,
      writable: false
    })
    assert.equal(listCalls.length, 1)
    assert.equal(listCalls[0].url, hyperUrl)
    assert.equal(listCalls[0].options.recursive, true)

    await (await fetch(`${localUrl}${withToken(`/api/list?url=${encodeURIComponent(hyperUrl)}`)}`)).arrayBuffer()
    assert.equal(listCalls[1].options.recursive, false)
  })

  it('names a drive at its top when the listing knows its name, and leaves name out otherwise', async () => {
    const entries = [{ path: '/a.jpg', size: 1, mtime: null }]
    const root = `${localUrl}${withToken(`/api/list?url=${encodeURIComponent(`hyper://${KEY}/`)}&recursive=1`)}`
    listAnswer = { ok: true, entries, truncated: false, private: true, writable: false, name: 'Family photos' }
    assert.deepEqual(await (await fetch(root)).json(), {
      entries,
      truncated: false,
      private: true,
      writable: false,
      name: 'Family photos'
    })
    for (const name of [undefined, null, '', 42]) {
      listAnswer = { ok: true, entries, truncated: false, private: false, writable: false, name }
      assert.equal('name' in await (await fetch(root)).json(), false, String(name))
    }
  })

  it('answers a failed listing with its code, its message and a status to match', async () => {
    const failures = [
      [404, 'not-found'],
      [503, 'no-peers'],
      [403, 'private'],
      [504, 'timeout'],
      [413, 'too-large'],
      [500, 'unknown']
    ]
    for (const [status, code] of failures) {
      listAnswer = { ok: false, status, code, message: `because ${code}` }
      const response = await fetch(`${localUrl}${withToken(`/api/list?url=${encodeURIComponent(`hyper://${KEY}/`)}&recursive=1`)}`)
      assert.equal(response.status, status, code)
      assert.deepEqual(await response.json(), { code, message: `because ${code}` })
    }

    const missing = await fetch(`${localUrl}${withToken('/api/list')}`)
    assert.equal(missing.status, 400)
    assert.equal((await missing.json()).code, 'unknown')

    const head = await fetch(`${localUrl}/api/list?url=${encodeURIComponent(`hyper://${KEY}/`)}`, { method: 'HEAD' })
    assert.equal(head.status, 405)
  })

  it('stops a listing the viewer stopped waiting for', async () => {
    let signal = null
    let stopped
    const wasStopped = new Promise((resolve) => { stopped = resolve })
    listAnswer = (url, options) => new Promise((resolve) => {
      signal = options.signal
      options.signal.onAbort(() => {
        stopped()
        resolve({ ok: false, status: 499, code: 'unknown', message: 'stopped' })
      })
    })

    await new Promise((resolve) => {
      const { hostname, port } = new URL(localUrl)
      const request = http.request({ hostname, port, path: withToken(`/api/list?url=${encodeURIComponent(`hyper://${KEY}/`)}&recursive=1`) })
      request.on('error', () => resolve())
      request.end()
      setTimeout(() => {
        request.destroy()
        resolve()
      }, 50)
    })

    await wasStopped
    assert.equal(signal.aborted, true)
    // Still up and still serving.
    assert.equal((await fetch(`${localUrl}/hyperdrive/viewer/app.js`)).status, 200)
  })

  it('survives a viewer that walks away mid-video', async () => {
    await new Promise((resolve, reject) => {
      const { hostname, port } = new URL(localUrl)
      const request = http.request({
        hostname,
        port,
        path: withToken(`/hyper/asset?url=${encodeURIComponent(`hyper://${KEY}/long.mp4`)}`)
      }, (response) => {
        response.once('data', () => {
          request.destroy()
          resolve()
        })
      })
      request.on('error', () => resolve())
      request.end()
      setTimeout(reject, 5000, new Error('stream never started'))
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal((await fetch(`${localUrl}/hyperdrive/files/${KEY}/`)).status, 200)
  })
})

describe('Hyperdrive viewer server helpers', () => {
  it('resolves only the viewer\'s own files', () => {
    assert.equal(resolveViewerAsset('/hyperdrive/viewer/app.js', ASSETS).key, 'app.js')
    assert.equal(resolveViewerAsset('/hyperdrive/viewer/lib/kinds.js', ASSETS).key, 'lib/kinds.js')
    assert.equal(resolveViewerAsset('/hyperdrive/viewer/lib/../app.js', ASSETS), null)
    assert.equal(resolveViewerAsset('/hyperdrive/viewer/./app.js', ASSETS), null)
    assert.equal(resolveViewerAsset('/hyperdrive/viewer/lib\\kinds.js', ASSETS), null)
    assert.equal(resolveViewerAsset('/hyperdrive/viewer/lib%00/kinds.js', ASSETS), null)
    assert.equal(resolveViewerAsset('/hyperdrive/viewer/%E0%A4%A', ASSETS), null)
    assert.equal(resolveViewerAsset('/hyperdrive/viewer/', ASSETS), null)
    assert.equal(resolveViewerAsset('/app.js', ASSETS), null)
    assert.equal(resolveViewerAsset('/hyperdrive/viewer/constructor', ASSETS), null)
  })

  it('knows the viewer\'s pages', () => {
    assert.equal(isViewerPagePath(`/hyperdrive/files/${KEY}/`), true)
    assert.equal(isViewerPagePath('/hyperdrive/photos'), true)
    assert.equal(isViewerPagePath('/hyperdrive/videos/'), true)
    assert.equal(isViewerPagePath('/hyperdrive/viewer/app.js'), false)
    assert.equal(isViewerPagePath('/hyperdrive/photosx/'), false)
    assert.equal(isViewerPagePath('/api/list'), false)
  })

  it('lets through only media, plain text, subtitles and JSON', () => {
    assert.equal(safeProxyContentType('image/heic'), 'image/heic')
    assert.equal(safeProxyContentType('video/quicktime'), 'video/quicktime')
    assert.equal(safeProxyContentType('text/vtt; charset=utf-8'), 'text/vtt; charset=utf-8')
    assert.equal(safeProxyContentType('image/svg+xml'), 'application/octet-stream')
    assert.equal(safeProxyContentType('text/html'), 'application/octet-stream')
    assert.equal(safeProxyContentType('application/xhtml+xml'), 'application/octet-stream')
    assert.equal(safeProxyContentType('text/xml'), 'application/octet-stream')
    assert.equal(safeProxyContentType(''), 'application/octet-stream')
  })

  it('never hands a late error to destroy', () => {
    const calls = []
    const makeRes = (overrides) => ({
      headersSent: false,
      destroyed: false,
      statusCode: 0,
      setHeader () {},
      end () { calls.push(['end']) },
      destroy (...args) { calls.push(['destroy', ...args]) },
      ...overrides
    })

    sendError({ aborted: true }, makeRes({ headersSent: true }), new Error('gone'))
    assert.deepEqual(calls, [])
    sendError({}, makeRes({ headersSent: true }), new Error('late failure'))
    assert.deepEqual(calls, [['destroy']])
    calls.length = 0
    const res = makeRes({})
    sendError({}, res, Object.assign(new Error('bad drive'), { statusCode: 502 }))
    assert.equal(res.statusCode, 502)
    assert.deepEqual(calls, [['end']])
  })

  it('is not made without a secret for its run', () => {
    const options = { httpImpl: http, fetch: async () => {}, listFolder: async () => {} }
    assert.throws(() => createHyperdriveViewerHttpServer(options), /secret/)
    assert.throws(() => createHyperdriveViewerHttpServer({ ...options, token: 'short' }), /secret/)
  })

  it('starts, and signs a download, from RPC commands of its own', () => {
    const ids = Object.entries(commands).filter(([name]) => name.startsWith('RPC_')).map(([, value]) => value)
    assert.equal(commands.RPC_HYPERDRIVE_VIEWER_START, 79)
    assert.equal(commands.RPC_HYPERDRIVE_VIEWER_DOWNLOAD, 80)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('keeps its port: a P2PMD note never takes it', () => {
    assert.equal(HYPERDRIVE_VIEWER_LOOPBACK_PORT, 47318)
    assert.equal(isUsableNotePort(HYPERDRIVE_VIEWER_LOOPBACK_PORT), false)
  })
})

function createFakeHyperFetch (calls) {
  const files = {
    '2024/IMG_1.jpg': ['image/jpeg', PHOTO_BYTES],
    'IMG_1.jpg': ['image/jpeg', PHOTO_BYTES],
    'evil.html': ['text/html; charset=utf-8', new TextEncoder().encode('<script>alert(1)</script>')],
    'logo.svg': ['image/svg+xml', new TextEncoder().encode('<svg onload="alert(1)"/>')],
    'feed.xml': ['application/xml', new TextEncoder().encode('<rss/>')],
    'paper.pdf': ['application/pdf', new TextEncoder().encode('%PDF-1.7')],
    'notes.md': ['text/markdown', new TextEncoder().encode('# Notes')],
    'clip.mp4': ['video/mp4', new Uint8Array(16)],
    'song.mp3': ['audio/mpeg', new Uint8Array(16)],
    'notes.txt': ['text/plain; charset=utf-8', new TextEncoder().encode('hello')],
    'IMG_1.jpg.json': ['application/json', new TextEncoder().encode('{}')],
    'Movie.en.vtt': ['text/vtt', new TextEncoder().encode('WEBVTT')]
  }

  return async (url, options = {}) => {
    calls.push({ url, options })
    const name = url.slice(`hyper://${KEY}/`.length)

    if (name === 'long.mp4') {
      const chunk = new Uint8Array(64 * 1024)
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'video/mp4', 'accept-ranges': 'bytes' }),
        body: (async function * () {
          for (let index = 0; index < 64; index++) {
            await new Promise((resolve) => setTimeout(resolve, 5))
            yield chunk
          }
        })()
      }
    }

    const file = files[name]
    if (!file) {
      return { ok: false, status: 404, statusText: 'Not Found', headers: new Headers(), text: async () => 'Not Found' }
    }

    const [contentType, bytes] = file
    const range = /^bytes=(\d+)-(\d*)$/.exec(readHeader(options.headers, 'range') || '')
    const start = range ? Number(range[1]) : 0
    const end = range && range[2] ? Number(range[2]) : bytes.length - 1
    const chunk = bytes.subarray(start, end + 1)
    const headers = {
      'content-type': contentType,
      'content-length': String(chunk.byteLength),
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=300'
    }
    if (range) headers['content-range'] = `bytes ${start}-${end}/${bytes.length}`
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(headers),
      body: (async function * () { yield chunk })()
    }
  }
}

function readHeader (headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') return headers.get(name)
  return headers[name] || headers[name.toLowerCase()] || null
}

function requestWithHeaders (baseUrl, path, headers) {
  const { hostname, port } = new URL(baseUrl)
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname, port, path, method: 'GET', headers }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }))
    })
    request.on('error', reject)
    request.end()
  })
}

function rawRequest (baseUrl, path, method = 'GET') {
  const { hostname, port } = new URL(baseUrl)
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname, port, path, method }, (response) => {
      response.resume()
      response.on('end', () => resolve({ status: response.statusCode }))
    })
    request.on('error', reject)
    request.end()
  })
}

function listen (instance) {
  return new Promise((resolve, reject) => {
    instance.once('error', reject)
    instance.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${instance.address().port}`)
    })
  })
}

function closeServer (instance) {
  return new Promise((resolve) => {
    instance.closeAllConnections?.()
    instance.close(() => resolve())
  })
}
