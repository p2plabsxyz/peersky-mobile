import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import * as commands from '../../backend/rpc/commands.mjs'
import {
  HYPER_BRIDGE_SCRIPT,
  createPeerTunesHttpServer,
  injectHyperBridge,
  resolveStaticAsset,
  sendError
} from '../../backend/peertunes/server.mjs'

const SONG_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])

describe('PeerTunes loopback server with injectable Node server', () => {
  let server
  let localUrl
  let fetchCalls
  let keptOffline

  beforeEach(async () => {
    fetchCalls = []
    keptOffline = []
    server = createPeerTunesHttpServer({
      httpImpl: http,
      fetch: createFakeHyperFetch(fetchCalls),
      keepOffline: (url) => keptOffline.push(url)
    })
    localUrl = await listen(server)
  })

  afterEach(async () => {
    await closeServer(server)
  })

  it('serves the app page with the hyper bridge injected right after <head>', async () => {
    const response = await fetch(`${localUrl}/`)
    const html = await response.text()

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(html, /<title>PeerTunes<\/title>/)
    assert.ok(html.includes(HYPER_BRIDGE_SCRIPT))
    assert.ok(html.indexOf(HYPER_BRIDGE_SCRIPT) < html.indexOf('<meta charset'))
    assert.ok(html.indexOf('<head>') < html.indexOf(HYPER_BRIDGE_SCRIPT))

    const aliasResponse = await fetch(`${localUrl}/index.html`)
    assert.equal(aliasResponse.status, 200)
    assert.equal(await aliasResponse.text(), html)
  })

  it('serves scripts, styles and svg assets with their content types', async () => {
    const cases = [
      ['/js/main.js', 'text/javascript; charset=utf-8', /window\.PT/],
      ['/css/style.css', 'text/css; charset=utf-8', /\.clickwheel/],
      ['/assets/default-cover.svg', 'image/svg+xml', /<svg/],
      ['/manifest.webmanifest', 'application/manifest+json', /"PeerTunes"/]
    ]

    for (const [path, contentType, pattern] of cases) {
      const response = await fetch(`${localUrl}${path}`)
      const body = await response.text()

      assert.equal(response.status, 200, path)
      assert.equal(response.headers.get('content-type'), contentType, path)
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path)
      assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(body), path)
      assert.match(body, pattern, path)
    }
  })

  it('answers HEAD with headers only', async () => {
    const response = await fetch(`${localUrl}/js/wheel.js`, { method: 'HEAD' })

    assert.equal(response.status, 200)
    assert.ok(Number(response.headers.get('content-length')) > 0)
    assert.equal(await response.text(), '')
  })

  it('refuses unknown files and every path that leaves the bundle', async () => {
    for (const path of ['/nope.js', '/js/', '/js/../package.json', '/%2e%2e/package.json', '/js/main.js/', '/LICENSE', '/manifest.json']) {
      const response = await rawRequest(localUrl, path)
      assert.equal(response.status, 404, path)
    }

    // Dot segments are collapsed by the URL parser first, so this lands on a
    // bundled file and is fine to serve.
    const normalized = await rawRequest(localUrl, '/assets/../js/main.js')
    assert.equal(normalized.status, 200)
  })

  it('rejects writes, so the in-app publish probe fails cleanly', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const response = await fetch(`${localUrl}/?key=peertunes`, { method, body: 'x' })
      assert.equal(response.status, 405, method)
    }

    const assetWrite = await fetch(`${localUrl}/hyper/asset?url=hyper://abc/song.mp3`, { method: 'PUT', body: 'x' })
    assert.equal(assetWrite.status, 405)

    const preflight = await fetch(`${localUrl}/`, { method: 'OPTIONS' })
    assert.equal(preflight.status, 204)
  })

  it('validates the hyper asset url before touching the network', async () => {
    const missing = await fetch(`${localUrl}/hyper/asset`)
    assert.equal(missing.status, 400)

    const wrongScheme = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('https://example.com/song.mp3')}`)
    assert.equal(wrongScheme.status, 400)
    assert.match(await wrongScheme.text(), /Only hyper:\/\/ URLs are supported/)

    const badPath = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('hyper://abc/..%2F..%2Fetc')}`)
    assert.equal(badPath.status, 400)

    assert.equal(fetchCalls.length, 0)
  })

  it('forwards Accept for folder listings so hypercore-fetch answers with JSON', async () => {
    const response = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('hyper://abc/music/')}`, {
      headers: { Accept: 'application/json' }
    })
    const listing = await response.json()

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.deepEqual(listing, ['01 Song.mp3', 'covers/'])
    assert.equal(fetchCalls.length, 1)
    assert.equal(fetchCalls[0].url, 'hyper://abc/music/')
    assert.equal(fetchCalls[0].options.headers.accept, 'application/json')
  })

  it('streams song bytes and honours range requests', async () => {
    const full = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('hyper://abc/music/01 Song.mp3')}`)
    const fullBytes = new Uint8Array(await full.arrayBuffer())

    assert.equal(full.status, 200)
    assert.equal(full.headers.get('content-type'), 'audio/mpeg')
    assert.equal(full.headers.get('accept-ranges'), 'bytes')
    assert.deepEqual(fullBytes, SONG_BYTES)

    const partial = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('hyper://abc/music/01 Song.mp3')}`, {
      headers: { Range: 'bytes=0-3' }
    })
    const partialBytes = new Uint8Array(await partial.arrayBuffer())

    assert.equal(partial.status, 206)
    assert.equal(partial.headers.get('content-range'), `bytes 0-3/${SONG_BYTES.length}`)
    assert.deepEqual(partialBytes, SONG_BYTES.subarray(0, 4))
    assert.equal(fetchCalls[1].options.headers.get('range'), 'bytes=0-3')
  })

  it('maps upstream failures to an error status without crashing', async () => {
    const response = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('hyper://abc/missing.mp3')}`)
    assert.equal(response.status, 404)
  })

  it('refuses requests that another site made', async () => {
    // A same-origin GET sends no Origin, so one that does is somebody else.
    const crossOrigin = await requestWithHeaders(localUrl, '/', { origin: 'https://evil.example' })
    assert.equal(crossOrigin.status, 403)

    // <audio src> and friends send no Origin at all; Sec-Fetch-Site catches those.
    const noCors = await requestWithHeaders(localUrl, '/hyper/asset?url=hyper%3A%2F%2Fabc%2Fmusic%2F', {
      'sec-fetch-site': 'cross-site'
    })
    assert.equal(noCors.status, 403)

    // A hostname that resolves to loopback must not pass either.
    const rebound = await requestWithHeaders(localUrl, '/', { host: 'evil.example' })
    assert.equal(rebound.status, 403)

    // Nor another server on this phone: a P2PMD room or a Holesail tunnel can
    // be serving a page someone else wrote.
    const otherLoopback = await requestWithHeaders(localUrl, '/', { origin: 'http://127.0.0.1:41999' })
    assert.equal(otherLoopback.status, 403)

    // None of those reached the hyper layer.
    assert.deepEqual(fetchCalls, [])

    const sameOrigin = await requestWithHeaders(localUrl, '/', { 'sec-fetch-site': 'same-origin' })
    assert.equal(sameOrigin.status, 200)
    const ownOrigin = await requestWithHeaders(localUrl, '/', { origin: localUrl })
    assert.equal(ownOrigin.status, 200)
  })

  it('keeps proxied drive content unreadable by other sites and unrenderable', async () => {
    const response = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('hyper://abc/evil.html')}`)

    assert.equal(response.status, 200)
    // A drive must not be able to run scripts on the PeerTunes origin, which is
    // fixed and holds the user's library.
    assert.equal(response.headers.get('content-type'), 'application/octet-stream')
    // And no website may read drive bytes back through the proxy.
    assert.equal(response.headers.get('access-control-allow-origin'), null)

    const audio = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('hyper://abc/music/01 Song.mp3')}`)
    assert.equal(audio.headers.get('content-type'), 'audio/mpeg')
  })

  it('survives a client that walks away mid-track', async () => {
    // Skipping a track disconnects mid-stream. That used to reach sendError and
    // hand the error to res.destroy, which can abort the whole Bare worklet and
    // take hyper and PeerChat down with it.
    await new Promise((resolve, reject) => {
      const { hostname, port } = new URL(localUrl)
      const request = http.request({
        hostname,
        port,
        path: `/hyper/asset?url=${encodeURIComponent('hyper://abc/long.mp3')}`,
        method: 'GET'
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

    // The server is still up and still serving.
    const after = await fetch(`${localUrl}/`)
    assert.equal(after.status, 200)
  })

  it('never hands a late error to destroy', () => {
    // Bare aborts the whole JS worklet if a late stream error goes through its
    // native HTTP callback, which would take hyper and PeerChat down too. And a
    // client that walked away is not an error worth reporting at all.
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
    assert.deepEqual(calls, [], 'an aborted request should be left alone')

    sendError({}, makeRes({ destroyed: true }), new Error('gone'))
    assert.deepEqual(calls, [], 'a destroyed response should be left alone')

    sendError({}, makeRes({ headersSent: true }), new Error('late failure'))
    assert.deepEqual(calls, [['destroy']], 'destroy must be called with no error')

    calls.length = 0
    const res = makeRes({})
    sendError({}, res, Object.assign(new Error('bad drive'), { statusCode: 502 }))
    assert.equal(res.statusCode, 502)
    assert.deepEqual(calls, [['end']])
  })

  it('reads a listing without globals the Bare runtime lacks', async () => {
    // Bare has no TextDecoder. Node does, so a test that assumes it passes here
    // and then 502s on device with "TextDecoder is not defined". Take the
    // globals away for the duration so this path is exercised as Bare sees it.
    const removed = {}
    for (const name of ['TextDecoder', 'TextEncoder']) {
      removed[name] = globalThis[name]
      delete globalThis[name]
    }

    try {
      const response = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('hyper://abc/streamed/')}`, {
        headers: { accept: 'application/json' }
      })

      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), ['Song é'])
    } finally {
      for (const [name, value] of Object.entries(removed)) {
        if (value !== undefined) globalThis[name] = value
      }
    }
  })

  it('passes the upstream reason through instead of a generic failure', async () => {
    // Without this every failure looked identical in the UI, which made a
    // folder that works on one device and not another impossible to diagnose.
    const response = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('hyper://abc/broken/')}`, {
      headers: { accept: 'application/json' }
    })

    assert.equal(response.status, 500)
    const body = await response.text()
    assert.match(body, /Internal Error/)
    assert.match(body, /REQUEST_TIMEOUT/)
  })

  it('retries a listing that was only slow, and gives up on a real 404', async () => {
    // Each attempt keeps whatever blocks it fetched, so a cold folder warms up
    // rather than failing outright. This is the Android "/Classic/ fails but /
    // works" shape: the root needs far fewer reads than a folder of tracks.
    const response = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('hyper://abc/flaky/')}`, {
      headers: { accept: 'application/json' }
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), ['Warmed.mp3'])
    assert.equal(fetchCalls.filter((call) => call.url === 'hyper://abc/flaky/').length, 3)

    // A 404 is an answer, not a hiccup, so it must not be retried.
    fetchCalls.length = 0
    const missing = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('hyper://abc/missing/')}`, {
      headers: { accept: 'application/json' }
    })
    assert.equal(missing.status, 404)
    assert.equal(fetchCalls.length, 1)
  })

  it('pins an imported folder for offline as soon as its listing is served', async () => {
    // Importing a playlist is exactly this request, so this is the moment the
    // tracks get kept. An offline music app that only streams is not offline.
    const folder = 'hyper://abc/music/'
    const response = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent(folder)}`, {
      headers: { accept: 'application/json' }
    })

    assert.equal(response.status, 200)
    assert.deepEqual(keptOffline, [folder])

    // Playing a track must not pin anything on its own; the folder already did.
    await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('hyper://abc/music/01 Song.mp3')}`)
    assert.deepEqual(keptOffline, [folder])

    // And a listing that failed upstream pins nothing.
    await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('hyper://abc/missing/')}`, {
      headers: { accept: 'application/json' }
    })
    assert.deepEqual(keptOffline, [folder])
  })

  it('refuses a listing that would not fit in memory', async () => {
    const response = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent('hyper://abc/huge/')}`, {
      headers: { accept: 'application/json' }
    })

    assert.equal(response.status, 413)
  })
})

