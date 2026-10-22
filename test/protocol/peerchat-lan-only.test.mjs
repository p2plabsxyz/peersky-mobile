import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import HyperDHTmDNS from '@p2plabs/hyperdht-mdns'
import Hyperswarm from 'hyperswarm'

import { readSignedMessage } from '../../backend/peerchat/message-signature.mjs'
import { derivePeerChatTopic } from '../../backend/peerchat/protocol.mjs'
import { PRE_JOINED_PEERCHAT_ROOM_KEY } from '../../backend/peerchat/rooms.mjs'
import { PeerChatService } from '../../backend/peerchat/service.mjs'

// PeerChat with no internet at all, only the Wi-Fi, through hyperdht-mdns 2.
// Each device's LAN connections use a key made up for the network, so the
// connection says nothing about who is on the other end; devices prove who
// they are inside the channel, to the people they share a room with. Here
// three devices chat that way, and one goes into airplane mode, misses
// messages, and comes back on a new network key to get every one of them,
// each still its author's. Skipped where the installed hyperdht-mdns has no
// identity gate (version 1).

const WAIT_MS = 20_000
const topicOf = (roomKey) => b4a.toString(derivePeerChatTopic(roomKey), 'hex')
const REPUBLIC = topicOf(PRE_JOINED_PEERCHAT_ROOM_KEY)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const supported = typeof HyperDHTmDNS.identityGate === 'function'

let root = ''
let roomKey = ''
let nextPort = 24601
const bus = new Set()
let a, b, c

class Feed extends EventEmitter {
  constructor (log) {
    super()
    this.log = log
  }

  get length () { return this.log.entries.length }
  get byteLength () { return 0 }
  async ready () {}
  async append (entry) {
    this.log.entries.push(structuredClone(entry))
    this.emit('append')
  }

  async get (index) { return structuredClone(this.log.entries[index]) }
  async close () {}
}

// The Wi-Fi's multicast, in memory: every device's record reaches the others,
// every sighting is reported, and a device that leaves says goodbye.
class MemoryAdapter {
  constructor () {
    this.liveness = true
    this.record = null
    this.handlers = null
  }

  browse (_query, handlers) {
    this.handlers = handlers
    for (const peer of bus) if (peer !== this && peer.record) setImmediate(() => this.handlers?.onService(asService(peer.record)))
    return { query () {}, stop: () => { this.handlers = null } }
  }

  advertise (record) {
    this.record = record
    bus.add(this)
    for (const peer of bus) if (peer !== this) setImmediate(() => peer.handlers?.onService(asService(record)))
    return {
      stop: () => {
        bus.delete(this)
        for (const peer of bus) setImmediate(() => peer.handlers?.onServiceDown({ name: record.name, referer: { address: '127.0.0.1', port: record.port } }))
      }
    }
  }
}

function asService (record) {
  return { ...record, addresses: ['127.0.0.1'], referer: { address: '127.0.0.1', port: record.port } }
}

function makeDevice (letter) {
  const keyPair = crypto.keyPair()
  return {
    name: `Test ${letter}`,
    keyPair,
    id: b4a.toString(keyPair.publicKey, 'hex').slice(0, 8),
    storagePath: path.join(root, letter),
    logs: new Map(),
    online: false
  }
}

