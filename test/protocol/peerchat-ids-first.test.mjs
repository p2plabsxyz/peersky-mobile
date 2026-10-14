import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import crypto from 'hypercore-crypto'

import { PeerChatService } from '../../backend/peerchat/service.mjs'
import {
  createPeerChatMessageId,
  derivePeerChatTopic,
  encryptPeerChatMessage
} from '../../backend/peerchat/protocol.mjs'
import { encodeMessagePayload } from '../../backend/peerchat/link-preview.mjs'
import { signMessage } from '../../backend/peerchat/message-signature.mjs'
import { roomProof } from '../../backend/peerchat/room-proof.mjs'

// Ids first: a newer build hears only the id of each new message from most of
// its connections, and asks one of them for the message itself. An older build
// is passed whole messages as before. The desktop has the same in peerchat's
// test/ids-first.test.js.

const ROOM = 'c1'.repeat(32)
const HANDSHAKE = Buffer.alloc(64, 9)
const wireRoom = (roomKey) => derivePeerChatTopic(roomKey).toString('hex')
const pair = (n) => crypto.keyPair(Buffer.alloc(32, n))
const keyOf = (keyPair) => keyPair.publicKey.toString('hex')
const PHONE = pair(71)
const WRITER = pair(72)
const ALICE = pair(73)
const BOB = pair(74)
const OLDER = pair(75)
const FAR = pair(76)

function written (keyPair, text) {
  const id = createPeerChatMessageId()
  const sealed = encryptPeerChatMessage(encodeMessagePayload(text), ROOM)
  const ts = Date.now()
  return { id, sender: keyOf(keyPair).slice(0, 8), sn: 'Writer', ...sealed, ts, ...signMessage({ topic: wireRoom(ROOM), id, ts, sn: 'Writer' }, sealed, keyPair) }
}

async function setUp (t) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-ids-first-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => service.close())
  service.setProfile({ username: 'Phone', bio: '' })
  await service.joinRoom({ roomKey: ROOM })
  service.rooms.get(ROOM).joinedAt = Date.now() - 60_000
  return service
}

async function connect (service, keyPair, { haves = true, rooms = [ROOM] } = {}) {
  const frames = []
  const key = keyOf(keyPair)
  const peer = createFakePeer(key, frames)
  service.peers.set(peer.connection, peer)
  await service.handlePeerMessage(peer, {
    type: 'topics',
    rooms: rooms.map((roomKey) => ({ topic: wireRoom(roomKey), proof: roomProof(roomKey, HANDSHAKE, key) })),
    pass: true,
    ...(haves && { have: true })
  })
  peer.ids = (type) => frames.filter((frame) => frame.type === type).flatMap((frame) => frame.ids || [])
  peer.passed = (id) => frames.filter((frame) => frame.type === 'pass' && frame.m?.id === id)
  return peer
}

const shown = async (service) => (await service.getSnapshot({ roomKey: ROOM, version: -1 })).messages
  .filter((message) => !message.system).map((message) => message.message)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('a newer build is told only the id, and an older one is passed the whole message', async (t) => {
  const service = await setUp(t)
  const writer = await connect(service, WRITER)
  const alice = await connect(service, ALICE)
  const bob = await connect(service, BOB)
  const older = await connect(service, OLDER, { haves: false })

  const message = written(WRITER, 'Hello room')
  await service.handlePeerMessage(writer, { ...message, roomKey: ROOM })
  await sleep(120)
  assert.ok(alice.ids('have').includes(message.id))
  assert.ok(bob.ids('have').includes(message.id))
  assert.equal(alice.passed(message.id).length, 0)
  assert.equal(older.passed(message.id).length, 1)
  assert.equal(writer.ids('have').includes(message.id), false)

  // Asked for it, a neighbour gets the whole message.
  await service.handlePeerMessage(alice, { type: 'want', roomKey: ROOM, ids: [message.id] })
  assert.equal(alice.passed(message.id)[0]?.m.as, message.as)
})

test('a message heard of by id is asked for, taken once, and passed on by id', async (t) => {
  const service = await setUp(t)
  const alice = await connect(service, ALICE)
  const bob = await connect(service, BOB)

  const message = written(pair(80), 'Heard about')
  await service.handlePeerMessage(alice, { type: 'have', roomKey: ROOM, ids: [message.id] })
  assert.ok(alice.ids('want').includes(message.id))
  await service.handlePeerMessage(alice, { type: 'pass', roomKey: ROOM, m: message })
  assert.ok((await shown(service)).includes('Heard about'))
  await sleep(120)
  assert.ok(bob.ids('have').includes(message.id))
  assert.equal(alice.ids('have').includes(message.id), false)
  // A second copy changes nothing.
  await service.handlePeerMessage(alice, { type: 'pass', roomKey: ROOM, m: message })
  assert.equal((await shown(service)).filter((text) => text === 'Heard about').length, 1)
})

