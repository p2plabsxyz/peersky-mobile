import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import crypto from 'hypercore-crypto'

import { roomLogName } from '../../backend/peerchat/room-log.mjs'
import { PeerChatService } from '../../backend/peerchat/service.mjs'
import { derivePeerChatTopic, encryptPeerChatMessage } from '../../backend/peerchat/protocol.mjs'
import { newKeyChain } from '../../backend/peerchat/key-chain.mjs'
import { roomProof } from '../../backend/peerchat/room-proof.mjs'
import { makeCreatorRoomKey, signMove } from '../../backend/peerchat/room-move.mjs'

// What following a room's moves costs a phone, whoever made them. A chain of
// moves used to join every room on the way, one swarm topic each, thirty-two
// to a frame, and every room that ever moved stayed joined for good. Now only
// the room at the end is joined, a line of rooms follows at most ten moves an
// hour, and a room that moved is joined for 14 days after its move.

const wireRoom = (roomKey) => derivePeerChatTopic(roomKey).toString('hex')
const HANDSHAKE = Buffer.alloc(64, 9)
const pair = (n) => crypto.keyPair(Buffer.alloc(32, n))
const keyOf = (keyPair) => keyPair.publicKey.toString('hex')
const PHONE = pair(121)
const GUS = pair(122)
const ALICE = pair(123)
const DAY = 24 * 60 * 60_000

async function startService (t, { state } = {}) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-move-limits-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const sdk = createFakeSdk()
  if (state) await writeFile(path.join(storagePath, 'peerchat-mobile.json'), JSON.stringify(await state(sdk)))
  const service = await new PeerChatService({ sdk, storagePath }).start()
  t.after(() => service.close())
  await service.loadSigningKeys()
  service.setProfile({ username: 'Ada', bio: '' })
  return { service, sdk }
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

// Gus moving a room on, count times in a row.
function line (from, count, at) {
  const moves = []
  const keys = []
  let key = from
  for (let i = 0; i < count; i += 1) {
    const next = makeCreatorRoomKey(keyOf(GUS))
    moves.push(signMove({ fromTopic: wireRoom(key), topicOf: wireRoom, to: next.roomKey, proof: next.creatorProof, chain: newKeyChain(), at: at + i, keyPair: GUS }))
    keys.push(next.roomKey)
    key = next.roomKey
  }
  return { moves, keys }
}

const notices = async (service, roomKey) => (await service.getSnapshot({ roomKey, version: -1 })).messages
  .filter((message) => message.system && /new key/.test(message.message))

test('a line of moves joins only the room at its end, ten moves an hour at most', async (t) => {
  const { service, sdk } = await startService(t)
  const club = makeCreatorRoomKey(keyOf(GUS))
  await service.joinRoom({ roomKey: club.roomKey })
  const gus = await connect(service, GUS, [club.roomKey])
  await service.handlePeerMessage(gus, { type: 'room-meta', roomKey: club.roomKey, name: 'Club', creatorKey: keyOf(GUS), creatorProof: club.creatorProof })
  const alice = await connect(service, ALICE, [club.roomKey])
  // Alice proved the room here before any of the moves were made.
  await new Promise((resolve) => setTimeout(resolve, 5))
  const { moves, keys } = line(club.roomKey, 12, Date.now())
  const joinedBefore = sdk.joined.length

  await service.handlePeerMessage(gus, { type: 'room-moved', roomKey: club.roomKey, moves })
  // Ten taken: the room at the tenth is joined, and nothing on the way.
  assert.equal(service.finalRoomKey(club.roomKey), keys[9])
  await waitFor(() => service.joinedRooms.has(keys[9]))
  assert.deepEqual(sdk.joined.slice(joinedBefore), [wireRoom(keys[9])])
  for (const key of keys.slice(0, 9)) {
    const room = service.rooms.get(key)
    assert.ok(room?.movedTo, 'a record on the way, so the line holds')
    assert.equal(room.passedThrough, true)
    assert.ok(!service.feeds.has(key))
    assert.ok(!service.joinedRooms.has(key))
  }
  assert.ok(!service.rooms.has(keys[10]))
  // Old keys still find the room, and one line in it says it moved.
  assert.equal(service.roomKeyFor(keys[3]), keys[9])
  await waitFor(async () => (await notices(service, keys[9])).length > 0)
  assert.equal((await notices(service, keys[9])).length, 1)
  // Alice hears every move taken, from the room she is in.
  assert.equal(alice.of('room-moved', club.roomKey).at(-1)?.moves.length, 10)
  // None of it counts toward the fifty rooms.
  assert.equal(service.activeRoomCount(), 1)

  // The line again within the hour: still ten.
  await service.handlePeerMessage(gus, { type: 'room-moved', roomKey: club.roomKey, moves })
  assert.equal(service.finalRoomKey(club.roomKey), keys[9])

  // An hour on, it comes again and the rest are taken.
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 61 * 60_000)
  await service.handlePeerMessage(gus, { type: 'room-moved', roomKey: club.roomKey, moves })
  assert.equal(service.finalRoomKey(club.roomKey), keys[11])
  await waitFor(() => service.joinedRooms.has(keys[11]))
  assert.deepEqual(sdk.joined.slice(joinedBefore), [wireRoom(keys[9]), wireRoom(keys[11])])
  assert.equal(service.rooms.get(keys[10]).passedThrough, true)
  // The room that was joined before it moved on is not one passed through.
  assert.equal(service.rooms.get(keys[9]).passedThrough, undefined)
})

