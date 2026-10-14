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
import { signRemovals } from '../../backend/peerchat/removal-signature.mjs'
import { signRoomDetails } from '../../backend/peerchat/room-details.mjs'
import { roomProof } from '../../backend/peerchat/room-proof.mjs'
import { PRE_JOINED_PEERCHAT_ROOM_KEY } from '../../backend/peerchat/rooms.mjs'
import { checkCreatorProof, makeCreatorRoomKey, signMove } from '../../backend/peerchat/room-move.mjs'
import { buildPeerChatInviteUrl } from '../../app/peerchat/peerchat-invite.mjs'

// Who made a room, when a member claims it before the secret behind the room's
// key reaches this phone. A phone that joined from a bare key took the first
// member to say "I made it" on their own connection, and kept them for good:
// the real secret was refused, and everything that member signed counted, their
// details and filters, their removals, their moves. Now the secret always wins
// over a claim, and what the claim brought goes with it. An invite carries the
// creator and the secret, so a phone joining from one knows from the start.

const wireRoom = (roomKey) => derivePeerChatTopic(roomKey).toString('hex')
const HANDSHAKE = Buffer.alloc(64, 9)
const pair = (n) => crypto.keyPair(Buffer.alloc(32, n))
const keyOf = (keyPair) => keyPair.publicKey.toString('hex')
const PHONE = pair(111)
const GUS = pair(112)
const BEN = pair(113)
const CORA = pair(114)
const DEV = pair(115)
const ELI = pair(116)
const FAY = pair(117)

async function startService (t) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-creator-wins-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const sdk = createFakeSdk()
  const service = await new PeerChatService({ sdk, storagePath }).start()
  t.after(() => service.close())
  await service.loadSigningKeys()
  service.setProfile({ username: 'Ada', bio: '' })
  return { service, sdk }
}

// Somebody connected, proving the rooms given.
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

const claim = (service, peer, roomKey, extra = {}) => service.handlePeerMessage(peer, {
  type: 'room-meta', roomKey, name: 'Club', createdBy: peer.key.slice(0, 8), creatorKey: peer.key, ...extra
})
const details = (roomKey, keyPair, v, name, moderation) => signRoomDetails({
  topic: wireRoom(roomKey), v, name, bio: '', link: '', avatar: '', moderation, keyPair
})
const signedList = (roomKey, keyPair, v, bans) => ({ v, sig: signRemovals({ topic: wireRoom(roomKey), version: v, bans, keyPair }) })
const banOf = (keyPair, name) => ({ id: keyOf(keyPair).slice(0, 8), key: keyOf(keyPair), at: Date.now(), name })
const OPEN = { abuseFilter: false, nsfwFilter: false, spamRateLimit: 50 }
const KEPT = { abuseFilter: true, nsfwFilter: true, spamRateLimit: 10 }

