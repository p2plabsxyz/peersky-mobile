import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import HyperDHT from 'hyperdht'
import HyperDHTmDNS from '@p2plabs/hyperdht-mdns'
import createTestnet from 'hyperdht/testnet.js'
import { LAN_OPEN_MS, findNoteRouteOnLan, notePortKeyPair, noteTopic } from '../../backend/holesail/lan.mjs'
import { TunnelGuest, TunnelHost } from '../../backend/holesail/tunnel.mjs'
import { LOOPBACK_TOKEN_HEADER, createLoopbackToken } from '../../backend/loopback-request.mjs'

// With the router's cable out, a P2PMD note did not open, even with both
// devices on the same Wi-Fi: a host is found on the public HyperDHT, which is
// on the internet, and a note could not even be hosted. The host now also
// listens on the LAN DHT, and a guest looks there first (holesail/lan.mjs).

// No internet: a DHT with nobody to bootstrap from, so a record cannot be put.
const OFFLINE = []

// A Wi-Fi with nothing else on it: mDNS goes between the devices here.
class MemoryAdapter {
  constructor (bus) {
    this.bus = bus
    this.record = null
    this.handlers = null
  }

  browse (_query, handlers) {
    this.handlers = handlers
    return { stop: () => { this.handlers = null } }
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
    return {
      stop: () => {
        if (this.record !== record) return
        this.bus.delete(this)
        for (const peer of this.bus) peer.handlers?.onServiceDown?.(asService(record))
      }
    }
  }
}

function asService (record) {
  return { ...record, name: record.name, txt: record.txt, port: record.port, addresses: ['127.0.0.1'], host: '127.0.0.1' }
}