test('asking goes on when the first answer does not check out', async (t) => {
  const service = await setUp(t)
  const alice = await connect(service, ALICE)
  const bob = await connect(service, BOB)

  const message = written(pair(82), 'The real one')
  await service.handlePeerMessage(alice, { type: 'have', roomKey: ROOM, ids: [message.id] })
  await service.handlePeerMessage(bob, { type: 'have', roomKey: ROOM, ids: [message.id] })
  await service.handlePeerMessage(alice, { type: 'pass', roomKey: ROOM, m: { ...message, as: '00'.repeat(64) } })
  assert.equal((await shown(service)).includes('The real one'), false)
  for (let i = 0; i < 60 && !bob.ids('want').includes(message.id); i += 1) await sleep(100)
  assert.ok(bob.ids('want').includes(message.id))
  await service.handlePeerMessage(bob, { type: 'pass', roomKey: ROOM, m: message })
  assert.ok((await shown(service)).includes('The real one'))
})

test('the next neighbour that has it is asked when the first does not answer', async (t) => {
  const service = await setUp(t)
  const bob = await connect(service, BOB)
  const far = await connect(service, FAR)

  const message = written(pair(81), 'Second try')
  await service.handlePeerMessage(bob, { type: 'have', roomKey: ROOM, ids: [message.id] })
  await service.handlePeerMessage(far, { type: 'have', roomKey: ROOM, ids: [message.id] })
  assert.ok(bob.ids('want').includes(message.id))
  assert.equal(far.ids('want').includes(message.id), false)
  // Bob never answers. A few seconds on, Far is asked.
  for (let i = 0; i < 60 && !far.ids('want').includes(message.id); i += 1) await sleep(100)
  assert.ok(far.ids('want').includes(message.id))
  await service.handlePeerMessage(far, { type: 'pass', roomKey: ROOM, m: message })
  assert.ok((await shown(service)).includes('Second try'))
})

// The list of ids being asked for holds 4096, for every room at once. One
// connection in P2P Republic filled it with made-up ids, and a real message in
// another room was then never asked for. Each connection may have 512 waiting
// and each room 2048, and the rest go on being asked for.
test('no one connection, and no one room, can fill the list of ids being asked for', async (t) => {
  const service = await setUp(t)
  const OTHER = 'c2'.repeat(32)
  await service.joinRoom({ roomKey: OTHER })
  const madeUp = () => Array.from({ length: 256 }, () => createPeerChatMessageId())

  const flooder = await connect(service, pair(90))
  for (let i = 0; i < 16; i += 1) await service.handlePeerMessage(flooder, { type: 'have', roomKey: ROOM, ids: madeUp() })
  assert.equal(flooder.ids('want').length, 512)
  const honest = await connect(service, pair(91), { rooms: [OTHER] })
  const real = createPeerChatMessageId()
  await service.handlePeerMessage(honest, { type: 'have', roomKey: OTHER, ids: [real] })
  assert.ok(honest.ids('want').includes(real))

  // Eight connections in one room reach that room's share and no further.
  for (let n = 0; n < 7; n += 1) {
    const more = await connect(service, pair(92 + n))
    for (let i = 0; i < 2; i += 1) await service.handlePeerMessage(more, { type: 'have', roomKey: ROOM, ids: madeUp() })
  }
  assert.equal(service.wantedPerRoom.get(ROOM), 2048)
  const later = createPeerChatMessageId()
  await service.handlePeerMessage(honest, { type: 'have', roomKey: OTHER, ids: [later] })
  assert.ok(honest.ids('want').includes(later))

  // Ids given up on come off the counts, so the connection can ask again.
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 31_000)
  service.retryWants()
  assert.equal(flooder.wanting, 0)
  assert.equal(service.wantedPerRoom.size, 0)
  assert.equal(service.wantedIds.size, 0)
})

function createFakeSdk () {
  const feeds = new Map()
  const swarm = new EventEmitter()
  swarm.flush = async () => {}
  return {
    publicKey: PHONE.publicKey,
    swarm,
    localSwarm: new EventEmitter(),
    corestore: {
      get ({ name }) {
        if (!feeds.has(name)) feeds.set(name, new FakeFeed())
        return feeds.get(name)
      },
      async createKeyPair (name) {
        return name === 'noise' ? PHONE : crypto.keyPair()
      }
    },
    join () {},
    async leave () {}
  }
}

function createFakePeer (key, frames) {
  return {
    active: true,
    connection: { destroyed: false, handshakeHash: HANDSHAKE, publicKey: PHONE.publicKey },
    id: key.slice(0, 8),
    key,
    buffer: '',
    pendingMessages: 0,
    processing: Promise.resolve(),
    lastReceivedAt: Date.now(),
    username: key.slice(0, 8),
    bio: '',
    avatar: null,
    rooms: [],
    controlRate: { count: 0, resetsAt: Date.now() + 60_000 },
    liveRate: { count: 0, resetsAt: Date.now() + 60_000 },
    transport: { send: (frame) => frames.push(JSON.parse(frame)) || true }
  }
}

class FakeFeed extends EventEmitter {
  constructor () {
    super()
    this.entries = []
  }

  get length () {
    return this.entries.length
  }

  get byteLength () {
    return Buffer.byteLength(JSON.stringify(this.entries))
  }

  async ready () {}

  async append (entry) {
    this.entries.push(structuredClone(entry))
    this.emit('append')
  }

  async get (index) {
    return structuredClone(this.entries[index])
  }

  async close () {}
}
