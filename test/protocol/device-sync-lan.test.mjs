import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import NoiseSecretStream from '@hyperswarm/secret-stream'
import HyperDHT from 'hyperdht'
import HyperDHTmDNS from '@p2plabs/hyperdht-mdns'
import { attachDeviceSync } from '../../backend/hyper/device-sync.mjs'

// On the local network, hyperdht-mdns 2 connects with a key made up for that
// network. A device's own key, which the list of devices goes by, is proven
// inside the channel, and only to another of the person's devices. The
// desktop runs the same (test/p2p/device-sync.test.js there). Skipped where
// the installed hyperdht-mdns has no gate.
const skip = typeof HyperDHTmDNS.identityGate !== 'function' && 'hyperdht-mdns has no identity gate'
const hex = (buffer) => Buffer.from(buffer).toString('hex')

async function until (check, what, timeout = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

async function lanDevices (t) {
  const root = await mkdtemp(join(tmpdir(), 'peersky-lan-sync-'))
  const syncs = []
  t.after(async () => {
    for (const sync of syncs) await sync.close().catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  return (name, identityKey, identityGate = HyperDHTmDNS.identityGate) => {
    const swarm = new EventEmitter()
    // The store's network key: who this device is.
    swarm.keyPair = HyperDHT.keyPair()
    swarm.connections = new Set()
    const runtime = { swarm, join: () => ({ refresh: async () => {}, flushed: async () => true, destroy: async () => {} }) }
    const sync = attachDeviceSync(runtime, {
      identityKey,
      stateDirectory: join(root, name),
      device: name === 'phone' ? 'phone' : 'desktop',
      openDrive: async () => null,
      identityGate,
      logger: { warn () {} }
    })
    syncs.push(sync)
    return { swarm, sync, id: hex(swarm.keyPair.publicKey) }
  }
}

// Two ends of a local network connection, each with a key of its own.
async function connect (a, b) {
  const left = new NoiseSecretStream(true, null, { keyPair: HyperDHT.keyPair() })
  const right = new NoiseSecretStream(false, null, { keyPair: HyperDHT.keyPair() })
  left.rawStream.pipe(right.rawStream).pipe(left.rawStream)
  left.on('error', () => {})
  right.on('error', () => {})
  await Promise.all([left.opened, right.opened])
  a.swarm.emit('connection', left, { lan: true, ephemeral: true })
  b.swarm.emit('connection', right, { lan: true, ephemeral: true })
  return [left, right]
}

test('a device on the Wi-Fi is known by the key it proved, not the connection key', { skip }, async (t) => {
  const device = await lanDevices(t)
  const key = randomBytes(32)
  const phone = device('phone', key)
  const desktop = device('desktop', key)
  const [left] = await connect(phone, desktop)
  await until(() => phone.sync.online.has(desktop.id) && desktop.sync.online.has(phone.id), 'the two devices to know each other')
  assert.deepEqual([...phone.sync.online], [desktop.id])
  assert.equal(phone.sync.online.has(hex(left.remotePublicKey)), false)
})

test('a device that finished proving first and opened sync is met, not refused', { skip }, async (t) => {
  const device = await lanDevices(t)
  const key = randomBytes(32)
  const slow = (...args) => HyperDHTmDNS.identityGate(...args).then((result) => new Promise((resolve) => setTimeout(() => resolve(result), 300)))
  const phone = device('phone', key, slow)
  const desktop = device('desktop', key)
  await connect(phone, desktop)
  await until(() => phone.sync.online.has(desktop.id) && desktop.sync.online.has(phone.id), 'the two devices to know each other')
})

test('someone else\'s device on the Wi-Fi learns nothing and is not listed', { skip }, async (t) => {
  const device = await lanDevices(t)
  const results = []
  const recording = (...args) => HyperDHTmDNS.identityGate(...args).then((result) => {
    results.push(result)
    return result
  })
  const phone = device('phone', randomBytes(32), recording)
  const stranger = device('desktop', randomBytes(32), recording)
  await connect(phone, stranger)
  await until(() => results.length === 2, 'both gates to finish')
  assert.deepEqual(results, [null, null])
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(phone.sync.online.size, 0)
  assert.equal(stranger.sync.online.size, 0)
})