describe('P2PMD notes over the local network, with no internet', () => {
  const bus = new Set()
  const lans = []
  const closers = []

  async function device () {
    const lan = await lanDevice(bus)
    lans.push(lan)
    return lan
  }

  // A note's server, which answers only requests that carry its token when
  // given one, as P2PMD's does.
  async function noteServer (body, token = null) {
    const server = http.createServer((req, res) => {
      if (token && req.headers[LOOPBACK_TOKEN_HEADER.toLowerCase()] !== token) {
        res.statusCode = 403
        return res.end('no')
      }
      res.end(body)
    }).listen(0, '127.0.0.1')
    await new Promise((resolve) => server.on('listening', resolve))
    closers.push(() => new Promise((resolve) => server.close(resolve)))
    return server.address().port
  }

  function get (port, path = '/') {
    return new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path }, (res) => {
        let text = ''
        res.on('data', (chunk) => { text += chunk })
        res.on('end', () => resolve(text))
      }).on('error', reject)
    })
  }

  async function open (instance) {
    closers.push(() => instance.close())
    await instance.open()
    return instance
  }

  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close().catch(() => {})
    for (const lan of lans.splice(0)) await lan.destroy().catch(() => {})
    bus.clear()
  })

  it('finds a note under the same topic the desktop uses, so a phone and a desktop find each other', () => {
    assert.equal(b(noteTopic(Buffer.alloc(32, 0xab))), 'ac8036871e559a7bd01d651a1fe6e2f92d9d7397c89c638fdf693f6ca76614de')
  })

  it('works out the key a host tells its port under as the desktop does', () => {
    assert.equal(b(notePortKeyPair(Buffer.alloc(32, 1)).publicKey), '34ae754ccc5daf1768b69dc12407461e7ecbdb5259a738f5883b458a95d745e3')
  })

  // Over the internet a joiner listens on the port in the host's record. On
  // the Wi-Fi there is no record, so the host says it there.
  it('a note joined over the Wi-Fi listens on the port its host keeps it on', async () => {
    const phone = await device()
    const other = await device()
    const port = await freePort()
    const host = await open(new TunnelHost({ port, bootstrap: OFFLINE, lan: phone, settleMs: 300 }))
    const route = await findNoteRouteOnLan(other, { publicKey: host.keyPair.publicKey, keyPair: host.keyPair })
    assert.equal(route.port, port)

    const guest = await open(new TunnelGuest({ key: host.info.url, bootstrap: OFFLINE, lan: other }))
    assert.equal(guest.info.lan, true)
    assert.equal(guest.info.port, port)
  })

  // A network change, or the stores closing for a backup, starts the local
  // network again as a new instance. Offline a note stopped syncing once its
  // host dropped off and came back, while online it carried on.
  it('a note moves to a new local network instance on the host, and its guest finds it there', { timeout: 60000 }, async () => {
    let hostLan = await device()
    const guestLan = await device()
    const port = await noteServer('# Still here')
    const host = await open(new TunnelHost({ port, bootstrap: OFFLINE, lan: hostLan, getLan: () => hostLan, settleMs: 300 }))
    const guest = await open(new TunnelGuest({ key: host.info.url, port: 0, bootstrap: OFFLINE, lan: guestLan, getLan: () => guestLan }))
    assert.equal(await get(guest.info.port), '# Still here')

    // The host's instance goes with no word to anyone, and a new one starts.
    await hostLan.destroy()
    hostLan = await device()
    let text = null
    for (let i = 0; i < 40 && text !== '# Still here'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      text = await get(guest.info.port).catch(() => null)
    }
    assert.equal(text, '# Still here')
    assert.equal(host.lanHost.lan, hostLan)
    assert.equal(guest.lanRoute.lan, guestLan)
  })

  it('drops a connection to a host that is gone instead of waiting on it forever', { timeout: 30000 }, async () => {
    const hostLan = await device()
    const guestLan = await device()
    const port = await noteServer('# Gone soon')
    const host = new TunnelHost({ port, bootstrap: OFFLINE, lan: hostLan, settleMs: 300 })
    await host.open()
    const guest = await open(new TunnelGuest({ key: host.info.url, port: 0, bootstrap: OFFLINE, lan: guestLan }))
    assert.equal(await get(guest.info.port), '# Gone soon')

    await host.close()
    const started = Date.now()
    assert.equal(await get(guest.info.port).catch(() => null), null)
    assert.ok(Date.now() - started < LAN_OPEN_MS + 3000, `took ${Date.now() - started} ms`)
    assert.ok(guest.lanRoute.failedAt > 0)
  })

  it('a private note hosted with no internet opens over the Wi-Fi from its address alone', async () => {
    const phone = await device()
    const other = await device()
    const port = await noteServer('# Trip plan')
    const host = await open(new TunnelHost({ port, bootstrap: OFFLINE, lan: phone, settleMs: 300 }))
    assert.equal(host.info.lan, true)
    assert.equal(host.info.internet, false)

    const guest = await open(new TunnelGuest({ key: host.info.url, port: 0, bootstrap: OFFLINE, lan: other }))
    assert.equal(guest.info.lan, true)
    assert.equal(await get(guest.info.port), '# Trip plan')
  })

  it('keeps other apps on the phone out of a note joined over the Wi-Fi, as over the internet', async () => {
    const phone = await device()
    const other = await device()
    const hostToken = createLoopbackToken()
    const guestToken = createLoopbackToken()
    const port = await noteServer('# Locked', hostToken)
    const host = await open(new TunnelHost({ port, token: hostToken, bootstrap: OFFLINE, lan: phone, settleMs: 300 }))
    const guest = await open(new TunnelGuest({ key: host.info.url, port: 0, token: guestToken, bootstrap: OFFLINE, lan: other }))

    // The editor puts this phone's token in the address; the host's server
    // gets its own token from the host's end of the tunnel.
    assert.equal(await get(guest.info.port, `/doc?token=${guestToken}`), '# Locked')
    assert.notEqual(await get(guest.info.port).catch(() => null), '# Locked')
  })

  it('does not let in a key that is not the address\'s, and the join goes to the internet', async () => {
    const phone = await device()
    const other = await device()
    const port = await noteServer('secret')
    const host = await open(new TunnelHost({ port, bootstrap: OFFLINE, lan: phone, settleMs: 300 }))
    const route = await findNoteRouteOnLan(other, { publicKey: host.keyPair.publicKey, keyPair: HyperDHT.keyPair() })
    assert.equal(route, null)
  })

  it('stops looking after a moment when nobody on the Wi-Fi has the note', async () => {
    const lan = await device()
    const started = Date.now()
    assert.equal(await findNoteRouteOnLan(lan, { publicKey: randomBytes(32) }), null)
    assert.ok(Date.now() - started < 3000)
  })

  it('a public note opens over the Wi-Fi too', async () => {
    const phone = await device()
    const other = await device()
    const port = await noteServer('# Public')
    const host = await open(new TunnelHost({ key: randomBytes(32).toString('hex'), secure: false, port, bootstrap: OFFLINE, lan: phone, settleMs: 300 }))
    const guest = await open(new TunnelGuest({ key: host.info.url, port: 0, bootstrap: OFFLINE, lan: other }))
    assert.equal(guest.info.lan, true)
    assert.equal(await get(guest.info.port), '# Public')
  })

  it('stops trying the internet once the note is closed', async () => {
    const phone = await device()
    const port = await noteServer('x')
    const host = new TunnelHost({ port, bootstrap: OFFLINE, lan: phone, settleMs: 300 })
    await host.open()
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.ok(host.retry)
    await host.close()
    assert.equal(host.retry, null)
    assert.equal(host.lanHost, null)
  })

  it('with no local network either, hosting fails as it did before', async () => {
    const port = await noteServer('x')
    const host = new TunnelHost({ port, bootstrap: OFFLINE })
    closers.push(() => host.close())
    await assert.rejects(host.open())
  })
})

