import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import crypto from 'hypercore-crypto'

import { PeerChatService } from '../../backend/peerchat/service.mjs'
import { derivePeerChatTopic } from '../../backend/peerchat/protocol.mjs'
import { roomProof } from '../../backend/peerchat/room-proof.mjs'
import { makeCreatorRoomKey } from '../../backend/peerchat/room-move.mjs'
import { avatarHash, checkRoomDetails, signRoomDetails } from '../../backend/peerchat/room-details.mjs'

// A room's details, signed by the person who made the room: the creator changes
// them and everyone in the room takes the change, from anyone; nobody else can
// change them. The desktop has the same in peerchat's
// test/room-details-flow.test.js.

const wireRoom = (roomKey) => derivePeerChatTopic(roomKey).toString('hex')
const HANDSHAKE = Buffer.alloc(64, 9)
const pair = (n) => crypto.keyPair(Buffer.alloc(32, n))
const keyOf = (keyPair) => keyPair.publicKey.toString('hex')
const PHONE = pair(91)
const CREATOR = pair(92)
const MEMBER = pair(93)
const SECOND = pair(94)
const FORGER = pair(95)
const PICTURE = 'data:image/png;base64,iVBORw0KGgo='

async function startService (t) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-room-details-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => service.close())
  await service.loadSigningKeys()
  service.setProfile({ username: 'Ada', bio: '' })
  return service
}

async function connect (service, keyPair, roomKeys) {
  const frames = []
  const key = keyOf(keyPair)
  const peer = createFakePeer(key, frames)
  service.peers.set(peer.connection, peer)
  peer.of = (type, roomKey) => frames.filter((frame) => frame.type === type && (!roomKey || frame.room === wireRoom(roomKey)))
  await service.handlePeerMessage(peer, {
    type: 'topics',
    rooms: roomKeys.map((roomKey) => ({ topic: wireRoom(roomKey), proof: roomProof(roomKey, HANDSHAKE, key) })),
    pass: true,
    move: true
  })
  return peer
}

const signedBy = (keyPair, roomKey, details) => signRoomDetails({
  topic: wireRoom(roomKey),
  name: 'Club',
  bio: '',
  link: '',
  avatar: '',
  moderation: { abuseFilter: true, nsfwFilter: true, spamRateLimit: 10 },
  keyPair,
  ...details
})

test('a room made on the phone goes out with its details signed, and a change goes to everyone in it', async (t) => {
  const service = await startService(t)
  const { roomKey } = await service.createRoom({ name: 'Book club', bio: 'Monthly' })
  const member = await connect(service, MEMBER, [roomKey])
  const first = member.of('room-meta', roomKey).find((frame) => frame.details)
  assert.ok(first, 'signed details')
  assert.equal(first.details.name, 'Book club')
  assert.ok(checkRoomDetails({ topic: wireRoom(roomKey), creatorKey: keyOf(PHONE), details: first.details }))

  service.updateRoom({ roomKey, name: 'Reading club', avatar: PICTURE, moderation: { abuseFilter: true, nsfwFilter: true, spamRateLimit: 5 } })
  const changed = member.of('room-meta', roomKey).find((frame) => frame.details?.name === 'Reading club')
  assert.ok(changed, 'the change')
  assert.ok(changed.details.v > first.details.v)
  assert.ok(checkRoomDetails({ topic: wireRoom(roomKey), creatorKey: keyOf(PHONE), details: changed.details }))
  assert.equal(changed.avatar, PICTURE)
  assert.equal(changed.details.avatar, avatarHash(PICTURE))
  assert.equal(changed.details.moderation.spamRateLimit, 5)
  assert.equal(service.listRooms().find((room) => room.roomKey === roomKey).name, 'Reading club')
})

test('a room somebody else made takes their signed details from anyone in it, passes them on, and nothing else', async (t) => {
  const service = await startService(t)
  const club = makeCreatorRoomKey(keyOf(CREATOR))
  await service.joinRoom({ roomKey: club.roomKey })
  const member = await connect(service, MEMBER, [club.roomKey])
  const second = await connect(service, SECOND, [club.roomKey])
  const room = () => service.listRooms().find((entry) => entry.roomKey === club.roomKey)

  // Before anyone has shown who made the room, signed details wait.
  await service.handlePeerMessage(member, {
    type: 'room-meta', roomKey: club.roomKey, name: 'Club', details: signedBy(CREATOR, club.roomKey, { v: 3, name: 'Club, signed' })
  })
  assert.notEqual(room().name, 'Club, signed')
  await service.handlePeerMessage(member, {
    type: 'room-meta', roomKey: club.roomKey, name: 'Club', creatorKey: keyOf(CREATOR), creatorProof: club.creatorProof
  })
  assert.equal(room().name, 'Club, signed')

  const details = signedBy(CREATOR, club.roomKey, {
    v: 10, name: 'Club renamed', avatar: PICTURE, moderation: { abuseFilter: true, nsfwFilter: false, spamRateLimit: 15 }
  })
  await service.handlePeerMessage(member, { type: 'room-meta', roomKey: club.roomKey, name: 'Club', avatar: PICTURE, details })
  assert.equal(room().name, 'Club renamed')
  assert.equal(room().avatar, PICTURE)
  assert.deepEqual(room().moderation, { abuseFilter: true, nsfwFilter: false, spamRateLimit: 15 })
  const passed = second.of('room-meta', club.roomKey).find((frame) => frame.details?.v === 10)
  assert.deepEqual(passed?.details, details)
  assert.equal(passed.avatar, PICTURE)

  // Not from anyone else, not older, and nothing unsigned once these are here.
  await service.handlePeerMessage(member, {
    type: 'room-meta', roomKey: club.roomKey, name: 'Taken', details: signedBy(FORGER, club.roomKey, { v: 50, name: 'Taken' })
  })
  await service.handlePeerMessage(member, {
    type: 'room-meta', roomKey: club.roomKey, name: 'Club', details: signedBy(CREATOR, club.roomKey, { v: 5, name: 'Club before' })
  })
  await service.handlePeerMessage(member, {
    type: 'room-meta', roomKey: club.roomKey, name: 'Unsigned', bio: 'Unsigned bio', moderation: { abuseFilter: false }
  })
  assert.equal(room().name, 'Club renamed')
  assert.equal(room().bio, '')
  assert.equal(room().moderation.abuseFilter, true)
  assert.throws(() => service.updateRoom({ roomKey: club.roomKey, name: 'Mine now' }), /Only the person who made this room/)
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