describe('PeerTunes server helpers', () => {
  it('resolves only bundled files', () => {
    assert.equal(resolveStaticAsset('/').key, 'index.html')
    assert.equal(resolveStaticAsset('/js/ui.js').key, 'js/ui.js')
    assert.equal(resolveStaticAsset('/js/../index.html'), null)
    assert.equal(resolveStaticAsset('/./index.html'), null)
    assert.equal(resolveStaticAsset('/js\\ui.js'), null)
    assert.equal(resolveStaticAsset('/%E0%A4%A'), null)
    assert.equal(resolveStaticAsset('/README.md'), null)
    assert.equal(resolveStaticAsset('/LICENSE'), null)
  })

  it('injects the bridge after <head>, or first when there is no head', () => {
    assert.equal(
      injectHyperBridge('<html><head lang="en"><meta></head></html>'),
      `<html><head lang="en">${HYPER_BRIDGE_SCRIPT}<meta></head></html>`
    )
    assert.equal(injectHyperBridge('<p>hi</p>'), `${HYPER_BRIDGE_SCRIPT}<p>hi</p>`)
  })

  it('keeps the bridge path relative so no proxy token reaches the page', () => {
    assert.ok(!/token/i.test(HYPER_BRIDGE_SCRIPT))
    assert.match(HYPER_BRIDGE_SCRIPT, /"\/hyper\/asset\?url="/)
  })
})

