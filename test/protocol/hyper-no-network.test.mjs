// In airplane mode a linked phone could not open any hyper:// page, cached
// ones and its own files included: "File descriptor could not be locked". The
// LAN lookup threw when there was no network, after the store had opened and
// locked its files, so the store never finished opening and every later try
// was refused the lock.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { create as createSDK } from 'hyper-sdk'
import {
  attachPrivateLANDiscovery,
  getLANDiscoveryStatus,
  startLANDiscovery
} from '../../backend/hyper/lan-discovery.mjs'

// Airplane mode: loopback and nothing else.
function withoutNetwork (t) {
  const real = os.networkInterfaces
  os.networkInterfaces = () => ({ lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] })
  t.after(() => { os.networkInterfaces = real })
}

test('with no network the public store opens without LAN, and says why', async (t) => {
  withoutNetwork(t)
  const warnings = []
  const status = await startLANDiscovery({ swarm: {} }, {
    logger: { warn: (line) => warnings.push(line), error: () => {} },
    createLAN: () => assert.fail('nothing to bind to')
  })
  assert.equal(status.available, false)
  assert.match(status.error, /No network/)
  assert.equal(getLANDiscoveryStatus().available, false)
  assert.match(warnings.at(-1), /\[LAN\] Local discovery unavailable/)
})

test('with no network the private store goes without LAN instead of failing to open', async (t) => {
  const storage = await mkdtemp(path.join(tmpdir(), 'peersky-no-network-'))
  const sdk = await createSDK({ storage, swarmOpts: { bootstrap: [], port: 0 } })
  t.after(async () => {
    await sdk.close().catch(() => {})
    await rm(storage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
  withoutNetwork(t)
  const warnings = []
  const lan = await attachPrivateLANDiscovery(sdk, {
    logger: { warn: (line) => warnings.push(line), error: () => {} },
    createLAN: () => assert.fail('nothing to bind to')
  })
  assert.equal(lan, null)
  assert.match(warnings.at(-1), /\[LAN private\] Local discovery unavailable/)

  // The store it was for works as before.
  const drive = await sdk.getDrive('notes', { autoJoin: false })
  await drive.put('/hello.txt', Buffer.from('on a plane'))
  assert.equal((await drive.get('/hello.txt')).toString(), 'on a plane')

  // Why it mattered: while a store holds its files, a second one on the same
  // folder is refused, which is all the retries ever got.
  await assert.rejects(createSDK({ storage, swarmOpts: { bootstrap: [], port: 0 } }), /could not be locked/)
})

test('a LAN failure never fails opening either store', async () => {
  const runtime = await readFile(new URL('../../backend/hyper/runtime.mjs', import.meta.url), 'utf8')
  const publicStore = runtime.slice(runtime.indexOf('export async function getHyperRuntime ('), runtime.indexOf('export async function getPrivateHyperRuntime ('))
  assert.match(publicStore, /await startLANDiscovery\(runtime\)\.catch\(/)
  const privateStore = runtime.slice(runtime.indexOf('export async function getSyncedPrivateHyperRuntime ('), runtime.indexOf('export async function getSyncedPrivateHyperdrive ('))
  assert.match(privateStore, /await attachPrivateLANDiscovery\(runtime\)\.catch\(/)
})
