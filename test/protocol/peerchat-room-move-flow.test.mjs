import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import crypto from 'hypercore-crypto'

import { PeerChatService } from '../../backend/peerchat/service.mjs'
import { derivePeerChatTopic } from '../../backend/peerchat/protocol.mjs'
import { newKeyChain } from '../../backend/peerchat/key-chain.mjs'
import { roomProof } from '../../backend/peerchat/room-proof.mjs'
import { checkMove, makeCreatorRoomKey, signMove } from '../../backend/peerchat/room-move.mjs'
import { makeProfileProof } from '../../backend/peerchat/device-link.mjs'

// A room that moves to a new key when its creator removes somebody: everyone
// still in it follows, the person removed does not, and neither does anyone
// who turns up with the old key afterwards. The desktop has the same in
// peerchat's test/room-move-flow.test.js.

const wireRoom = (roomKey) => derivePeerChatTopic(roomKey).toString('hex')
const HANDSHAKE = Buffer.alloc(64, 9)
const pair = (n) => crypto.keyPair(Buffer.alloc(32, n))
const keyOf = (keyPair) => keyPair.publicKey.toString('hex')
const PHONE = pair(51)
const CREATOR = pair(52)
const STRANGER = pair(53)
const ALICE = pair(61)
const BOB = pair(62)
const REMOVED = pair(63)
const SAM = pair(64)
const OLDER = pair(65)
const NEWCOMER = pair(66)
const UNKNOWN = pair(67)
const LAPTOP = pair(68)

async function startService (t) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-room-move-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => service.close())
  await service.loadSigningKeys()
  service.setProfile({ username: 'Ada', bio: '' })
  return service
}

// Somebody connected, proving the rooms given, as a phone or desktop would.
async function connect (service, keyPair, roomKeys, { moves = true } = {}) {
  const frames = []
  const key = keyOf(keyPair)
  const peer = createFakePeer(key, frames)
  service.peers.set(peer.connection, peer)
  peer.of = (type, roomKey) => frames.filter((frame) => frame.type === type && (!roomKey || frame.room === wireRoom(roomKey)))
  peer.prove = (keys) => service.handlePeerMessage(peer, {
    type: 'topics',
    rooms: keys.map((roomKey) => ({ topic: wireRoom(roomKey), proof: roomProof(roomKey, HANDSHAKE, key) })),
    pass: true,
    ...(moves && { move: true })
  })
  await peer.prove(roomKeys)
  return peer
}

test('removing somebody moves the room to a new key, and only those still in it follow', async (t) => {
  const service = await startService(t)
  const { roomKey } = await service.createRoom({ name: 'Weekend' })
  const alice = await connect(service, ALICE, [roomKey])
  const bob = await connect(service, BOB, [roomKey])
  const removed = await connect(service, REMOVED, [roomKey])
  const older = await connect(service, OLDER, [roomKey], { moves: false })
  const sam = await connect(service, SAM, [roomKey])
  // Sam was here, and is offline when the room moves.
  service.peers.delete(sam.connection)
  await service.sendMessage({ roomKey, message: 'Before the move' })

  const { movedTo } = await service.removeRoomMember({ roomKey, peerId: keyOf(REMOVED).slice(0, 8) })
  assert.match(movedTo, /^[0-9a-f]{64}$/)
  for (const peer of [alice, bob]) {
    const frame = peer.of('room-moved', roomKey)[0]
    assert.ok(frame, 'the move')
    assert.equal(frame.moves[0].to, movedTo)
    assert.ok(checkMove({ fromTopic: wireRoom(roomKey), creatorKey: keyOf(PHONE), move: frame.moves[0], topicOf: wireRoom }))
  }
  // Not the person removed, and not a build that would not know what to do
  // with it.
  assert.equal(removed.of('room-moved').length, 0)
  assert.equal(older.of('room-moved').length, 0)

  // The new room in place of the old, with the old one's history.
  const listed = service.listRooms().map((room) => room.roomKey)
  assert.ok(listed.includes(movedTo))
  assert.ok(!listed.includes(roomKey))
  const snapshot = await service.getSnapshot({ roomKey, version: -1 })
  assert.equal(snapshot.room.roomKey, movedTo)
  assert.equal(snapshot.movedRooms[roomKey], movedTo)
  const before = snapshot.messages.find((message) => message.message === 'Before the move')
  assert.ok(before)
  assert.equal(before.roomKey, roomKey)
  await waitFor(async () => (await service.getSnapshot({ roomKey: movedTo, version: -1 })).messages.some((message) => /new key/.test(message.message || '')))

  // Nothing for somebody who turns up with the old key afterwards.
  const stranger = await connect(service, UNKNOWN, [roomKey])
  assert.ok(!stranger.rooms.includes(roomKey))
  assert.equal(stranger.of('room-moved').length, 0)
  assert.equal(stranger.of('room-meta', roomKey).length, 0)

  // Somebody who was here before, back after the move, hears where it went.
  const back = await connect(service, SAM, [roomKey])
  assert.equal(back.of('room-moved', roomKey)[0]?.moves[0].to, movedTo)

  // Not moved again by anybody but the creator.
  await alice.prove([movedTo])
  const theirs = makeCreatorRoomKey(keyOf(STRANGER))
  const forged = signMove({ fromTopic: wireRoom(movedTo), topicOf: wireRoom, to: theirs.roomKey, proof: theirs.creatorProof, chain: newKeyChain(), at: Date.now(), keyPair: STRANGER })
  await service.handlePeerMessage(alice, { type: 'room-moved', roomKey: movedTo, moves: [forged] })
  assert.ok(service.listRooms().some((room) => room.roomKey === movedTo))

  // Leaving the new room leaves the old one with it.
  await service.leaveRoom({ roomKey: movedTo })
  assert.ok(!service.hasRoom(movedTo))
  assert.ok(!service.rooms.has(roomKey))
})

