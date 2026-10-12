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

async function connect (service, keyPair, { haves = true } = {}) {
  const frames = []
  const key = keyOf(keyPair)
  const peer = createFakePeer(key, frames)
  service.peers.set(peer.connection, peer)
  await service.handlePeerMessage(peer, {
    type: 'topics',
    rooms: [{ topic: wireRoom(ROOM), proof: roomProof(ROOM, HANDSHAKE, key) }],
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
