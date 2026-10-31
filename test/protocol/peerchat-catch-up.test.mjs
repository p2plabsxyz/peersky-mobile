import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import HyperDHT from 'hyperdht'
import createTestnet from 'hyperdht/testnet.js'
import Hyperswarm from 'hyperswarm'

import { roomRotates } from '../../backend/peerchat/key-chain.mjs'
import { readSignedMessage } from '../../backend/peerchat/message-signature.mjs'
import { derivePeerChatTopic } from '../../backend/peerchat/protocol.mjs'
import { PRE_JOINED_PEERCHAT_ROOM_KEY } from '../../backend/peerchat/rooms.mjs'
import { roomLogName } from '../../backend/peerchat/room-log.mjs'
import { PeerChatService } from '../../backend/peerchat/service.mjs'

// Catching up after being away, as tested by hand with a phone and three
// desktops, over real connections. Each device has its own key, Hyperswarm and
// DHT node on a hyperdht testnet bound to 127.0.0.1 with no public bootstrap
// nodes, so nothing leaves this machine. All four run this app's PeerChat: A
// plays the phone and B, C and D the desktops. B makes the room, one whose
// message keys rotate every hour.
//
// Round 1: A closes and D quits. B and C chat, then B goes offline and C stays
// on, idle. A comes back with only C there and has to get every message, B's
// too, which can only come through C. D comes back and gets them all as well.
//
// Round 2: A and D go offline, B comes back, B and C exchange two messages and
// B leaves. D comes back with only C there and has to get both.
//
// C can hand on B's messages as B's because every message is signed by its
// author and every device keeps the signature. PeerChat runs the same story
// with desktops in test/catch-up.test.js.

const WAIT_MS = 20_000
const topicOf = (roomKey) => b4a.toString(derivePeerChatTopic(roomKey), 'hex')
const REPUBLIC = topicOf(PRE_JOINED_PEERCHAT_ROOM_KEY)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let testnet = null
let root = ''
let roomKey = ''
let republicJoins = 0
let a, b, c, d
const round1 = []
const round2 = []

// A room's log, kept for the whole test so a device finds what it stored when
// it starts again. Each start gets its own view of it, as a store opened again
// would give, so nothing from before the restart is still listening.
class Feed extends EventEmitter {
  constructor (log) {
    super()
    this.log = log
  }

  get length () { return this.log.entries.length }
  get byteLength () { return this.log.bytes }
  async ready () {}

  async append (entry) {
    const copy = structuredClone(entry)
    this.log.entries.push(copy)
    this.log.bytes += Buffer.byteLength(JSON.stringify(copy))
    this.emit('append')
  }

  async get (index) { return structuredClone(this.log.entries[index]) }
  async close () {}
}

function makeDevice (letter) {
  const keyPair = crypto.keyPair()
  return {
    name: `Device ${letter}`,
    keyPair,
    id: b4a.toString(keyPair.publicKey, 'hex').slice(0, 8),
    storagePath: path.join(root, letter),
    logs: new Map(),
    online: false,
    service: null,
    swarm: null,
    dht: null
  }
}

// A device starting up, with the key, rooms and messages it had before.
async function start (device) {
  const dht = new HyperDHT({ bootstrap: testnet.bootstrap, host: '127.0.0.1', ephemeral: true })
  assert.ok(dht.bootstrapNodes.length > 0)
  for (const node of dht.bootstrapNodes) assert.equal(node.host, '127.0.0.1')
  const swarm = new Hyperswarm({ keyPair: device.keyPair, dht })
  const feeds = new Map()
  const sdk = {
    publicKey: device.keyPair.publicKey,
    swarm,
    corestore: {
      get: ({ name }) => {
        if (!device.logs.has(name)) device.logs.set(name, { entries: [], bytes: 0 })
        if (!feeds.has(name)) feeds.set(name, new Feed(device.logs.get(name)))
        return feeds.get(name)
      },
      createKeyPair: async (name) => (name === 'noise' ? device.keyPair : crypto.keyPair())
    },
    join: (topic, opts) => {
      if (b4a.toString(topic, 'hex') === REPUBLIC) {
        republicJoins++
        throw new Error('P2P Republic is off limits here')
      }
      return swarm.join(topic, opts)
    },
    leave: (topic) => swarm.leave(topic)
  }
  Object.assign(device, { dht, swarm, online: true })
  device.service = await new PeerChatService({ sdk, storagePath: device.storagePath }).start()
}

// Closed, as the app closes: its connections go, and what it stored stays.
async function stop (device) {
  device.online = false
  await device.service.close()
  for (const node of device.dht.toArray()) assert.equal(node.host, '127.0.0.1')
  await device.swarm.destroy()
  await device.dht.destroy()
}

async function waitFor (check, what) {
  const until = Date.now() + WAIT_MS
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`Timed out waiting for ${typeof what === 'function' ? await what() : what}`)
    await sleep(50)
  }
}

// Who a device is in the room with right now, by id.
const roomPeers = (device) => [...new Set([...device.service.peers.values()]
  .filter((peer) => peer.rooms.includes(roomKey) && !peer.connection.destroyed)
  .map((peer) => peer.id))].sort()
const idsOf = (...list) => list.map((device) => device.id).sort()
const sameIds = (left, right) => left.join() === right.join()

const shown = async (device) => (await device.service.getSnapshot({ roomKey, version: -1 })).messages
  .filter((message) => !message.system)
const stored = (device) => device.logs.get(roomLogName(roomKey))?.entries || []

