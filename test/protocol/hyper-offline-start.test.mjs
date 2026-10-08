// With the internet down PeerSky waited on the public DHT before it would read
// anything local: hyper-sdk's ready() waited for the swarm to listen, which
// waits for the first announce, and PeerChat and every hyper read sat behind
// it for seconds. patches/hyper-sdk+6.2.2.patch starts listening without
// waiting for it.
import dgram from 'node:dgram'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { create as createSDK } from 'hyper-sdk'

test('the Hyper store opens at once when the public DHT never answers', { timeout: 30_000 }, async (t) => {
  // Takes every packet and answers none, like a bootstrap node behind a dead
  // internet link.
  const silent = dgram.createSocket('udp4')
  await new Promise((resolve) => silent.bind(0, '127.0.0.1', resolve))
  const storage = await mkdtemp(path.join(tmpdir(), 'peersky-offline-start-'))
  let sdk = null
  t.after(async () => {
    await sdk?.close()
    silent.close()
    await rm(storage, { recursive: true, force: true })
  })

  const started = Date.now()
  sdk = await createSDK({ storage, swarmOpts: { bootstrap: [{ host: '127.0.0.1', port: silent.address().port }] } })
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`)
  const drive = await sdk.getDrive('notes', { autoJoin: false })
  await drive.put('/hello.txt', Buffer.from('still here'))
  assert.equal((await drive.get('/hello.txt')).toString(), 'still here')
})

test('comes from the patch every install applies', async () => {
  const source = await readFile(new URL('../../node_modules/hyper-sdk/index.js', import.meta.url), 'utf8')
  assert.match(source, /this\.swarm\.listen\(\)\.catch\(\(\) => \{\}\)/)
  assert.doesNotMatch(source, /await this\.swarm\.listen\(\)/)
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts.postinstall, /patch-package/)
})
