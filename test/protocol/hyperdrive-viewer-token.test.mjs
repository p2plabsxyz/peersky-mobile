// The viewer's server as the app starts it: each start makes a new secret,
// hands it back to the app, and the server's drive reads need it. The pages
// and the viewer's own files do not.
import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

import { signHyperAssetUrl } from '../../backend/hyper/assets.mjs'

// The server runs on bare-http1, Bare's HTTP, which only loads in Bare, and so
// does fetch.mjs, which it reads drives through. Node's own has the same shape.
register(`data:text/javascript,${encodeURIComponent("export async function resolve (specifier, context, next) { return next(specifier === 'bare-http1' ? 'node:http' : specifier, context) }")}`)
const {
  createHyperdriveViewerDownload,
  startHyperdriveViewerServer,
  stopHyperdriveViewerServer
} = await import('../../backend/hyperdrive-viewer/server.mjs')

const FILE = `hyper://${'ab'.repeat(32)}/2024/IMG_1.jpg`

test('each start of the viewer\'s server makes a secret of its own, which its drive reads need', async (t) => {
  t.after(() => stopHyperdriveViewerServer())

  const first = await startHyperdriveViewerServer()
  assert.equal(first.ok, true)
  assert.match(first.token, /^[0-9a-f]{64}$/)
  assert.match(first.localUrl, /^http:\/\/127\.0\.0\.1:\d+$/)

  // Asked again while it runs, it answers with the same one.
  assert.equal((await startHyperdriveViewerServer()).token, first.token)

  const list = `${first.localUrl}/api/list?url=${encodeURIComponent('https://example.com/')}&recursive=1`
  const asset = `${first.localUrl}/hyper/asset?url=${encodeURIComponent('https://example.com/a.jpg')}`
  assert.equal((await fetch(list)).status, 403)
  assert.equal((await fetch(asset)).status, 403)
  // With the secret a request gets as far as the address, which is refused
  // for not being a drive's, before any store is opened.
  assert.equal((await fetch(`${list}&token=${first.token}`)).status, 400)
  assert.equal((await fetch(`${asset}&token=${first.token}`)).status, 400)
  // No secret for the viewer's page.
  const page = await fetch(`${first.localUrl}/hyperdrive/files/${'ab'.repeat(32)}/`)
  await page.arrayBuffer()
  assert.notEqual(page.status, 403)

  // A download the app asks for is signed for its file. What Downloads keeps
  // holds no secret.
  const download = await createHyperdriveViewerDownload({ url: FILE, name: 'IMG_1.jpg' })
  assert.equal(download.ok, true)
  assert.match(download.downloadUrl, /&sig=[0-9a-f]{64}$/)
  assert.ok(!download.downloadUrl.includes(first.token))
  assert.deepEqual(await createHyperdriveViewerDownload({ url: `hyper://${'ab'.repeat(32)}/2024/` }), {
    ok: false,
    error: 'Only a file in a drive can be downloaded.'
  })

  await stopHyperdriveViewerServer()
  const second = await startHyperdriveViewerServer()
  assert.match(second.token, /^[0-9a-f]{64}$/)
  assert.notEqual(second.token, first.token)
  // The last run's secret and signatures are worth nothing now.
  const stale = `${second.localUrl}/hyper/asset?url=${encodeURIComponent('https://example.com/a.jpg')}&token=${first.token}`
  assert.equal((await fetch(stale)).status, 403)
  const oldDownload = download.downloadUrl.replace(first.localUrl, second.localUrl)
  assert.equal((await fetch(oldDownload)).status, 403)
  // A retry is signed again, for this run.
  const again = await createHyperdriveViewerDownload({ url: FILE, name: 'IMG_1.jpg' })
  assert.notEqual(again.downloadUrl, oldDownload)
  assert.ok(again.downloadUrl.startsWith(`${second.localUrl}/hyper/asset?`))
  assert.ok(again.downloadUrl.endsWith(`&sig=${signHyperAssetUrl(second.token, FILE)}`))
  assert.ok(!again.downloadUrl.includes(second.token))
})
