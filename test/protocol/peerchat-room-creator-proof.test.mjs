import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import crypto from 'hypercore-crypto'

import { PeerChatService } from '../../backend/peerchat/service.mjs'
import { derivePeerChatTopic } from '../../backend/peerchat/protocol.mjs'
import { signRemovals } from '../../backend/peerchat/removal-signature.mjs'
import { checkCreatorProof, makeCreatorRoomKey } from '../../backend/peerchat/room-move.mjs'

// Who made a room, learned from anyone in it. A room made on this version has
// a key made from its creator's key and a secret, so a member who never meets
// the creator can still check the creator key, and with it the removal lists.
// The desktop has the same in peerchat's test/room-creator-proof.test.js.

const wireRoom = (roomKey) => derivePeerChatTopic(roomKey).toString('hex')

const CREATOR = crypto.keyPair(Buffer.alloc(32, 41))
const CREATOR_KEY = CREATOR.publicKey.toString('hex')
const STRANGER = crypto.keyPair(Buffer.alloc(32, 42))
const STRANGER_KEY = STRANGER.publicKey.toString('hex')
const PHONE = crypto.keyPair(Buffer.alloc(32, 43))
const PHONE_KEY = PHONE.publicKey.toString('hex')
const FIRST = makeCreatorRoomKey(CREATOR_KEY)
const SECOND = makeCreatorRoomKey(CREATOR_KEY)

async function setUp (t) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-creator-proof-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => service.close())
  await service.loadSigningKeys()
  service.setProfile({ username: 'Ada', bio: '' })
  for (const { roomKey } of [FIRST, SECOND]) {
    await service.joinRoom({ roomKey })
    service.rooms.get(roomKey).joinedAt = Date.now() - 60_000
  }
  const rooms = [FIRST.roomKey, SECOND.roomKey]
  return { service, relay: connect(service, 'aa00aa00', rooms), watcher: connect(service, 'cc00cc00', rooms) }
}

function connect (service, id, rooms) {
  const frames = []
  const peer = createFakePeer(id, frames, rooms)
  service.peers.set(peer.connection, peer)
  peer.metas = (roomKey) => frames.filter((frame) => frame.type === 'room-meta' && frame.room === wireRoom(roomKey))
  peer.lists = (roomKey) => frames.filter((frame) => frame.type === 'room-bans' && frame.room === wireRoom(roomKey))
  return peer
}

test('a signed removal list waits until the phone knows who made the room, then is taken and passed on', async (t) => {
  const { service, relay, watcher } = await setUp(t)
  const roomKey = FIRST.roomKey
  const bans = [{ id: 'c0ffee11', key: '', at: Date.now(), name: 'Carol' }]
  const signed = { v: 2000, sig: signRemovals({ topic: wireRoom(roomKey), version: 2000, bans, keyPair: CREATOR }) }
  await service.handlePeerMessage(relay, { type: 'room-bans', roomKey, bans, signed })
  // Nothing to check it against yet, so nothing taken.
  assert.deepEqual(service.rooms.get(roomKey).bans || [], [])

  // The creator key and the secret that made the room's key, from somebody
  // who is not the creator.
  await service.handlePeerMessage(relay, { type: 'room-meta', roomKey, name: 'Trip', creatorKey: CREATOR_KEY, creatorProof: FIRST.creatorProof })
  const room = service.rooms.get(roomKey)
  assert.deepEqual(room.bans.map((ban) => ban.id), ['c0ffee11'])
  assert.equal(room.createdBy, CREATOR_KEY.slice(0, 8))

  // The list, and the creator key with its secret, go on to the rest.
  assert.ok(watcher.lists(roomKey).find((frame) => frame.signed?.v === 2000), 'the list went on')
  const meta = watcher.metas(roomKey).find((frame) => frame.creatorProof)
  assert.ok(meta, 'the secret went on')
  assert.equal(meta.creatorKey, CREATOR_KEY)
  assert.ok(checkCreatorProof(roomKey, meta.creatorKey, meta.creatorProof))
})

test('no creator key is taken without the secret, or with one that does not make the room\'s key', async (t) => {
  const { service, relay } = await setUp(t)
  const roomKey = SECOND.roomKey
  await service.handlePeerMessage(relay, { type: 'room-meta', roomKey, name: 'Trip', creatorKey: STRANGER_KEY })
  await service.handlePeerMessage(relay, { type: 'room-meta', roomKey, name: 'Trip', creatorKey: STRANGER_KEY, creatorProof: FIRST.creatorProof })
  await service.handlePeerMessage(relay, { type: 'room-meta', roomKey, name: 'Trip', creatorKey: CREATOR_KEY, creatorProof: FIRST.creatorProof })
  assert.ok(!service.rooms.get(roomKey).creatorKey)

  // A list signed by somebody who only claimed the room is held, never taken.
  const bans = [{ id: 'c0ffee22', key: '', at: Date.now(), name: 'Dan' }]
  const signed = { v: 3000, sig: signRemovals({ topic: wireRoom(roomKey), version: 3000, bans, keyPair: STRANGER }) }
  await service.handlePeerMessage(relay, { type: 'room-bans', roomKey, bans, signed })
  await service.handlePeerMessage(relay, { type: 'room-meta', roomKey, name: 'Trip', creatorKey: CREATOR_KEY, creatorProof: SECOND.creatorProof })
  assert.equal(service.rooms.get(roomKey).creatorKey, CREATOR_KEY)
  assert.deepEqual(service.rooms.get(roomKey).bans || [], [])
})

test('a room made here has a key that says who made it, and anyone in it is told', async (t) => {
  const { service } = await setUp(t)
  const { roomKey } = await service.createRoom({ name: 'Made here' })
  assert.ok(checkCreatorProof(roomKey, PHONE_KEY, service.rooms.get(roomKey).creatorProof))
  const peer = connect(service, 'dd00dd00', [roomKey])
  service.sendRoomMeta(peer, roomKey)
  const meta = peer.metas(roomKey)[0]
  assert.equal(meta.creatorKey, PHONE_KEY)
  assert.ok(checkCreatorProof(roomKey, PHONE_KEY, meta.creatorProof))
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

function createFakePeer (id, frames, rooms) {
  return {
    active: true,
    connection: { destroyed: false, handshakeHash: Buffer.alloc(64, 9), publicKey: PHONE.publicKey },
    id,
    key: id.repeat(8),
    buffer: '',
    pendingMessages: 0,
    processing: Promise.resolve(),
    lastReceivedAt: Date.now(),
    username: id,
    bio: '',
    avatar: null,
    rooms: [...rooms],
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