describe('P2PMD notes with the internet and the local network', () => {
  let testnet
  const bus = new Set()
  const lans = []
  const closers = []

  before(async () => {
    testnet = await createTestnet(3)
  })

  after(async () => {
    for (const close of closers.splice(0).reverse()) await close().catch(() => {})
    for (const lan of lans.splice(0)) await lan.destroy().catch(() => {})
    await testnet.destroy()
  })

  async function device () {
    const lan = await lanDevice(bus)
    lans.push(lan)
    return lan
  }

  it('a host on both is found on the internet by a device that is not on the Wi-Fi', async () => {
    const server = http.createServer((req, res) => res.end('# Both')).listen(0, '127.0.0.1')
    await new Promise((resolve) => server.on('listening', resolve))
    closers.push(() => new Promise((resolve) => server.close(resolve)))
    const host = new TunnelHost({ port: server.address().port, bootstrap: testnet.bootstrap, lan: await device() })
    closers.push(() => host.close())
    await host.open()
    assert.equal(host.info.internet, true)
    assert.equal(host.info.lan, true)

    const guest = new TunnelGuest({ key: host.info.url, port: 0, bootstrap: testnet.bootstrap })
    closers.push(() => guest.close())
    await guest.open()
    assert.equal(guest.info.lan, false)
    const text = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: guest.info.port, path: '/' }, (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => resolve(body))
      }).on('error', reject)
    })
    assert.equal(text, '# Both')
  })
})

// Devices' ports are below 30000. macOS and Linux hand out ports above 32768
// on their own, and the suite runs files side by side, so a port above that
// was at times taken already: the device failed to start, and as destroying
// an instance that never started does not free it, this file never ended.
// The other local network tests here keep to 30000 and up.
let nextLanPort = 20000 + (process.pid % 4000) * 2

async function lanDevice (bus) {
  const lan = new HyperDHTmDNS({ host: '127.0.0.1', port: nextLanPort++, allowLoopback: true, adapter: new MemoryAdapter(bus) })
  await lan.ready()
  return lan
}

async function freePort () {
  const server = http.createServer().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.on('listening', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

function b (bytes) {
  return Buffer.from(bytes).toString('hex')
}
