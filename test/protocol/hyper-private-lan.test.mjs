// With the internet down, PeerChat went through over Wi-Fi but a private file
// from the desktop would not open on the phone: only the public store was
// found over the LAN. The private store this person's devices share has a
// network key of its own, and now a LAN swarm of its own too.
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import HyperDHTmDNS from '@p2plabs/hyperdht-mdns'
import { create as createSDK } from 'hyper-sdk'
import { addLANReadinessBarrier, attachPrivateLANDiscovery } from '../../backend/hyper/lan-discovery.mjs'

test('a private file comes over the LAN with no internet at all', { timeout: 30_000 }, async (t) => {
  const storage = await mkdtemp(path.join(tmpdir(), 'peersky-private-lan-'))
  const bus = new Set()
  const sdks = []
  const lanPort = 30000 + (process.pid % 10000)
  t.after(async () => {
    await Promise.allSettled(sdks.map((sdk) => sdk.close()))
    await rm(storage, { recursive: true, force: true })
  })
  // No bootstrap: nothing on the internet can be reached.
  const open = async (name) => {
    const sdk = await createSDK({ storage: path.join(storage, name), swarmOpts: { bootstrap: [], port: 0 } })
    sdks.push(sdk)
    return sdk
  }

  // The desktop's private store, on the LAN as the desktop now puts it.
  const desktop = await open('desktop-private')
  await HyperDHTmDNS.attachHyperSDK(desktop, {
    lan: addLANReadinessBarrier(new HyperDHTmDNS({
      host: '127.0.0.1',
      port: lanPort,
      allowLoopback: true,
      adapter: new MemoryAdapter(bus),
      keyPair: desktop.swarm.keyPair
    }), { settleMs: 50 })
  })
  const source = await desktop.getDrive(`private-${randomBytes(6).toString('hex')}`)
  const movie = randomBytes(256 * 1024)
  await source.put('/movie.bin', movie)

  // As the phone's private store was: never on the LAN, so nothing comes.
  const before = await open('phone-private-before')
  const unreachable = await before.getDrive(source.url)
  const missing = await unreachable.entry('/movie.bin', { timeout: 1500 }).catch(() => null)
  assert.equal(missing, null)

  // As it is now.
  const phone = await open('phone-private')
  let created = null
  const lan = await attachPrivateLANDiscovery(phone, {
    host: '127.0.0.1',
    pickFallbackPort: () => lanPort + 1,
    readinessBarrierOptions: { settleMs: 50 },
    createLAN: (options) => {
      created = options
      return new HyperDHTmDNS({
        host: options.host,
        port: options.port,
        keyPair: options.keyPair,
        allowLoopback: true,
        adapter: new MemoryAdapter(bus)
      })
    }
  })
  assert.ok(lan)
  assert.equal(created.keyPair, phone.swarm.keyPair)
  const replica = await phone.getDrive(source.url)
  assert.deepEqual(await replica.get('/movie.bin'), movie)
})

test('the private LAN swarm uses the store\'s key and a port of its own, and gives up quietly', async () => {
  const keyPair = { publicKey: Buffer.alloc(32, 3), secretKey: Buffer.alloc(64, 4) }
  const ports = []
  const warnings = []
  const logger = { warn: (line) => warnings.push(line), error: () => {} }
  const fake = () => {
    const lan = new FakeLAN()
    lan.ready = async () => {
      if (ports.length < 2) throw new Error('bind EADDRINUSE')
    }
    return lan
  }
  const attached = await attachPrivateLANDiscovery({ swarm: { keyPair } }, {
    host: '192.168.1.9',
    pickFallbackPort: () => 50000 + ports.length,
    logger,
    createLAN: (options) => {
      ports.push(options.port)
      assert.equal(options.keyPair, keyPair)
      assert.equal(options.host, '192.168.1.9')
      assert.equal(typeof options.mdnsOptions.createBonjour, 'function')
      return fake()
    },
    attach: async (_runtime, { lan }) => lan
  })
  assert.ok(attached)
  // A taken port is walked past.
  assert.deepEqual(ports, [50000, 50001])

  assert.equal(await attachPrivateLANDiscovery({ swarm: {} }), null)
  const failed = await attachPrivateLANDiscovery({ swarm: { keyPair } }, {
    logger,
    host: '192.168.1.9',
    pickFallbackPort: () => 50100,
    createLAN: () => {
      const lan = new FakeLAN()
      lan.ready = async () => { throw new Error('no multicast') }
      return lan
    },
    attach: async () => assert.fail('nothing to attach')
  })
  assert.equal(failed, null)
  assert.match(warnings.at(-1), /\[LAN private\] Local discovery unavailable: no multicast/)
})

test('only the store shared with your devices goes on the LAN', async () => {
  const runtime = await readFile(new URL('../../backend/hyper/runtime.mjs', import.meta.url), 'utf8')
  const synced = runtime.slice(runtime.indexOf('export async function getSyncedPrivateHyperRuntime ('), runtime.indexOf('export async function getSyncedPrivateHyperdrive ('))
  assert.match(synced, /await attachPrivateLANDiscovery\(runtime\)/)
  // This device's own store and drives adopted from a restore go on no network.
  const deviceOnly = runtime.slice(runtime.indexOf('export async function getPrivateHyperRuntime ('), runtime.indexOf('export async function getSyncedPrivateHyperRuntime ('))
  const adopted = runtime.slice(runtime.indexOf('export async function getAdoptedPrivateHyperRuntime ('))
  assert.doesNotMatch(deviceOnly, /LANDiscovery/)
  assert.doesNotMatch(adopted.slice(0, adopted.indexOf('\n}\n')), /LANDiscovery/)
})

class FakeLAN {
  constructor () {
    this.destroyed = false
    this.listeners = new Map()
  }

  on (name, listener) {
    this.listeners.set(name, listener)
    return this
  }

  async ready () {}

  async destroy () {
    this.destroyed = true
  }
}

class MemoryAdapter {
  constructor (bus) {
    this.bus = bus
    this.record = null
    this.handlers = null
  }

  browse (_query, handlers) {
    this.handlers = handlers
    let stopped = false

    return {
      stop: () => {
        if (stopped) return
        stopped = true
        this.handlers = null
      }
    }
  }

  advertise (record) {
    this.record = record

    for (const peer of this.bus) {
      setImmediate(() => {
        this.handlers?.onService(asService(peer.record))
        peer.handlers?.onService(asService(record))
      })
    }

    this.bus.add(this)
    let stopped = false

    return {
      stop: () => {
        if (stopped) return
        stopped = true
        if (this.record !== record) return

        this.bus.delete(this)
        for (const peer of this.bus) {
          setImmediate(() => peer.handlers?.onServiceDown(asService(record)))
        }
      }
    }
  }
}

function asService (record) {
  return {
    ...record,
    referer: { address: '127.0.0.1' },
    addresses: ['127.0.0.1']
  }
}