test('the maker\'s own phone is not held to ten moves an hour', async (t) => {
  const { service } = await startService(t)
  const { roomKey } = await service.createRoom({ name: 'Busy' })
  for (let i = 0; i < 11; i += 1) {
    const { movedTo } = await service.removeRoomMember({ roomKey, peerId: (0x10000000 + i).toString(16) })
    assert.match(movedTo, /^[0-9a-f]{64}$/)
  }
  assert.equal(service.roomsBefore(service.finalRoomKey(roomKey)).length, 11)
})

test('a room that moved is joined for 14 days after its move, and its history stays', async (t) => {
  const old = makeCreatorRoomKey(keyOf(GUS))
  const oldNext = makeCreatorRoomKey(keyOf(GUS))
  const recent = makeCreatorRoomKey(keyOf(GUS))
  const passed = makeCreatorRoomKey(keyOf(GUS))
  const recentNext = makeCreatorRoomKey(keyOf(GUS))
  const hop = (from, to, at) => signMove({ fromTopic: wireRoom(from.roomKey), topicOf: wireRoom, to: to.roomKey, proof: to.creatorProof, chain: newKeyChain(), at, keyPair: GUS })
  const record = (made, extra) => ({
    roomKey: made.roomKey,
    name: 'Club',
    isHost: false,
    createdAt: Date.now() - 30 * DAY,
    joinedAt: Date.now() - 30 * DAY,
    creatorKey: keyOf(GUS),
    creatorProof: made.creatorProof,
    members: [],
    ...extra
  })
  const { service, sdk } = await startService(t, {
    state: (fakeSdk) => {
      // Said in the old room before it moved.
      fakeSdk.feed(old.roomKey).entries.push({
        id: 'said-before',
        sender: keyOf(ALICE).slice(0, 8),
        sn: 'Alice',
        ...encryptPeerChatMessage('Said before the move', old.roomKey),
        ts: Date.now() - 16 * DAY
      })
      return {
        version: 1,
        profile: { username: 'Ada' },
        rooms: [
          record(old, { movedTo: hop(old, oldNext, Date.now() - 15 * DAY) }),
          record(oldNext, { movedFrom: old.roomKey }),
          record(recent, { movedTo: hop(recent, passed, Date.now() - DAY) }),
          record(passed, { movedFrom: recent.roomKey, movedTo: hop(passed, recentNext, Date.now() - DAY), passedThrough: true }),
          record(recentNext, { movedFrom: passed.roomKey })
        ]
      }
    }
  })

  // At start: the room that moved 15 days ago is not joined, the one that
  // moved yesterday is, and the one a line only passed through never was.
  assert.ok(!sdk.joined.includes(wireRoom(old.roomKey)))
  assert.ok(sdk.joined.includes(wireRoom(recent.roomKey)))
  assert.ok(!sdk.joined.includes(wireRoom(passed.roomKey)))
  assert.ok(!service.feeds.has(passed.roomKey))
  assert.ok(sdk.joined.includes(wireRoom(oldNext.roomKey)))
  assert.ok(sdk.joined.includes(wireRoom(recentNext.roomKey)))
  // The old room's record and history stay, for the room it went to.
  assert.equal(service.roomKeyFor(old.roomKey), oldNext.roomKey)
  const snapshot = await service.getSnapshot({ roomKey: oldNext.roomKey, version: -1 })
  assert.ok(snapshot.messages.some((message) => message.message === 'Said before the move'))
  assert.equal(service.activeRoomCount(), 2)

  // Running, it stays joined until 14 days after its move, then is left.
  service.leaveOldMovedRooms(Date.now() + 12 * DAY)
  assert.ok(service.joinedRooms.has(recent.roomKey))
  service.leaveOldMovedRooms(Date.now() + 14 * DAY)
  assert.ok(!service.joinedRooms.has(recent.roomKey))
  await waitFor(() => sdk.left.includes(wireRoom(recent.roomKey)))
  assert.ok(service.rooms.has(recent.roomKey))
  assert.ok(service.feeds.has(recent.roomKey))
  assert.ok(service.joinedRooms.has(recentNext.roomKey))
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
  const joined = []
  const left = []
  const feed = (roomKey) => {
    const name = roomLogName(roomKey)
    if (!feeds.has(name)) feeds.set(name, new FakeFeed())
    return feeds.get(name)
  }
  return {
    publicKey: PHONE.publicKey,
    swarm,
    localSwarm: new EventEmitter(),
    joined,
    left,
    feed,
    corestore: {
      get ({ name }) {
        if (!feeds.has(name)) feeds.set(name, new FakeFeed())
        return feeds.get(name)
      },
      async createKeyPair (name) {
        return name === 'noise' ? PHONE : crypto.keyPair()
      }
    },
    join (topic) {
      joined.push(Buffer.from(topic).toString('hex'))
    },
    async leave (topic) {
      left.push(Buffer.from(topic).toString('hex'))
    }
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