test('a move from the creator is followed, and passed on only to people seen in the room before it', async (t) => {
  const service = await startService(t)
  const club = makeCreatorRoomKey(keyOf(CREATOR))
  await service.joinRoom({ roomKey: club.roomKey })
  const creator = await connect(service, CREATOR, [club.roomKey])
  const alice = await connect(service, ALICE, [club.roomKey])
  await service.handlePeerMessage(creator, { type: 'room-meta', roomKey: club.roomKey, name: 'Club', creatorKey: keyOf(CREATOR), creatorProof: club.creatorProof })
  assert.equal(service.rooms.get(club.roomKey).creatorKey, keyOf(CREATOR))

  const next = makeCreatorRoomKey(keyOf(CREATOR))
  const hop = signMove({ fromTopic: wireRoom(club.roomKey), topicOf: wireRoom, to: next.roomKey, proof: next.creatorProof, chain: newKeyChain(), at: Date.now(), keyPair: CREATOR })
  await new Promise((resolve) => setTimeout(resolve, 5))
  // In the room for the first time after the move was made: never told.
  const newcomer = await connect(service, NEWCOMER, [club.roomKey])
  await service.handlePeerMessage(creator, { type: 'room-moved', roomKey: club.roomKey, moves: [hop] })

  assert.equal(service.movedRoomsMap()[club.roomKey], hop.to)
  assert.equal(alice.of('room-moved', club.roomKey)[0]?.moves[0].to, hop.to)
  assert.equal(newcomer.of('room-moved').length, 0)
  assert.ok(!newcomer.rooms.includes(club.roomKey))
  assert.equal(creator.of('room-moved').length, 0)
  assert.equal(service.rooms.get(hop.to).creatorKey, keyOf(CREATOR))

  // A move signed by anyone else is not followed.
  const other = makeCreatorRoomKey(keyOf(CREATOR))
  await service.joinRoom({ roomKey: other.roomKey })
  const relay = await connect(service, BOB, [other.roomKey])
  const fake = makeCreatorRoomKey(keyOf(STRANGER))
  const forged = signMove({ fromTopic: wireRoom(other.roomKey), topicOf: wireRoom, to: fake.roomKey, proof: fake.creatorProof, chain: newKeyChain(), at: Date.now(), keyPair: STRANGER })
  await service.handlePeerMessage(relay, { type: 'room-moved', roomKey: other.roomKey, moves: [forged] })
  assert.equal(service.movedRoomsMap()[other.roomKey], undefined)
})

test('a device of the person\'s own that was removed never gets the new key, even once it proves it is theirs', async (t) => {
  const service = await startService(t)
  const { roomKey } = await service.createRoom({ name: 'Family' })
  const { roomKey: kept } = await service.createRoom({ name: 'Kept' })
  const link = service.exportTransfer({ targetType: 'desktop' }).link
  const proveSibling = (peer) => service.handlePeerMessage(peer, {
    type: 'profile', username: 'Ada@desktop1', link: makeProfileProof(link, { username: 'Ada', at: 1 }, peer.key)
  })
  const offered = (peer) => peer.of('link-rooms').flatMap((frame) => frame.rooms.map((room) => room.roomKey))

  const laptop = await connect(service, LAPTOP, [roomKey, kept])
  await proveSibling(laptop)
  assert.ok(offered(laptop).includes(roomKey))
  assert.ok(offered(laptop).includes(kept))
  // Removed, as a laptop that was stolen would be.
  const { movedTo } = await service.removeRoomMember({ roomKey, peerId: keyOf(LAPTOP).slice(0, 8) })
  assert.match(movedTo, /^[0-9a-f]{64}$/)
  service.peers.delete(laptop.connection)

  const back = await connect(service, LAPTOP, [roomKey, kept])
  await proveSibling(back)
  assert.ok(offered(back).includes(kept))
  assert.ok(!offered(back).includes(movedTo))
  assert.ok(!offered(back).includes(roomKey))
  assert.equal(back.of('room-moved').length, 0)
})

async function waitFor (check) {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('timed out')
}

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