test('a member who claims a room first gives way to the secret behind its key, and what they signed goes with them', async (t) => {
  const { service } = await startService(t)
  const club = makeCreatorRoomKey(keyOf(GUS))
  await service.joinRoom({ roomKey: club.roomKey })
  const room = () => service.rooms.get(club.roomKey)
  const shown = () => service.listRooms().find((entry) => entry.roomKey === club.roomKey)
  const ben = await connect(service, BEN, [club.roomKey])
  const cora = await connect(service, CORA, [club.roomKey])
  const dev = await connect(service, DEV, [club.roomKey])

  // Ben gets there first and says he made it, on his own connection. Rooms
  // made before the secret existed can only be learned that way, so it holds
  // until something better comes.
  await claim(service, ben, club.roomKey, { createdByName: 'Ben' })
  assert.equal(room().creatorKey, keyOf(BEN))
  assert.equal(room().createdByName, 'Ben')
  // His details, signed far ahead with every filter off, and a list that puts
  // Cora out.
  const far = Date.now() + 1e9
  await service.handlePeerMessage(ben, { type: 'room-meta', roomKey: club.roomKey, name: 'Owned', details: details(club.roomKey, BEN, far, 'Owned', OPEN) })
  await service.handlePeerMessage(ben, { type: 'room-bans', roomKey: club.roomKey, bans: [banOf(CORA, 'Cora')], signed: signedList(club.roomKey, BEN, far, [banOf(CORA, 'Cora')]) })
  assert.equal(shown().name, 'Owned')
  assert.deepEqual(shown().moderation, OPEN)
  assert.ok(service.isPeerRemovedFromRoom(club.roomKey, cora))

  // Cora, put out by him, brings the secret, with Gus's details, signed long
  // before Ben's version.
  await service.handlePeerMessage(cora, {
    type: 'room-meta',
    roomKey: club.roomKey,
    name: 'Real club',
    creatorKey: keyOf(GUS),
    creatorProof: club.creatorProof,
    createdByName: 'Cora',
    details: details(club.roomKey, GUS, Date.now(), 'Real club', KEPT)
  })
  assert.equal(room().creatorKey, keyOf(GUS))
  assert.equal(room().createdBy, keyOf(GUS).slice(0, 8))
  // Ben's name for the maker is gone, and Cora is not the maker.
  assert.equal(room().createdByName, '')
  assert.equal(shown().name, 'Real club')
  assert.deepEqual(shown().moderation, KEPT)
  assert.deepEqual(room().bans, [])
  assert.deepEqual(room().bansSigned, { v: 0, sig: '' })
  assert.equal(service.isPeerRemovedFromRoom(club.roomKey, cora), false)
  // And it goes on through the room.
  const meta = dev.of('room-meta', club.roomKey).findLast((frame) => frame.creatorProof)
  assert.equal(meta?.creatorKey, keyOf(GUS))
  assert.ok(checkCreatorProof(club.roomKey, meta.creatorKey, meta.creatorProof))

  // Nothing of Ben's counts now: not a list, not a claim, not details.
  const later = Date.now() + 2e9
  await service.handlePeerMessage(ben, { type: 'room-bans', roomKey: club.roomKey, bans: [banOf(PHONE, 'Ada')], signed: signedList(club.roomKey, BEN, later, [banOf(PHONE, 'Ada')]) })
  assert.equal(service.isRemovedFromRoom(club.roomKey), false)
  await claim(service, ben, club.roomKey, { createdByName: 'Ben', details: details(club.roomKey, BEN, later, 'Owned', OPEN) })
  assert.equal(room().creatorKey, keyOf(GUS))
  assert.equal(room().createdByName, '')
  assert.equal(shown().name, 'Real club')
  assert.deepEqual(shown().moderation, KEPT)
})

test('what does not check out under a claimed creator waits, and counts once the secret names the real one', async (t) => {
  const { service } = await startService(t)
  const club = makeCreatorRoomKey(keyOf(GUS))
  await service.joinRoom({ roomKey: club.roomKey })
  service.rooms.get(club.roomKey).joinedAt = Date.now() - 60_000
  const ben = await connect(service, BEN, [club.roomKey])
  const cora = await connect(service, CORA, [club.roomKey])
  const dev = await connect(service, DEV, [club.roomKey])
  await claim(service, ben, club.roomKey)

  // Gus's list and details, passed on by Cora, do not check out under Ben's
  // key. They wait rather than being dropped.
  const removal = [banOf(ELI, 'Eli')]
  await service.handlePeerMessage(cora, { type: 'room-bans', roomKey: club.roomKey, bans: removal, signed: signedList(club.roomKey, GUS, 5000, removal) })
  await service.handlePeerMessage(cora, { type: 'room-meta', roomKey: club.roomKey, name: 'Real club', details: details(club.roomKey, GUS, Date.now(), 'Real club', KEPT) })
  const room = service.rooms.get(club.roomKey)
  assert.deepEqual(room.bans || [], [])
  assert.ok(room.pendingBans)
  assert.ok(room.pendingDetails)

  // The secret, from somebody else, with nothing beside it.
  await service.handlePeerMessage(dev, { type: 'room-meta', roomKey: club.roomKey, name: 'Club', creatorKey: keyOf(GUS), creatorProof: club.creatorProof })
  assert.equal(room.creatorKey, keyOf(GUS))
  assert.deepEqual(room.bans.map((ban) => ban.id), [keyOf(ELI).slice(0, 8)])
  assert.equal(room.bansSigned.v, 5000)
  assert.equal(room.name, 'Real club')
  assert.deepEqual(room.moderation, KEPT)
  assert.equal(room.pendingBans, undefined)
  assert.equal(room.pendingDetails, undefined)
})

