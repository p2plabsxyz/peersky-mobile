// Removing one of somebody's devices removes them all. Each device is a member
// of its own, so removing one left the person's other devices in the room. A
// device counts as theirs only by the person key its own profile proved
// (person-proof.mjs), so nobody can take someone else out by claiming to be
// them. As on desktop (PeerChat test/room-removal-every-device.test.js).
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { PeerChatService } from '../../backend/peerchat/service.mjs'
import { checkPersonProof, makePersonProof, personKey } from '../../backend/peerchat/person-proof.mjs'

const BOB_LINK = { key: 'b0'.repeat(32) }

test('a person key and signature are made as on the desktop', () => {
  const link = { key: 'ef'.repeat(32) }
  assert.equal(personKey(link), 'd3bf15e8fadd5284f2181aa53140f5678eb927d22156b3823c33c41b407a57f8')
  const proof = makePersonProof(link, '0d'.repeat(32))
  assert.equal(proof.sig, '022f768ba313a8b2531b47ca82f5a333f8a137e870e88b2725d67f22239e8b3400ad007cde84ecdcbdb093b92211c6a0dc4f80de51711542427707225ec9e50d')
  assert.equal(checkPersonProof(proof, '0d'.repeat(32)), personKey(link))
  assert.equal(checkPersonProof(proof, '0e'.repeat(32)), '')
})

test('removing one of somebody\'s devices removes them all, and one of theirs that turns up later', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-every-device-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => service.close())
  const room = await service.createRoom({ name: 'Trip', username: 'Creator' })
  const roomKey = room.roomKey

  const bobs = (key) => makePersonProof(BOB_LINK, key)
  const arrive = async (id, username, person) => {
    const peer = createFakePeer(id, username, roomKey)
    service.peers.set(peer.connection, peer)
    await service.handlePeerMessage(peer, { type: 'profile', username, bio: '', avatar: null, rooms: [roomKey], ...(person && { person: person(peer.key) }) })
    return peer
  }
  const desktop = await arrive('b1b1b1b1', 'Bob', bobs)
  const phone = await arrive('b2b2b2b2', 'Bob@mobile', bobs)
  const carol = await arrive('c1c1c1c1', 'Carol', null)
  const roomNow = () => [...service.rooms.values()].find((entry) => entry.name === 'Trip' && !entry.movedTo)
  for (const peer of [desktop, phone, carol]) assert.ok(roomNow().members.some((member) => member.id === peer.id))

  const removed = await service.removeRoomMember({ roomKey, peerId: phone.id })
  assert.deepEqual([...removed.removed].sort(), [desktop.id, phone.id])
  const bans = new Map(service.rooms.get(roomKey).bans.map((ban) => [ban.id, ban]))
  assert.equal(bans.get(desktop.id)?.key, desktop.key)
  assert.equal(bans.get(phone.id)?.key, phone.key)
  assert.equal(bans.has(carol.id), false, 'somebody else is left alone')

  // Another of Bob's devices, later: out once it proves whose it is.
  const tablet = await arrive('b3b3b3b3', 'Bob@desktop1', bobs)
  assert.ok(service.rooms.get(roomKey).bans.some((ban) => ban.id === tablet.id && ban.key === tablet.key))

  // Bob's person key with a signature made for another device is worthless.
  const copied = makePersonProof(BOB_LINK, '0d'.repeat(32))
  const mallory = await arrive('d1d1d1d1', 'Mallory', () => ({ key: personKey(BOB_LINK), sig: copied.sig }))
  assert.equal(service.rooms.get(roomKey).bans.some((ban) => ban.id === mallory.id), false)

  // And back in, every one of them.
  await service.restoreRoomMember({ roomKey, peerId: desktop.id })
  assert.deepEqual(service.rooms.get(roomKey).bans, [])
})

test('removing one of your own other devices removes only that one', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-own-device-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => service.close())
  service.link = { key: 'a0'.repeat(32), origin: 'desktop', labels: [] }
  const room = await service.createRoom({ name: 'Mine', username: 'Ada' })
  const mine = (key) => makePersonProof(service.link, key)
  const one = createFakePeer('a1a1a1a1', 'Ada@desktop1', room.roomKey)
  const two = createFakePeer('a2a2a2a2', 'Ada@desktop2', room.roomKey)
  for (const peer of [one, two]) {
    service.peers.set(peer.connection, peer)
    await service.handlePeerMessage(peer, { type: 'profile', username: peer.username, bio: '', avatar: null, rooms: [room.roomKey], person: mine(peer.key) })
  }
  const removed = await service.removeRoomMember({ roomKey: room.roomKey, peerId: one.id })
  assert.deepEqual(removed.removed, [one.id])
})

function createFakePeer (id, username, roomKey) {
  const connection = { destroyed: false, handshakeHash: Buffer.alloc(64, 9), publicKey: Buffer.alloc(32, 7) }
  return {
    active: true,
    connection,
    id,
    key: id.repeat(8),
    buffer: '',
    pendingMessages: 0,
    processing: Promise.resolve(),
    lastReceivedAt: Date.now(),
    username,
    bio: '',
    avatar: null,
    rooms: [roomKey],
    controlRate: { count: 0, resetsAt: Date.now() + 60_000 },
    liveRate: { count: 0, resetsAt: Date.now() + 60_000 },
    transport: { send: () => true }
  }
}

class FakeFeed extends EventEmitter {
  constructor () {
    super()
    this.entries = []
  }

  get length () { return this.entries.length }
  async ready () {}
  async get (index) { return this.entries[index] }
  async append (entry) {
    this.entries.push(entry)
    this.emit('append')
  }

  async close () {}
}

function createFakeSdk () {
  const feeds = new Map()
  const swarm = new EventEmitter()
  swarm.flush = async () => {}
  return {
    publicKey: Buffer.alloc(32, 7),
    swarm,
    localSwarm: new EventEmitter(),
    corestore: { get ({ name }) { if (!feeds.has(name)) feeds.set(name, new FakeFeed()); return feeds.get(name) } },
    join () {},
    async leave () {}
  }
}
