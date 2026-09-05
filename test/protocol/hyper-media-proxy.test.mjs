import assert from 'node:assert/strict'
import http from 'node:http'
import { describe, test } from 'node:test'
import { createHyperAssetServer } from '../../backend/hyper/asset-server-core.mjs'

const ASSET_AUTH_TOKEN = 'test-hyper-asset-token-0123456789abcdef'

describe('hyper media proxy server', () => {
  test('serves OPTIONS preflight without calling hyper fetch', async () => {
    let calls = 0
    const server = createHyperAssetServer({
      httpImpl: http,
      authToken: ASSET_AUTH_TOKEN,
      fetch: async () => {
        calls += 1
        throw new Error('unexpected fetch')
      }
    })

    await withServer(server, async (localUrl) => {
      const response = await fetch(`${localUrl}/asset?token=${ASSET_AUTH_TOKEN}&url=${encodeURIComponent('hyper://example.com/video.mp4')}`, {
        method: 'OPTIONS'
      })

      assert.equal(response.status, 204)
      assert.equal(response.headers.get('access-control-allow-origin'), '*')
      assert.equal(response.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS')
      assert.equal(calls, 0)
    })
  })

  test('rejects unsupported methods missing urls invalid urls and unknown paths', async () => {
    const server = createHyperAssetServer({
      httpImpl: http,
      authToken: ASSET_AUTH_TOKEN,
      fetch: async () => {
        throw new Error('unexpected fetch')
      }
    })

    await withServer(server, async (localUrl) => {
      const post = await fetch(`${localUrl}/asset?token=${ASSET_AUTH_TOKEN}&url=${encodeURIComponent('hyper://example.com/video.mp4')}`, { method: 'POST' })
      assert.equal(post.status, 405)
      assert.equal(await post.text(), 'Method not allowed')

      const missingUrl = await fetch(`${localUrl}/asset?token=${ASSET_AUTH_TOKEN}`)
      assert.equal(missingUrl.status, 400)
      assert.equal(await missingUrl.text(), 'Missing asset url')

      const invalidUrl = await fetch(`${localUrl}/asset?token=${ASSET_AUTH_TOKEN}&url=${encodeURIComponent('https://example.com/video.mp4')}`)
      assert.equal(invalidUrl.status, 400)
      assert.match(await invalidUrl.text(), /Only hyper:\/\/ URLs are supported|Invalid URL/)

      const notFound = await fetch(`${localUrl}/other?token=${ASSET_AUTH_TOKEN}&url=${encodeURIComponent('hyper://example.com/video.mp4')}`)
      assert.equal(notFound.status, 404)
      assert.equal(await notFound.text(), 'Not found')
    })
  })

  test('streams GET responses from hyper fetch with proxy headers', async () => {
    const calls = []
    const server = createHyperAssetServer({
      httpImpl: http,
      authToken: ASSET_AUTH_TOKEN,
      fetch: async (url, init) => {
        calls.push({ url, init })
        return createStreamResponse({
          body: ['hello ', 'video'],
          headers: {
            'content-type': 'video/mp4',
            'content-length': '11',
            etag: 'asset-etag'
          }
        })
      }
    })

    await withServer(server, async (localUrl) => {
      const assetUrl = 'hyper://example.com/video.mp4'
      const response = await fetch(`${localUrl}/asset?token=${ASSET_AUTH_TOKEN}&url=${encodeURIComponent(assetUrl)}`)

      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), 'video/mp4')
      assert.equal(response.headers.get('accept-ranges'), 'bytes')
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(response.headers.get('etag'), 'asset-etag')
      assert.equal(await response.text(), 'hello video')
      assert.equal(calls.length, 1)
      assert.equal(calls[0].url, assetUrl)
      assert.equal(calls[0].init, undefined)
    })
  })

  test('serves HEAD responses with headers and no body', async () => {
    let upstreamCancelled = false
    const body = {
      [Symbol.asyncIterator] () { return this },
      next: async () => ({ done: false, value: new TextEncoder().encode('should-not-be-read') }),
      return: async () => {
        upstreamCancelled = true
        return { done: true }
      }
    }
    const server = createHyperAssetServer({
      httpImpl: http,
      authToken: ASSET_AUTH_TOKEN,
      fetch: async () => createStreamResponse({
        body,
        headers: {
          'content-type': 'audio/ogg',
          'content-length': '18'
        }
      })
    })

    await withServer(server, async (localUrl) => {
      const response = await fetch(`${localUrl}/asset?token=${ASSET_AUTH_TOKEN}&url=${encodeURIComponent('hyper://example.com/audio.ogg')}`, {
        method: 'HEAD'
      })

      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), 'audio/ogg')
      assert.equal(response.headers.get('content-length'), '18')
      assert.equal(await response.text(), '')
      assert.equal(upstreamCancelled, true)
    })
  })

  test('forwards valid Range headers and returns 206 when upstream provides content-range', async () => {
    const calls = []
    const server = createHyperAssetServer({
      httpImpl: http,
      authToken: ASSET_AUTH_TOKEN,
      fetch: async (url, init) => {
        calls.push({ url, init })
        return createStreamResponse({
          status: 206,
          body: ['part'],
          headers: {
            'content-type': 'video/mp4',
            'content-range': 'bytes 0-3/12',
            'content-length': '4'
          }
        })
      }
    })

    await withServer(server, async (localUrl) => {
      const response = await fetch(`${localUrl}/asset?token=${ASSET_AUTH_TOKEN}&url=${encodeURIComponent('hyper://example.com/video.mp4')}`, {
        headers: { Range: 'bytes=0-3' }
      })

      assert.equal(response.status, 206)
      assert.equal(response.headers.get('content-range'), 'bytes 0-3/12')
      assert.equal(await response.text(), 'part')
      assert.equal(calls[0].init.headers.get('range'), 'bytes=0-3')
    })
  })

  test('rejects malformed Range headers before calling hyper fetch', async () => {
    let calls = 0
    const server = createHyperAssetServer({
      httpImpl: http,
      authToken: ASSET_AUTH_TOKEN,
      fetch: async () => {
        calls += 1
        throw new Error('unexpected fetch')
      }
    })

    await withServer(server, async (localUrl) => {
      const response = await fetch(`${localUrl}/asset?token=${ASSET_AUTH_TOKEN}&url=${encodeURIComponent('hyper://example.com/video.mp4')}`, {
        headers: { Range: 'bytes=0-1,2-3' }
      })

      assert.equal(response.status, 416)
      assert.equal(calls, 0)
    })
  })

  test('returns clean errors for upstream failures and non-streamable bodies', async () => {
    const failingServer = createHyperAssetServer({
      httpImpl: http,
      authToken: ASSET_AUTH_TOKEN,
      fetch: async () => ({
        ok: false,
        status: 404,
        statusText: 'Missing asset',
        headers: new Headers(),
        body: null
      })
    })

    await withServer(failingServer, async (localUrl) => {
      const response = await fetch(`${localUrl}/asset?token=${ASSET_AUTH_TOKEN}&url=${encodeURIComponent('hyper://example.com/missing.mp4')}`)
      assert.equal(response.status, 404)
      assert.equal(await response.text(), 'Missing asset')
    })

    const bufferedServer = createHyperAssetServer({
      httpImpl: http,
      authToken: ASSET_AUTH_TOKEN,
      fetch: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'video/mp4' }),
        body: new Uint8Array([1, 2, 3])
      })
    })

    await withServer(bufferedServer, async (localUrl) => {
      const response = await fetch(`${localUrl}/asset?token=${ASSET_AUTH_TOKEN}&url=${encodeURIComponent('hyper://example.com/buffered.mp4')}`)
      assert.equal(response.status, 502)
      assert.equal(await response.text(), 'Hyper asset response is not streamable')
    })
  })

  test('destroys the response if a stream fails after headers are sent', async () => {
    const server = createHyperAssetServer({
      httpImpl: http,
      authToken: ASSET_AUTH_TOKEN,
      fetch: async () => createStreamResponse({
        body: failingBody(),
        headers: { 'content-type': 'video/mp4' }
      })
    })

    await withServer(server, async (localUrl) => {
      const result = await requestWithNodeHttp(`${localUrl}/asset?token=${ASSET_AUTH_TOKEN}&url=${encodeURIComponent('hyper://example.com/broken.mp4')}`)
      assert.equal(result.statusCode, 200)
      assert.equal(result.body, 'partial')
      assert.equal(result.aborted, true)
    })
  })

  test('uses the media extension when upstream returns a generic content type', async () => {
    const server = createHyperAssetServer({
      httpImpl: http,
      authToken: ASSET_AUTH_TOKEN,
      fetch: async () => createStreamResponse({
        body: ['image'],
        headers: { 'content-type': 'text/plain' }
      })
    })

    await withServer(server, async (localUrl) => {
      const assetUrl = 'hyper://example.com/photo.jpg'
      const response = await fetch(`${localUrl}/asset?token=${ASSET_AUTH_TOKEN}&url=${encodeURIComponent(assetUrl)}`)

      assert.equal(response.headers.get('content-type'), 'image/jpeg')
      assert.equal(await response.text(), 'image')
    })
  })

  test('rejects missing and incorrect asset tokens before calling hyper fetch', async () => {
    let calls = 0
    const server = createHyperAssetServer({
      httpImpl: http,
      authToken: ASSET_AUTH_TOKEN,
      fetch: async () => {
        calls += 1
        throw new Error('unexpected fetch')
      }
    })

    await withServer(server, async (localUrl) => {
      const assetUrl = encodeURIComponent('hyper://example.com/video.mp4')
      const missingToken = await fetch(`${localUrl}/asset?url=${assetUrl}`)
      const incorrectToken = await fetch(`${localUrl}/asset?token=incorrect-token&url=${assetUrl}`)

      assert.equal(missingToken.status, 401)
      assert.equal(await missingToken.text(), 'Unauthorized')
      assert.equal(incorrectToken.status, 401)
      assert.equal(await incorrectToken.text(), 'Unauthorized')
      assert.equal(calls, 0)
    })
  })

  test('marks explicit Hyper downloads as attachments', async () => {
    const server = createHyperAssetServer({
      httpImpl: http,
      authToken: ASSET_AUTH_TOKEN,
      fetch: async () => createStreamResponse({
        body: ['report'],
        headers: {
          'content-type': 'application/pdf',
          'content-length': '6'
        }
      })
    })

    await withServer(server, async (localUrl) => {
      const assetUrl = 'hyper://example.com/report.pdf'
      const response = await fetch(
        `${localUrl}/asset?token=${ASSET_AUTH_TOKEN}&url=${encodeURIComponent(assetUrl)}&download=1&name=${encodeURIComponent('report.pdf')}`
      )

      assert.equal(response.status, 200)
      assert.equal(
        response.headers.get('content-disposition'),
        'attachment; filename="report.pdf"; filename*=UTF-8\'\'report.pdf'
      )
      assert.equal(await response.text(), 'report')
    })
  })
})

function createStreamResponse ({
  status = 200,
  statusText = 'OK',
  headers = {},
  body = []
}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers(headers),
    body: Array.isArray(body) ? chunkBody(body) : body
  }
}

async function * chunkBody (chunks) {
  for (const chunk of chunks) {
    yield new TextEncoder().encode(chunk)
  }
}

async function * failingBody () {
  yield new TextEncoder().encode('partial')
  throw new Error('stream exploded')
}

async function withServer (server, callback) {
  const localUrl = await listen(server)
  try {
    await callback(localUrl)
  } finally {
    await closeServer(server)
  }
}

function listen (server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

function closeServer (server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function requestWithNodeHttp (url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = ''
      let settled = false

      const finish = (aborted) => {
        if (settled) return
        settled = true
        resolve({
          statusCode: res.statusCode,
          body,
          aborted
        })
      }

      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('aborted', () => finish(true))
      res.on('error', () => finish(true))
      res.on('end', () => finish(false))
    })

    req.on('error', reject)
  })
}