test('who made the room, by name, comes only from the maker\'s own connection', async (t) => {
  const { service } = await startService(t)
  const club = makeCreatorRoomKey(keyOf(GUS))
  await service.joinRoom({ roomKey: club.roomKey })
  const cora = await connect(service, CORA, [club.roomKey])
  await service.handlePeerMessage(cora, {
    type: 'room-meta', roomKey: club.roomKey, name: 'Club', creatorKey: keyOf(GUS), creatorProof: club.creatorProof, createdByName: 'Cora'
  })
  assert.equal(service.rooms.get(club.roomKey).creatorKey, keyOf(GUS))
  assert.ok(!service.rooms.get(club.roomKey).createdByName)

  const gus = await connect(service, GUS, [club.roomKey])
  await service.handlePeerMessage(gus, { type: 'room-meta', roomKey: club.roomKey, name: 'Club', createdByName: 'Gus' })
  assert.equal(service.rooms.get(club.roomKey).createdByName, 'Gus')
  await service.handlePeerMessage(cora, { type: 'room-meta', roomKey: club.roomKey, name: 'Club', createdByName: 'Cora' })
  assert.equal(service.rooms.get(club.roomKey).createdByName, 'Gus')
})

test('a move made by somebody wrongly taken for the maker is undone once the secret comes, and the room is back', async (t) => {
  const { service, sdk } = await startService(t)
  const club = makeCreatorRoomKey(keyOf(GUS))
  await service.joinRoom({ roomKey: club.roomKey })
  service.setActiveRoom({ roomKey: club.roomKey })
  const ben = await connect(service, BEN, [club.roomKey])
  const dev = await connect(service, DEV, [club.roomKey])
  await claim(service, ben, club.roomKey)
  await new Promise((resolve) => setTimeout(resolve, 5))

  // Ben moves the room to one of his own, twice, and the phone follows.
  const first = makeCreatorRoomKey(keyOf(BEN))
  const second = makeCreatorRoomKey(keyOf(BEN))
  const moves = [
    signMove({ fromTopic: wireRoom(club.roomKey), topicOf: wireRoom, to: first.roomKey, proof: first.creatorProof, chain: newKeyChain(), at: Date.now(), keyPair: BEN }),
    signMove({ fromTopic: wireRoom(first.roomKey), topicOf: wireRoom, to: second.roomKey, proof: second.creatorProof, chain: newKeyChain(), at: Date.now(), keyPair: BEN })
  ]
  await service.handlePeerMessage(ben, { type: 'room-moved', roomKey: club.roomKey, moves })
  assert.equal(service.movedRoomsMap()[club.roomKey], second.roomKey)
  assert.equal(service.activeRoomKey, second.roomKey)
  await waitFor(() => service.joinedRooms.has(second.roomKey))

  // Dev, there before the move, passes on Gus's removal of Eli. It does not
  // check out under Ben's key, so it waits.
  const removal = [banOf(ELI, 'Eli')]
  await service.handlePeerMessage(dev, { type: 'room-bans', roomKey: club.roomKey, bans: removal, signed: signedList(club.roomKey, GUS, 7000, removal) })
  assert.ok(service.rooms.get(club.roomKey).pendingBans)
  // Eli and Cora never proved the room here before Ben moved it, so the old
  // key is shut to them. The secret Cora brings still counts.
  const eli = await connect(service, ELI, [club.roomKey])
  const cora = await connect(service, CORA, [club.roomKey])
  assert.ok(!cora.rooms.includes(club.roomKey))
  await service.handlePeerMessage(cora, { type: 'room-meta', roomKey: club.roomKey, name: 'Club', creatorKey: keyOf(GUS), creatorProof: club.creatorProof })

  assert.equal(service.rooms.get(club.roomKey).creatorKey, keyOf(GUS))
  assert.equal(service.rooms.get(club.roomKey).movedTo, undefined)
  assert.ok(!service.rooms.has(first.roomKey))
  assert.ok(!service.rooms.has(second.roomKey))
  assert.ok(service.listRooms().some((entry) => entry.roomKey === club.roomKey))
  // The room being looked at is the original again, and a screen still on
  // Ben's room is shown it.
  assert.equal(service.activeRoomKey, club.roomKey)
  assert.equal(service.movedRoomsMap()[second.roomKey], club.roomKey)
  assert.equal((await service.getSnapshot({ roomKey: second.roomKey, version: -1 })).room.roomKey, club.roomKey)
  // Ben's room is left, and nobody is told.
  await waitFor(() => sdk.left.includes(wireRoom(second.roomKey)))
  assert.equal(ben.of('leave').length, 0)
  // Cora is let in now the room is where it was. Eli is told he is out, by
  // the list that waited, and handed nothing else of the room.
  assert.ok(cora.rooms.includes(club.roomKey))
  assert.ok(cora.of('room-meta', club.roomKey).length > 0)
  assert.ok(cora.of('join', club.roomKey).length > 0)
  assert.deepEqual(service.rooms.get(club.roomKey).bans.map((ban) => ban.id), [keyOf(ELI).slice(0, 8)])
  assert.ok(eli.of('room-bans', club.roomKey).some((frame) => frame.signed?.v === 7000))
  assert.equal(eli.of('join', club.roomKey).length, 0)
  assert.equal(eli.of('members-list', club.roomKey).length, 0)
  // And Ben's moves count for nothing.
  await service.handlePeerMessage(ben, { type: 'room-moved', roomKey: club.roomKey, moves })
  assert.equal(service.rooms.get(club.roomKey).movedTo, undefined)
})

