// What RPC_HYPER_FETCH tells the app about a folder, on a real drive. The
// file hypercore-fetch served in a folder's place is named in the canonical
// link it answers with, and that is what sends a folder with a README to the
// viewer and keeps one with an index.html a website. And the viewer's listing
// names a drive at its top from the private drive list Link Device keeps,
// and nowhere else.
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { getFolderViewerRedirect } from '../../app/hyperdrive/viewer-route.mjs'
import { closeHyperRuntime, getSyncedPrivateHyperdrive } from '../../backend/hyper/runtime.mjs'
import { createHyperdriveViewerHttpServer, hyperdriveViewerDriveAccess } from '../../backend/hyperdrive-viewer/server.mjs'
import { PRIVATE_DRIVE_REGISTRY_FILE } from '../../backend/hyperdrive-viewer/drive-names.mjs'

// fetch.mjs starts the browser's media server on bare-http1, Bare's HTTP,
// which only loads in Bare. Node's own has the same shape. Loaded before Bare
// is faked below, as the app loads it.
register(`data:text/javascript,${encodeURIComponent("export async function resolve (specifier, context, next) { return next(specifier === 'bare-http1' ? 'node:http' : specifier, context) }")}`)
const { fetchHyper } = await import('../../backend/hyper/fetch.mjs')
const { stopHyperAssetServer } = await import('../../backend/hyper/asset-server.mjs')
await import('../../backend/hyper/network-refresh.mjs')

const dir = await mkdtemp(path.join(tmpdir(), 'peersky-viewer-folders-'))
// Where the worklet keeps its files, and Link Device the desktop's list of
// private drives. The stores sit beside it.
const deviceDir = path.join(dir, 'device')
globalThis.Bare = { argv: [deviceDir] }

const TOKEN = 'f00d'.repeat(16)

test('a folder served as its README opens in the viewer, a website stays one, and a known drive is named at its top', async (t) => {
  let server = null
  t.after(async () => {
    if (server) {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(() => resolve()))
    }
    // The page's links went through the browser's asset server.
    await within(stopHyperAssetServer(), 10_000, 'the asset server').catch(() => {})
    const closed = await within(closeHyperRuntime(), 10_000, 'closing the stores').then(() => true, () => false)
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    if (!closed) setTimeout(() => process.exit(1), 500)
  })

  const drive = await within(getSyncedPrivateHyperdrive(), 20_000, 'the private drive')
  await drive.put('/docs/README.md', Buffer.from('# Docs\n'))
  await drive.put('/docs/guide.pdf', Buffer.from('%PDF-1.4'))
  await drive.put('/notes/README.org', Buffer.from('* Notes\n'))
  await drive.put('/gemini/index.gmi', Buffer.from('# Capsule\n'))
  await drive.put('/site/index.html', Buffer.from('<!doctype html><title>Site</title>'))
  await drive.put('/site/README.md', Buffer.from('# Not this one\n'))
  await drive.put('/photos/IMG_1.jpg', Buffer.from([0xff, 0xd8, 0xff]))

  const base = `hyper://${drive.id}`
  // As the app asks when a tab opens an address.
  const open = (address) => within(fetchHyper({ url: address, method: 'GET', inlineAssets: true }), 30_000, address)
  const viewerFor = (folder) => `peersky://p2p/hyperdrive/files/${drive.id}${folder}?auto`

  // hypercore-fetch serves the README for the folder, and says so.
  const docs = await open(`${base}/docs/`)
  assert.equal(docs.ok, true)
  assert.match(docs.headers.link, /^<hyper:\/\/[^>]+\/docs\/README\.md>; rel="canonical"$/)
  assert.equal(docs.body, '# Docs\n')
  assert.equal(getFolderViewerRedirect(`${base}/docs/`, docs), viewerFor('/docs/'))

  // README.org comes back as a type the browser cannot show, and index.gmi as
  // Gemini text. Both are the folder's, so both open the viewer.
  const notes = await open(`${base}/notes/`)
  assert.match(notes.headers.link, /\/notes\/README\.org>; rel="canonical"/)
  assert.equal(getFolderViewerRedirect(`${base}/notes/`, notes), viewerFor('/notes/'))
  const gemini = await open(`${base}/gemini/`)
  assert.match(gemini.headers['content-type'], /^text\/gemini/)
  assert.equal(getFolderViewerRedirect(`${base}/gemini/`, gemini), viewerFor('/gemini/'))

  // A folder with no index file comes back as its list of names.
  const photos = await open(`${base}/photos/`)
  assert.match(photos.headers['content-type'], /^application\/json/)
  assert.equal(getFolderViewerRedirect(`${base}/photos/`, photos), viewerFor('/photos/'))

  // index.html comes first, README.md or not: a website.
  const site = await open(`${base}/site/`)
  assert.match(site.headers.link, /\/site\/index\.html>; rel="canonical"/)
  assert.equal(getFolderViewerRedirect(`${base}/site/`, site), null)

  // The README's own address, and the folder with ?noResolve, show as they are.
  const file = await open(`${base}/docs/README.md`)
  assert.equal(file.body, '# Docs\n')
  assert.equal(getFolderViewerRedirect(`${base}/docs/README.md`, file), null)
  const raw = await open(`${base}/docs/?noResolve`)
  assert.match(raw.headers['content-type'], /^application\/json/)
  assert.deepEqual(JSON.parse(raw.body).sort(), ['README.md', 'guide.pdf'])
  assert.equal(getFolderViewerRedirect(`${base}/docs/?noResolve`, raw), null)

  // The desktop named this drive, and Link Device kept its list.
  await mkdir(deviceDir, { recursive: true })
  const registry = path.join(deviceDir, PRIVATE_DRIVE_REGISTRY_FILE)
  await writeFile(registry, JSON.stringify([
    { name: 'Family photos', url: `${base}/`, timestamp: 1, encrypted: true }
  ]))

  server = createHyperdriveViewerHttpServer({
    httpImpl: http,
    ...await hyperdriveViewerDriveAccess(),
    token: TOKEN,
    assets: {}
  })
  const localUrl = await listen(server)
  const listing = async (folder) => {
    const response = await fetch(`${localUrl}/api/list?url=${encodeURIComponent(`${base}${folder}`)}&recursive=1&token=${TOKEN}`)
    assert.equal(response.status, 200)
    return response.json()
  }

  const top = await listing('/')
  assert.equal(top.name, 'Family photos')
  assert.equal(top.private, true)
  assert.equal(top.entries.length, 7)
  // A folder in it the viewer names after the folder.
  assert.equal('name' in await listing('/docs/'), false)

  // Read again each time: a drive the list no longer names has no name.
  await writeFile(registry, JSON.stringify([
    { name: 'Drive', url: `${base}/`, timestamp: 1, encrypted: true }
  ]))
  assert.equal('name' in await listing('/'), false)
  await rm(registry)
  assert.equal('name' in await listing('/'), false)
})

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
