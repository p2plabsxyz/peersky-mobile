import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import crypto from 'hypercore-crypto'

import { PeerChatService } from '../../backend/peerchat/service.mjs'
import { derivePeerChatTopic } from '../../backend/peerchat/protocol.mjs'
import {
  checkSignedRemovals,
  nextRemovalsVersion,
  normalizeSignedRemovals,
  pickSigningKeyPair,
  removalsMessage,
  signRemovals
} from '../../backend/peerchat/removal-signature.mjs'

// A room's creator signs its removal list, so anybody in the room can pass it
// on and a removal reaches people who never meet the creator. A list used to
// count only over the creator's own connection, and in a room bigger than one
// device's connections most members never heard about a removal.

const wireRoom = (roomKey) => derivePeerChatTopic(roomKey).toString('hex')

// The same vector is in peerchat's test/removal-signature.test.js. If either
// app changes a byte of what is signed, both of these fail.
const CREATOR = crypto.keyPair(Buffer.alloc(32, 1))
const CREATOR_KEY = CREATOR.publicKey.toString('hex')
const TOPIC = wireRoom('ab'.repeat(32))
const BANS = [
  { id: 'c0ffee11', key: '', at: 1790000000000, name: 'Carol' },
  { key: 'dd'.repeat(32), at: 1790000000001, name: 'Dave Two' }
]
const VERSION = 1790000000002
const SIGNATURE = 'd0147b5d6ef93cd662267a14b27de16cd26f44bba4e266b5b04ed611e2cce67b' +
  'a0e0a645c74f2c7dde35174339775cddbe4f57437d8db2855737274a858b7803'

test('a removal list is signed over the same bytes as on the desktop', () => {
  assert.equal(CREATOR_KEY, '8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c')
  assert.equal(TOPIC, '2a1988aeeff0404ef0edef440f2f2e7864f15ff8543b9f7693b69db182bbf653')
  assert.equal(
    removalsMessage(TOPIC, VERSION, BANS),
    `peersky-chat/2 removals\n${TOPIC}\n${VERSION}\n` +
      '[["c0ffee11","",1790000000000,"Carol"],["dddddddd","' + 'dd'.repeat(32) + '",1790000000001,"Dave Two"]]'
  )
  assert.equal(signRemovals({ topic: TOPIC, version: VERSION, bans: BANS, keyPair: CREATOR }), SIGNATURE)
})

test('a signed list is believed from anyone, as long as nothing in it changed', () => {
  const signed = { v: VERSION, sig: SIGNATURE }
  assert.equal(checkSignedRemovals({ topic: TOPIC, creatorKey: CREATOR_KEY, bans: BANS, signed }), true)
  assert.equal(checkSignedRemovals({ topic: TOPIC, creatorKey: CREATOR_KEY, bans: BANS.slice(1), signed }), false)
  assert.equal(checkSignedRemovals({
    topic: TOPIC,
    creatorKey: CREATOR_KEY,
    signed,
    bans: [{ ...BANS[0], name: 'Mallory' }, BANS[1]]
  }), false)
  assert.equal(checkSignedRemovals({ topic: TOPIC, creatorKey: CREATOR_KEY, bans: BANS, signed: { ...signed, v: VERSION + 1 } }), false)
  assert.equal(checkSignedRemovals({ topic: wireRoom('cd'.repeat(32)), creatorKey: CREATOR_KEY, bans: BANS, signed }), false)
  const other = crypto.keyPair(Buffer.alloc(32, 2)).publicKey.toString('hex')
  assert.equal(checkSignedRemovals({ topic: TOPIC, creatorKey: other, bans: BANS, signed }), false)
  assert.deepEqual(normalizeSignedRemovals({ v: -1, sig: 'nope' }), { v: 0, sig: '' })
  assert.equal(nextRemovalsVersion(9000, 5000), 9001)
  assert.equal(pickSigningKeyPair(CREATOR_KEY, [crypto.keyPair(), CREATOR]), CREATOR)
})

// A room this phone joined, made by somebody it is not connected to.
const THEIRS = 'b1'.repeat(32)
const ROOM_CREATOR = crypto.keyPair(Buffer.alloc(32, 4))
const PHONE = crypto.keyPair(Buffer.alloc(32, 5))

async function startService (t, storagePath) {
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => service.close())
  await service.loadSigningKeys()
  return service
}

async function setUp (t) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-signed-removals-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await startService(t, storagePath)
  service.setProfile({ username: 'Ada', bio: '' })
  await service.joinRoom({ roomKey: THEIRS })
  const room = service.rooms.get(THEIRS)
  room.creatorKey = ROOM_CREATOR.publicKey.toString('hex')
  room.createdByName = 'Cora'
  room.joinedAt = Date.now() - 60_000
  const relay = connect(service, 'aa00aa00')
  const watcher = connect(service, 'cc00cc00')
  return { service, storagePath, relay, watcher }
}