// A device starting up with the Wi-Fi only: its internet swarm has nobody to
// ask, and its LAN instance is new, with a new key.
async function start (device) {
  const swarm = new Hyperswarm({ keyPair: device.keyPair, bootstrap: [] })
  const feeds = new Map()
  const sdk = {
    publicKey: device.keyPair.publicKey,
    swarm,
    corestore: {
      get: ({ name }) => {
        if (!device.logs.has(name)) device.logs.set(name, { entries: [] })
        if (!feeds.has(name)) feeds.set(name, new Feed(device.logs.get(name)))
        return feeds.get(name)
      },
      createKeyPair: async (name) => (name === 'noise' ? device.keyPair : crypto.keyPair())
    },
    join: (topic, opts) => {
      if (b4a.toString(topic, 'hex') === REPUBLIC) throw new Error('P2P Republic is off limits here')
      return swarm.join(topic, opts)
    },
    leave: (topic) => swarm.leave(topic),
    ready: async () => {},
    suspend: async () => {},
    resume: async () => {},
    close: async () => {}
  }
  const lan = new HyperDHTmDNS({
    host: '127.0.0.1',
    port: nextPort++,
    allowLoopback: true,
    adapter: new MemoryAdapter(),
    // Every device here shares 127.0.0.1; told apart by port, as separate
    // machines would be by address.
    hostKey: (address) => `${address.host}:${address.port}`
  })
  await HyperDHTmDNS.attachHyperSDK(sdk, { lan })
  Object.assign(device, { sdk, swarm, lan, online: true })
  device.service = await new PeerChatService({ sdk, storagePath: device.storagePath }).start()
  device.service.setProfile({ username: device.name })
}

// Airplane mode: the app's connections go, and what it stored stays.
async function stop (device) {
  device.online = false
  await device.service.close()
  await device.sdk.close()
  await device.swarm.destroy()
}

async function waitFor (check, what) {
  const until = Date.now() + WAIT_MS
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`Timed out waiting for ${typeof what === 'function' ? await what() : what}`)
    await sleep(50)
  }
}

const roomPeers = (device) => [...new Set([...device.service.peers.values()]
  .filter((peer) => peer.rooms.includes(roomKey) && !peer.connection.destroyed)
  .map((peer) => peer.id))].sort()
const idsOf = (...list) => list.map((device) => device.id).sort()
const sameIds = (left, right) => left.join() === right.join()
const shown = async (device) => (await device.service.getSnapshot({ roomKey, version: -1 })).messages
  .filter((message) => !message.system)

async function expectMessages (device, messages) {
  let list = []
  const missing = () => messages.filter((sent) => !list.some((message) => message.id === sent.id))
  await waitFor(async () => {
    list = await shown(device)
    return missing().length === 0
  }, () => `${device.name} to show ${missing().map((sent) => `"${sent.text}"`).join(', ')}`)
  for (const sent of messages) {
    const message = list.find((candidate) => candidate.id === sent.id)
    assert.equal(message.message, sent.text)
    assert.equal(message.sender, sent.by.id, `"${sent.text}" on ${device.name} should be ${sent.by.name}'s`)
    const stored = device.logs.get(`chat-${roomKey}`)?.entries.find((entry) => entry.id === sent.id)
    assert.equal(readSignedMessage(stored, topicOf(roomKey))?.authorId, sent.by.id)
  }
}

async function say (from, to, text) {
  const { id } = await from.service.sendMessage({ roomKey, message: text })
  const sent = { id, by: from, text }
  await expectMessages(to, [sent])
  return sent
}