test('joining from an invite starts with who made the room, and a secret that does not check out counts for nothing', async (t) => {
  const { service } = await startService(t)

  // With the secret: the maker from the start, and no claim gets past it.
  const club = makeCreatorRoomKey(keyOf(GUS))
  const joined = await service.joinRoom({ roomKey: club.roomKey, creatorKey: keyOf(GUS), creatorProof: club.creatorProof })
  assert.equal(service.rooms.get(club.roomKey).creatorKey, keyOf(GUS))
  assert.equal(service.rooms.get(club.roomKey).createdBy, keyOf(GUS).slice(0, 8))
  assert.equal(joined.creatorKey, keyOf(GUS))
  assert.equal(joined.creatorProof, club.creatorProof)
  const ben = await connect(service, BEN, [club.roomKey])
  await claim(service, ben, club.roomKey)
  assert.equal(service.rooms.get(club.roomKey).creatorKey, keyOf(GUS))

  // A secret that does not make the room's key with that creator: neither.
  const other = makeCreatorRoomKey(keyOf(GUS))
  await service.joinRoom({ roomKey: other.roomKey, creatorKey: keyOf(BEN), creatorProof: club.creatorProof })
  assert.ok(!service.rooms.get(other.roomKey).creatorKey)
  assert.ok(!service.rooms.get(other.roomKey).creatorProof)
  // Here already with nobody as its maker, the invite's creator is taken.
  await service.joinRoom({ roomKey: other.roomKey, creatorKey: keyOf(GUS) })
  assert.equal(service.rooms.get(other.roomKey).creatorKey, keyOf(GUS))

  // The key alone, as the person who shared the link has it, until the secret
  // names somebody else.
  const third = makeCreatorRoomKey(keyOf(GUS))
  await service.joinRoom({ roomKey: third.roomKey, creatorKey: keyOf(BEN) })
  assert.equal(service.rooms.get(third.roomKey).creatorKey, keyOf(BEN))
  const cora = await connect(service, CORA, [third.roomKey])
  await service.handlePeerMessage(cora, { type: 'room-meta', roomKey: third.roomKey, name: 'Third', creatorKey: keyOf(GUS), creatorProof: third.creatorProof })
  assert.equal(service.rooms.get(third.roomKey).creatorKey, keyOf(GUS))

  // Here already with a claimed maker, an invite with the secret replaces it.
  const fourth = makeCreatorRoomKey(keyOf(GUS))
  await service.joinRoom({ roomKey: fourth.roomKey })
  const fay = await connect(service, FAY, [fourth.roomKey])
  await claim(service, fay, fourth.roomKey)
  assert.equal(service.rooms.get(fourth.roomKey).creatorKey, keyOf(FAY))
  await service.joinRoom({ roomKey: fourth.roomKey, creatorKey: keyOf(GUS), creatorProof: fourth.creatorProof })
  assert.equal(service.rooms.get(fourth.roomKey).creatorKey, keyOf(GUS))
})