function connect (service, id) {
  const frames = []
  const peer = createFakePeer(id, frames)
  service.peers.set(peer.connection, peer)
  peer.lists = (roomKey) => frames.filter((frame) => frame.type === 'room-bans' && frame.room === wireRoom(roomKey))
  return peer
}

const signedFor = (bans, v, keyPair = ROOM_CREATOR) =>
  ({ v, sig: signRemovals({ topic: wireRoom(THEIRS), version: v, bans, keyPair }) })

function systemLines (snapshot) {
  return (snapshot.messages || []).filter((message) => message.system).map((message) => message.message)
}

test('the creator\'s list counts from somebody who is not the creator, and goes on to everyone else', async (t) => {
  const { service, relay, watcher } = await setUp(t)
  const list = [{ id: 'c0ffee11', key: '', at: Date.now(), name: 'Carol' }]
  await service.handlePeerMessage(relay, { type: 'room-bans', roomKey: THEIRS, bans: list, signed: signedFor(list, 1000) })

  assert.deepEqual(service.rooms.get(THEIRS).bans.map((ban) => ban.id), ['c0ffee11'])
  const snapshot = await service.getSnapshot({ roomKey: THEIRS, version: -1 })
  assert.deepEqual(systemLines(snapshot), ['Carol was removed from the room by Cora'])
  // On to the rest of the room, signature and all, and not back to the relay.
  const passed = watcher.lists(THEIRS).find((frame) => frame.signed?.v === 1000)
  assert.ok(passed, 'the list went on')
  assert.equal(checkSignedRemovals({
    topic: wireRoom(THEIRS),
    creatorKey: ROOM_CREATOR.publicKey.toString('hex'),
    bans: passed.bans,
    signed: passed.signed
  }), true)
  assert.equal(relay.lists(THEIRS).length, 0)
})

test('a list somebody changed, an older one, a forged one and an unsigned one change nothing', async (t) => {
  const { service, relay } = await setUp(t)
  const list = [{ id: 'c0ffee11', key: '', at: Date.now(), name: 'Carol' }]
  await service.handlePeerMessage(relay, { type: 'room-bans', roomKey: THEIRS, bans: list, signed: signedFor(list, 2000) })

  await service.handlePeerMessage(relay, { type: 'room-bans', roomKey: THEIRS, bans: [], signed: signedFor(list, 2000) })
  await service.handlePeerMessage(relay, { type: 'room-bans', roomKey: THEIRS, bans: [], signed: signedFor([], 1999) })
  await service.handlePeerMessage(relay, { type: 'room-bans', roomKey: THEIRS, bans: [], signed: signedFor([], 3000, crypto.keyPair()) })
  await service.handlePeerMessage(relay, { type: 'room-bans', roomKey: THEIRS, bans: [] })
  assert.deepEqual(service.rooms.get(THEIRS).bans.map((ban) => ban.id), ['c0ffee11'])

  // A newer one does, and lets Carol back in.
  await service.handlePeerMessage(relay, { type: 'room-bans', roomKey: THEIRS, bans: [], signed: signedFor([], 3000) })
  assert.deepEqual(service.rooms.get(THEIRS).bans, [])
})

test('a room made here gets a signed list, again each time it changes, and keeps it through a restart', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-signed-removals-mine-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await startService(t, storagePath)
  service.setProfile({ username: 'Ada', bio: '' })
  const room = await service.createRoom({ name: 'Mine', username: 'Ada' })
  const watcher = connect(service, 'cc00cc00')
  watcher.rooms = [room.roomKey]

  await service.removeRoomMember({ roomKey: room.roomKey, peerId: 'deadbeef' })
  const sent = watcher.lists(room.roomKey).find((frame) => frame.bans.some((ban) => ban.id === 'deadbeef'))
  assert.ok(sent, 'the new list went out')
  assert.equal(checkSignedRemovals({ topic: wireRoom(room.roomKey), creatorKey: PHONE.publicKey.toString('hex'), bans: sent.bans, signed: sent.signed }), true)

  await service.restoreRoomMember({ roomKey: room.roomKey, peerId: 'deadbeef' })
  const after = watcher.lists(room.roomKey).find((frame) => frame.signed?.v > sent.signed.v)
  assert.deepEqual(after.bans, [])
  assert.equal(checkSignedRemovals({ topic: wireRoom(room.roomKey), creatorKey: PHONE.publicKey.toString('hex'), bans: after.bans, signed: after.signed }), true)

  service.persistNow()
  await service.close()
  const restarted = await startService(t, storagePath)
  assert.deepEqual(restarted.rooms.get(room.roomKey).bansSigned, after.signed)
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

function createFakePeer (id, frames) {
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
    rooms: [THEIRS],
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