describe('PeerTunes RPC command', () => {
  it('uses a command id that no other RPC shares', () => {
    const ids = Object.entries(commands)
      .filter(([name]) => name.startsWith('RPC_'))
      .map(([, value]) => value)

    assert.equal(commands.RPC_PEERTUNES_START, 70)
    assert.equal(new Set(ids).size, ids.length)
  })
})

function createFakeHyperFetch (calls) {
  return async (url, options = {}) => {
    calls.push({ url, options })

    if (url === 'hyper://abc/music/') {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
        text: async () => JSON.stringify(['01 Song.mp3', 'covers/'])
      }
    }

    if (url === 'hyper://abc/music/01 Song.mp3') {
      const rangeHeader = readHeader(options.headers, 'range')
      const range = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader || '')
      const start = range ? Number(range[1]) : 0
      const end = range ? (range[2] ? Number(range[2]) : SONG_BYTES.length - 1) : SONG_BYTES.length - 1
      const chunk = SONG_BYTES.subarray(start, end + 1)
      const headers = {
        'content-type': 'audio/mpeg',
        'content-length': String(chunk.byteLength),
        'accept-ranges': 'bytes'
      }
      if (range) headers['content-range'] = `bytes ${start}-${end}/${SONG_BYTES.length}`

      return {
        ok: true,
        status: range ? 206 : 200,
        statusText: 'OK',
        headers: new Headers(headers),
        body: (async function * () { yield chunk })()
      }
    }

    if (url === 'hyper://abc/long.mp3') {
      const chunk = new Uint8Array(64 * 1024)
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes' }),
        body: (async function * () {
          for (let index = 0; index < 64; index++) {
            await new Promise((resolve) => setTimeout(resolve, 5))
            yield chunk
          }
        })()
      }
    }

    if (url === 'hyper://abc/evil.html') {
      const bytes = new TextEncoder().encode('<script>alert(1)</script>')
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(bytes.byteLength)
        }),
        body: (async function * () { yield bytes })()
      }
    }

    if (url === 'hyper://abc/flaky/') {
      // Fails twice, then succeeds: the shape of a cold folder warming up.
      const attempt = calls.filter((call) => call.url === url).length
      if (attempt < 3) {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Error',
          headers: new Headers(),
          body: (async function * () { yield new TextEncoder().encode('REQUEST_TIMEOUT') })()
        }
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
        text: async () => JSON.stringify(['Warmed.mp3'])
      }
    }

    if (url === 'hyper://abc/broken/') {
      return {
        ok: false,
        status: 500,
        statusText: 'Internal Error',
        headers: new Headers({ 'content-type': 'text/plain' }),
        body: (async function * () {
          yield new TextEncoder().encode('REQUEST_TIMEOUT: block not available\n    at Hypercore.get')
        })()
      }
    }

    if (url === 'hyper://abc/streamed/') {
      // Split a multi-byte character across chunks so a per-chunk decode would
      // corrupt it, and deliver it as a stream so the reader path is used.
      const bytes = [
        new Uint8Array([0x5b, 0x22, 0x53, 0x6f, 0x6e, 0x67, 0x20]),
        new Uint8Array([0xc3]),
        new Uint8Array([0xa9, 0x22, 0x5d])
      ]
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
        body: (async function * () { for (const chunk of bytes) yield chunk })()
      }
    }

    if (url === 'hyper://abc/huge/') {
      const chunk = new Uint8Array(1024 * 1024)
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
        body: (async function * () { for (let index = 0; index < 8; index++) yield chunk })()
      }
    }

    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
      text: async () => 'not found'
    }
  }
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

function readHeader (headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') return headers.get(name)
  return headers[name] || headers[name.toLowerCase()] || null
}

function rawRequest (baseUrl, path) {
  const { hostname, port } = new URL(baseUrl)
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname, port, path, method: 'GET' }, (response) => {
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
      const address = instance.address()
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

function closeServer (instance) {
  return new Promise((resolve) => {
    instance.close(() => resolve())
  })
}
