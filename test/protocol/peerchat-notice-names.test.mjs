import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { PeerChatService } from '../../backend/peerchat/service.mjs'
import { nameNotice } from '../../backend/peerchat/notice-names.mjs'
import { PRE_JOINED_PEERCHAT_ROOM_KEY } from '../../backend/peerchat/rooms.mjs'

// Onboarding joins the welcome room before the name is saved, and the phone
// used to announce that join with its id where the name belongs. Desktops wrote
// "ac368f46 joined" into Peer-to-Peer Republic for good.

const ROOM = PRE_JOINED_PEERCHAT_ROOM_KEY

test('an id in a join, leave or removal line reads as the name, or not at all', () => {
  const names = { ac368f46: 'Sam' }
  const nameFor = (id) => names[id] || ''
  assert.equal(nameNotice('ac368f46 joined', nameFor), 'Sam joined')
  assert.equal(nameNotice('ac368f46 was removed from the room by Alice', nameFor), 'Sam was removed from the room by Alice')
  assert.equal(nameNotice('fe5a73d9 joined', nameFor), null)
  assert.equal(nameNotice('fe5a73d9 left', nameFor), null)
  assert.equal(nameNotice('fe5a73d9 was removed from the room by Alice', nameFor), 'Someone was removed from the room by Alice')
  assert.equal(nameNotice('Gus joined', nameFor), 'Gus joined')
  assert.equal(nameNotice('deadbeef joined', nameFor, (name) => name === 'deadbeef'), 'deadbeef joined')
})

test('no join goes out before there is a name, and it goes out once onboarding sets one', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-join-name-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => service.close())
  await service.joinRoomWithoutProfile(ROOM)

  const frames = []
  const desktop = createFakePeer('de5c7a11', 'Desk', frames)
  service.peers.set(desktop.connection, desktop)
  service.shareRoom(desktop, ROOM)
  assert.deepEqual(frames.filter((frame) => frame.type === 'join'), [])

  await service.completeOnboarding({ username: 'Sam' })
  const joins = frames.filter((frame) => frame.type === 'join')
  assert.equal(joins.length, 1)
  assert.equal(joins[0].username, 'Sam')
  assert.equal(joins[0].peerId, service.localId)
})

test('a join with an id for a name makes no member and no line', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-join-id-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => service.close())
  service.setProfile({ username: 'Alice', bio: '' })
  await service.joinRoom({ roomKey: ROOM })
  service.sendRoomMeta = () => {}

  const phone = createFakePeer('ac368f46', '')
  service.peers.set(phone.connection, phone)
  await service.handlePeerMessage(phone, { type: 'join', roomKey: ROOM, peerId: 'ac368f46', username: 'ac368f46', ts: Date.now() - 1000 })
  assert.equal(phone.username, '')
  assert.equal((service.rooms.get(ROOM).members || []).find((member) => member.id === 'ac368f46'), undefined)
  const notices = service.feeds.get(ROOM).entries.filter((entry) => entry.type === 'system')
  assert.deepEqual(notices, [])

  // The same phone once it has a name.
  await service.handlePeerMessage(phone, { type: 'join', roomKey: ROOM, peerId: 'ac368f46', username: 'Sam', ts: Date.now() - 1000 })
  assert.equal((service.rooms.get(ROOM).members || []).find((member) => member.id === 'ac368f46')?.username, 'Sam')
  assert.deepEqual(
    service.feeds.get(ROOM).entries.filter((entry) => entry.type === 'system').map((entry) => entry.message),
    ['Sam joined']
  )
})

test('a removal written with an id reads with the name the phone knows', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-removal-name-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => service.close())
  service.setProfile({ username: 'Alice', bio: '' })
  await service.joinRoom({ roomKey: ROOM })
  service.rooms.get(ROOM).members = [{ id: 'ac368f46', username: 'Sam', bio: '', avatar: null, joinedAt: 1 }]

  const line = (message) => service.entryToSystemMessage({ id: 'x', type: 'system', moderationNotice: true, message, ts: 1 })
  assert.equal(line('ac368f46 was removed from the room by Alice').message, 'Sam was removed from the room by Alice')
  assert.equal(line('fe5a73d9 was removed from the room by Alice').message, 'Someone was removed from the room by Alice')
  assert.equal(line('fe5a73d9 joined'), null)
  assert.equal(line('Final warning for Bob (spam)').message, 'Final warning for Bob (spam)')
})

function createFakeSdk () {
  const swarm = new EventEmitter()
  swarm.flush = async () => {}
  const feeds = new Map()
  return {
    publicKey: Buffer.alloc(32, 7),
    swarm,
    localSwarm: new EventEmitter(),
    corestore: {
      get ({ name }) {
        if (!feeds.has(name)) feeds.set(name, new FakeFeed())
        return feeds.get(name)
      }
    },
    join () {},
    async leave () {}
  }
}

function createFakePeer (id, username, frames = []) {
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
    rooms: [ROOM],
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
