// Private videos could not seek in the desktop's viewer: its private store
// answered a Range with the whole file. The phone reads a private drive the
// way it reads any other, with this phone's keys, so a range of a private file
// has to come back as 206 with just those bytes, and a video in the bounded
// windows a player can seek through. This checks it on a real encrypted drive,
// through the server's own wiring (hyperdriveViewerDriveAccess).
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { closeHyperRuntime, getSyncedPrivateHyperdrive } from '../../backend/hyper/runtime.mjs'
import { createHyperdriveViewerHttpServer, hyperdriveViewerDriveAccess } from '../../backend/hyperdrive-viewer/server.mjs'

// fetch.mjs, which the server reads drives through, starts the browser's media
// server on bare-http1, Bare's HTTP, which only loads in Bare. Node's own has
// the same shape. Loaded before Bare is faked below, as the server loads it.
register(`data:text/javascript,${encodeURIComponent("export async function resolve (specifier, context, next) { return next(specifier === 'bare-http1' ? 'node:http' : specifier, context) }")}`)
await import('../../backend/hyper/fetch.mjs')
await import('../../backend/hyper/network-refresh.mjs')

const dir = await mkdtemp(path.join(tmpdir(), 'peersky-viewer-private-'))
// Where the worklet keeps its files; the stores sit beside it. Set only once
// everything is loaded, because some packages take a Bare global to mean they
// are running in Bare.
globalThis.Bare = { argv: [path.join(dir, 'device')] }

const WINDOW = 4 * 1024 * 1024
const TOKEN = 'a1b2c3d4'.repeat(8)

test('a private drive\'s files answer a range with 206, and its video seeks', async (t) => {
  let server = null
  t.after(async () => {
    if (server) {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(() => resolve()))
    }
    const closed = await within(closeHyperRuntime(), 10_000, 'closing the stores').then(() => true, () => false)
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    if (!closed) setTimeout(() => process.exit(1), 500)
  })

  // This phone's own private drive, encrypted with its own key.
  const drive = await within(getSyncedPrivateHyperdrive(), 20_000, 'the private drive')
  const photo = pattern(1000, 7)
  const video = pattern(WINDOW + 1024 * 1024 + 123, 251)
  await drive.put('/2024/IMG_1.jpg', photo)
  await drive.put('/2024/clip.mp4', video)

  server = createHyperdriveViewerHttpServer({
    httpImpl: http,
    ...await hyperdriveViewerDriveAccess(),
    token: TOKEN,
    assets: {}
  })
  const localUrl = await listen(server)
  const asset = (file) => `${localUrl}/hyper/asset?url=${encodeURIComponent(`hyper://${drive.id}${file}`)}&token=${TOKEN}`

  // Another app on the phone, which sends no Origin, gets none of it without
  // this run's secret.
  const stranger = await fetch(`${localUrl}/hyper/asset?url=${encodeURIComponent(`hyper://${drive.id}/2024/IMG_1.jpg`)}`)
  assert.equal(stranger.status, 403)
  await stranger.arrayBuffer()
  const strangerList = await fetch(`${localUrl}/api/list?url=${encodeURIComponent(`hyper://${drive.id}/`)}&recursive=1`)
  assert.equal(strangerList.status, 403)
  await strangerList.arrayBuffer()

  // The first bytes of a photo, as the viewer reads its EXIF.
  const head = await fetch(asset('/2024/IMG_1.jpg'), { headers: { Range: 'bytes=0-15' } })
  assert.equal(head.status, 206)
  assert.equal(head.headers.get('content-range'), `bytes 0-15/${photo.length}`)
  assert.deepEqual(Buffer.from(await head.arrayBuffer()), photo.subarray(0, 16))

  // A player opens a video with bytes=0- and is handed a window of it, with
  // the whole length, so it knows the duration.
  const opening = await fetch(asset('/2024/clip.mp4'), { headers: { Range: 'bytes=0-' } })
  assert.equal(opening.status, 206)
  assert.equal(opening.headers.get('content-type'), 'video/mp4')
  assert.equal(opening.headers.get('content-range'), `bytes 0-${WINDOW - 1}/${video.length}`)
  const first = Buffer.from(await opening.arrayBuffer())
  assert.equal(first.length, WINDOW)
  assert.ok(first.equals(video.subarray(0, WINDOW)))

  // And seeks: the middle, then near the end.
  const middle = 3 * 1024 * 1024
  const seek = await fetch(asset('/2024/clip.mp4'), { headers: { Range: `bytes=${middle}-${middle + 99}` } })
  assert.equal(seek.status, 206)
  assert.equal(seek.headers.get('content-range'), `bytes ${middle}-${middle + 99}/${video.length}`)
  assert.ok(Buffer.from(await seek.arrayBuffer()).equals(video.subarray(middle, middle + 100)))

  const tail = video.length - 1000
  const end = await fetch(asset('/2024/clip.mp4'), { headers: { Range: `bytes=${tail}-` } })
  assert.equal(end.status, 206)
  assert.equal(end.headers.get('content-range'), `bytes ${tail}-${video.length - 1}/${video.length}`)
  assert.ok(Buffer.from(await end.arrayBuffer()).equals(video.subarray(tail)))

  // Nothing of it for the WebView's disk cache.
  assert.equal(end.headers.get('cache-control'), 'no-store')

  // The listing says the drive is this person's private one, and this
  // phone's to write.
  const listed = await fetch(`${localUrl}/api/list?url=${encodeURIComponent(`hyper://${drive.id}/`)}&recursive=1&token=${TOKEN}`)
  assert.equal(listed.status, 200)
  const listing = await listed.json()
  assert.deepEqual(listing.entries.map((entry) => [entry.path, entry.size]), [
    ['/2024/IMG_1.jpg', photo.length],
    ['/2024/clip.mp4', video.length]
  ])
  assert.equal(listing.truncated, false)
  assert.equal(listing.private, true)
  assert.equal(listing.writable, true)
})

function pattern (length, modulo) {
  const bytes = Buffer.alloc(length)
  for (let index = 0; index < length; index++) bytes[index] = index % modulo
  return bytes
}

function within (promise, ms, what) {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} still waiting after ${ms / 1000}s`)), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

function listen (instance) {
  return new Promise((resolve, reject) => {
    instance.once('error', reject)
    instance.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${instance.address().port}`))
  })
}