// Waits until a device shows all of these, then checks each one reads as its
// author's, as written, and is stored as below.
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
    assert.equal(message.senderName, sent.by.name)
  }
  expectStoredOnce(device, messages)
}

// Each stored once, sealed with an hour's key, and still carrying its author's
// signature, which is what lets the device hand it on.
function expectStoredOnce (device, messages) {
  for (const sent of messages) {
    const copies = stored(device).filter((entry) => entry.id === sent.id)
    assert.equal(copies.length, 1, `${device.name} stored "${sent.text}" ${copies.length} times`)
    assert.ok(Number.isSafeInteger(copies[0].e), `"${sent.text}" should be sealed with an hour's key`)
    assert.equal(readSignedMessage(copies[0], topicOf(roomKey))?.authorId, sent.by.id)
  }
}

// One message, and the other side has it before anything else is said.
async function say (from, to, text) {
  const { id } = await from.service.sendMessage({ roomKey, message: text })
  const sent = { id, by: from, text }
  await expectMessages(to, [sent])
  return sent
}

describe('PeerChat catching up through the one device still on', () => {
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-catch-up-'))
    testnet = await createTestnet(4, { host: '127.0.0.1' })
    for (const node of testnet.nodes) assert.equal(node.address().host, '127.0.0.1')
    for (const node of testnet.bootstrap) assert.equal(node.host, '127.0.0.1')

    ;[a, b, c, d] = ['A', 'B', 'C', 'D'].map(makeDevice)
    for (const device of [a, b, c, d]) {
      await start(device)
      // A name and no onboarding, which is what joins P2P Republic.
      device.service.setProfile({ username: device.name })
    }
    roomKey = (await b.service.createRoom({ name: 'Catch up' })).roomKey
    assert.ok(roomRotates(roomKey))
    // One at a time, as people do. Joined all at once, each looks the room up
    // before the others have announced it, and they only find B.
    for (const device of [a, c, d]) await device.service.joinRoom({ roomKey })

    // Everyone in the room with everyone, with the room's key chain, and
    // knowing when each of the others joined, which decides the history each
    // is sent.
    const all = [a, b, c, d]
    const others = (device) => all.filter((other) => other !== device)
    const ready = (device) => sameIds(roomPeers(device), idsOf(...others(device))) &&
      Boolean(device.service.roomChainFor(roomKey)) &&
      others(device).every((other) => device.service.peerJoinedAt(roomKey, other.id) !== null)
    await waitFor(() => all.every(ready), () => 'all four to be in the room together; ' + all.map((device) => {
      const knows = others(device).filter((other) => device.service.peerJoinedAt(roomKey, other.id) !== null)
      return `${device.name} is with ${roomPeers(device).length}, knows ${knows.length} join times` +
        (device.service.roomChainFor(roomKey) ? '' : ', has no key chain')
    }).join('; '))
  }, { timeout: 60_000 })

  after(async () => {
    for (const device of [a, b, c, d]) {
      if (!device?.online) continue
      device.online = false
      await device.service?.close().catch(() => {})
      await device.swarm?.destroy().catch(() => {})
      await device.dht?.destroy().catch(() => {})
    }
    await testnet?.destroy()
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('round 1: A comes back with only C on and gets every message, B\'s through C', { timeout: 60_000 }, async () => {
    await Promise.all([stop(a), stop(d)])
    await waitFor(() => sameIds(roomPeers(b), idsOf(c)) && sameIds(roomPeers(c), idsOf(b)), 'B and C to see A and D go')

    for (let n = 1; n <= 3; n++) {
      round1.push(await say(b, c, `Round 1, message ${n} from B`))
      round1.push(await say(c, b, `Round 1, message ${n} from C`))
    }
    await stop(b)
    c.service.setIdle(true)
    await waitFor(() => roomPeers(c).length === 0, 'C to see B go')

    await start(a)
    await expectMessages(a, round1)
    assert.deepEqual(roomPeers(a), idsOf(c))
  })

  it('round 1: D comes back and gets them all too', { timeout: 60_000 }, async () => {
    await start(d)
    await expectMessages(d, round1)
  })

  it('round 2: D comes back with only C on and gets the two messages B and C exchanged while it was away', { timeout: 60_000 }, async () => {
    await Promise.all([stop(a), stop(d)])
    await waitFor(() => roomPeers(c).length === 0, 'C to see A and D go')

    await start(b)
    await waitFor(() => sameIds(roomPeers(b), idsOf(c)) && sameIds(roomPeers(c), idsOf(b)), 'B and C to meet again')
    round2.push(await say(b, c, 'Round 2 from B'))
    round2.push(await say(c, b, 'Round 2 from C'))
    await stop(b)
    await waitFor(() => roomPeers(c).length === 0, 'C to see B go')

    await start(d)
    await expectMessages(d, [...round1, ...round2])
    assert.deepEqual(roomPeers(d), idsOf(c))
  })

  it('stores a message only once when history brings it again', () => {
    // B came back to history it already had, and D was sent round 1 by both
    // A and C.
    expectStoredOnce(a, round1)
    expectStoredOnce(b, [...round1, ...round2])
    expectStoredOnce(c, [...round1, ...round2])
    expectStoredOnce(d, [...round1, ...round2])
  })

  it('never joined P2P Republic', () => {
    assert.equal(republicJoins, 0)
    for (const device of [a, b, c, d]) assert.equal(device.service.rooms.has(PRE_JOINED_PEERCHAT_ROOM_KEY), false)
  })
})