test('an invite with the secret, opened for a room a claimed maker moved, brings the room back', async (t) => {
  const { service } = await startService(t)
  const club = makeCreatorRoomKey(keyOf(GUS))
  await service.joinRoom({ roomKey: club.roomKey })
  const ben = await connect(service, BEN, [club.roomKey])
  await claim(service, ben, club.roomKey)
  const his = makeCreatorRoomKey(keyOf(BEN))
  const hop = signMove({ fromTopic: wireRoom(club.roomKey), topicOf: wireRoom, to: his.roomKey, proof: his.creatorProof, chain: newKeyChain(), at: Date.now(), keyPair: BEN })
  await service.handlePeerMessage(ben, { type: 'room-moved', roomKey: club.roomKey, moves: [hop] })
  assert.equal(service.roomKeyFor(club.roomKey), his.roomKey)

  // A friend's invite to the room, with the secret: the phone is there
  // already, under Ben's key, and the invite sets it right.
  const shown = await service.joinRoom({ roomKey: club.roomKey, creatorKey: keyOf(GUS), creatorProof: club.creatorProof })
  assert.equal(shown.roomKey, club.roomKey)
  assert.equal(service.rooms.get(club.roomKey).creatorKey, keyOf(GUS))
  assert.ok(!service.rooms.has(his.roomKey))
  assert.equal(service.roomKeyFor(his.roomKey), club.roomKey)
})

test('a room tells the screen who made it for its invite, but not a direct message or P2P Republic', async (t) => {
  const { service } = await startService(t)
  const made = await service.createRoom({ name: 'Made here' })
  assert.equal(made.creatorKey, keyOf(PHONE))
  assert.ok(checkCreatorProof(made.roomKey, made.creatorKey, made.creatorProof))
  assert.equal(
    buildPeerChatInviteUrl(made.roomKey, made.creatorKey, made.creatorProof),
    `peersky://p2p/peerchat/#room=${made.roomKey}&creator=${keyOf(PHONE)}&proof=${made.creatorProof}`
  )

  // P2P Republic's maker ships with the app, so its invite stays the room alone.
  const republic = await service.joinRoom({ roomKey: PRE_JOINED_PEERCHAT_ROOM_KEY })
  assert.equal(republic.creatorKey, undefined)
  assert.equal(republic.creatorProof, undefined)
  assert.equal(buildPeerChatInviteUrl(republic.roomKey, republic.creatorKey, republic.creatorProof), `peersky://p2p/peerchat/#room=${PRE_JOINED_PEERCHAT_ROOM_KEY}`)

  // A direct message has no maker to name.
  const dmKey = 'd3'.repeat(32)
  service.rooms.set(dmKey, service.createDirectRoom({ roomKey: dmKey, peerId: keyOf(BEN).slice(0, 8), username: 'Ben', pendingAcceptance: false }))
  assert.equal(service.publicRoom(service.rooms.get(dmKey)).creatorKey, undefined)

  // A room made before the secret existed: the key alone.
  const older = 'e4'.repeat(32)
  await service.joinRoom({ roomKey: older })
  const gus = await connect(service, GUS, [older])
  await claim(service, gus, older)
  const shown = service.listRooms().find((entry) => entry.roomKey === older)
  assert.equal(shown.creatorKey, keyOf(GUS))
  assert.equal(shown.creatorProof, undefined)
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
  const left = []
  return {
    publicKey: PHONE.publicKey,
    swarm,
    localSwarm: new EventEmitter(),
    left,
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