describe('PeerChat over the Wi-Fi alone', { skip: !supported && 'hyperdht-mdns has no identity gate' }, () => {
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-lan-only-'))
    ;[a, b, c] = ['A', 'B', 'C'].map(makeDevice)
    for (const device of [a, b, c]) await start(device)
    roomKey = (await b.service.createRoom({ name: 'Wi-Fi only' })).roomKey
    for (const device of [a, c]) await device.service.joinRoom({ roomKey })
    const all = [a, b, c]
    await waitFor(() => all.every((device) => sameIds(roomPeers(device), idsOf(...all.filter((other) => other !== device)))),
      () => 'all three in the room together; ' + all.map((device) => `${device.name} is with ${roomPeers(device).join(',') || 'nobody'} ${JSON.stringify(device.lan.info())} peers=${device.service.peers.size} pending=${device.service.pendingPeers?.size}`).join('; '))
  }, { timeout: 60_000 })

  after(async () => {
    for (const device of [a, b, c]) {
      if (!device?.online) continue
      await stop(device).catch(() => {})
    }
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('knows everyone by the key they proved, never by the network key', () => {
    for (const device of [a, b, c]) {
      assert.equal(device.lan.ephemeral, true)
      assert.equal(b4a.equals(device.lan.keyPair.publicKey, device.keyPair.publicKey), false)
      for (const peer of device.service.peers.values()) {
        assert.equal(b4a.equals(peer.connection.remotePublicKey, b4a.from(peer.key, 'hex')), false, 'the connection key is not the one a peer goes by')
      }
    }
  })

  it('a device back from airplane mode, on a new network key, gets everything it missed', { timeout: 60_000 }, async () => {
    const first = await say(b, a, 'Before the flight, from B')
    await expectMessages(c, [first])
    const oldKey = b4a.toString(a.lan.keyPair.publicKey, 'hex')

    await stop(a)
    await waitFor(() => sameIds(roomPeers(b), idsOf(c)) && sameIds(roomPeers(c), idsOf(b)), 'B and C to see A go')
    const missed = [
      await say(b, c, 'While A was away, from B'),
      await say(c, b, 'While A was away, from C')
    ]

    await start(a)
    assert.notEqual(b4a.toString(a.lan.keyPair.publicKey, 'hex'), oldKey)
    await expectMessages(a, [first, ...missed])
    await waitFor(() => sameIds(roomPeers(a), idsOf(b, c)), 'A back with B and C')
    // And still talks, as itself.
    const back = await say(a, b, 'Landed, from A')
    await expectMessages(c, [back])
  })
})

// The two sides of a connection finish proving at different moments. The side
// that finishes first opens PeerChat, and the other holds that open until its
// own gate is done instead of refusing it.
describe('PeerChat when one side finishes proving well before the other', { skip: !supported && 'hyperdht-mdns has no identity gate' }, () => {
  const services = []
  let dir = ''

  after(async () => {
    for (const service of services) await service.close().catch(() => {})
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  async function device (letter, slow = 0) {
    const keyPair = crypto.keyPair()
    const logs = new Map()
    const swarm = new EventEmitter()
    swarm.flush = async () => {}
    const sdk = {
      publicKey: keyPair.publicKey,
      swarm,
      corestore: {
        get: ({ name }) => {
          if (!logs.has(name)) logs.set(name, new Feed({ entries: [] }))
          return logs.get(name)
        },
        createKeyPair: async (name) => (name === 'noise' ? keyPair : crypto.keyPair())
      },
      join: () => ({ flushed: async () => true, refresh: async () => {}, destroy: async () => {} }),
      leave: async () => {}
    }
    const identityGate = (...args) => HyperDHTmDNS.identityGate(...args)
      .then((result) => new Promise((resolve) => setTimeout(() => resolve(result), slow)))
    const service = await new PeerChatService({ sdk, storagePath: path.join(dir, letter), identityGate }).start()
    service.setProfile({ username: `Test ${letter}` })
    services.push(service)
    return { swarm, service, id: b4a.toString(keyPair.publicKey, 'hex').slice(0, 8) }
  }

  it('opens the room on both sides', { timeout: 30_000 }, async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-lan-race-'))
    const quick = await device('D')
    const slow = await device('E', 300)
    const { roomKey: key } = await quick.service.createRoom({ name: 'Night shift' })
    await slow.service.joinRoom({ roomKey: key })

    const { default: NoiseSecretStream } = await import('@hyperswarm/secret-stream')
    const left = new NoiseSecretStream(true, null, { keyPair: crypto.keyPair() })
    const right = new NoiseSecretStream(false, null, { keyPair: crypto.keyPair() })
    left.rawStream.pipe(right.rawStream).pipe(left.rawStream)
    left.on('error', () => {})
    right.on('error', () => {})
    await Promise.all([left.opened, right.opened])
    quick.swarm.emit('connection', left, { lan: true, ephemeral: true })
    slow.swarm.emit('connection', right, { lan: true, ephemeral: true })

    const inRoom = (from, other) => [...from.service.peers.values()].some((peer) => peer.id === other.id && peer.rooms.includes(key))
    await waitFor(() => inRoom(quick, slow) && inRoom(slow, quick), 'both in the room on both sides')
    left.destroy()
    right.destroy()
  })
})
