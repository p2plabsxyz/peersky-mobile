import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { PeerChatService } from '../../backend/peerchat/service.mjs'
import { collapsePeerChatMembers } from '../../backend/peerchat/members.mjs'
import { derivePeerChatTopic } from '../../backend/peerchat/protocol.mjs'
import { roomProof } from '../../backend/peerchat/room-proof.mjs'

// Away: the app in the background on a phone, or a desktop locked, asleep,
// idle or behind another app. People in a room with you see a yellow dot and
// Idle; a group's count is still everyone online, away or not.

const ROOM_KEY = 'ab'.repeat(32)
const wireRoom = (roomKey) => derivePeerChatTopic(roomKey).toString('hex')
const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8')

async function startService (t) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-idle-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => service.close())
  service.setProfile({ username: 'Alice', bio: '' })
  await service.joinRoom({ roomKey: ROOM_KEY })
  service.shareRoom = () => {}
  return service
}

// A connection that has proved nothing yet: it knows one of our topics.
function connect (service, id, username) {
  const frames = []
  const peer = createFakePeer(id, username, frames)
  peer.rooms = []
  service.peers.set(peer.connection, peer)
  peer.presence = () => frames.filter((frame) => frame.type === 'presence').map((frame) => frame.state)
  return peer
}

async function proveRoom (service, peer) {
  await service.handlePeerMessage(peer, {
    type: 'topics',
    rooms: [{ topic: wireRoom(ROOM_KEY), proof: roomProof(ROOM_KEY, peer.connection.handshakeHash, peer.key) }]
  })
}

test('a member hears whether this phone is away as the room opens, and each time it changes', async (t) => {
  const service = await startService(t)
  const stranger = connect(service, 'ee00ee00', 'Eve')
  const member = connect(service, 'bb00bb00', 'Bob')

  service.setIdle(true)
  await proveRoom(service, member)
  assert.deepEqual(member.presence(), ['idle'])
  // Once a connection, not once a room.
  await service.handlePeerMessage(member, {
    type: 'topics',
    rooms: [{ topic: wireRoom(ROOM_KEY), proof: roomProof(ROOM_KEY, member.connection.handshakeHash, member.key) }]
  })
  assert.deepEqual(member.presence(), ['idle'])

  service.setIdle(true)
  service.setIdle(false)
  service.setIdle(true)
  assert.deepEqual(member.presence(), ['idle', 'active', 'idle'])
  // Someone who only knows a topic hears none of it.
  assert.deepEqual(stranger.presence(), [])
})

test('a member who says they are away is idle until they say otherwise, and a stranger cannot say it', async (t) => {
  const service = await startService(t)
  const bob = connect(service, 'bb00bb00', 'Bob')
  const eve = connect(service, 'ee00ee00', 'Eve')
  await proveRoom(service, bob)

  await service.handlePeerMessage(eve, { type: 'presence', state: 'idle' })
  assert.equal(service.isPeerIdle('ee00ee00'), false)

  const before = service.version
  await service.handlePeerMessage(bob, { type: 'presence', state: 'idle' })
  assert.equal(service.isPeerIdle('bb00bb00'), true)
  assert.ok(service.version > before, 'the screens are told')
  const members = service.listRoomMembers(ROOM_KEY)
  assert.deepEqual(members.find((member) => member.id === 'bb00bb00'), {
    id: 'bb00bb00', username: 'Bob', bio: '', avatar: null, self: false, online: true, idle: true
  })
  // A group still counts them as online: Bob is the one peer in the room.
  assert.equal(service.countRoomPeers(ROOM_KEY), 1)

  await service.handlePeerMessage(bob, { type: 'presence', state: 'active' })
  assert.equal(service.isPeerIdle('bb00bb00'), false)
  // Anything else is here too.
  await service.handlePeerMessage(bob, { type: 'presence', state: 'idle' })
  await service.handlePeerMessage(bob, { type: 'presence', state: 'asleep' })
  assert.equal(service.isPeerIdle('bb00bb00'), false)
})

test('an away member stays away through a redial, and starts as here only after really leaving', async (t) => {
  const service = await startService(t)
  const bob = connect(service, 'bb00bb00', 'Bob')
  await proveRoom(service, bob)
  await service.handlePeerMessage(bob, { type: 'presence', state: 'idle' })
  assert.equal(service.isPeerIdle('bb00bb00'), true)
  const newConnection = () => Object.assign(createFakePeer('bb00bb00', 'Bob'), { active: false })

  // A second connection alongside the first is as they last said.
  const alongside = newConnection()
  service.activatePeer(alongside)
  assert.equal(service.isPeerIdle('bb00bb00'), true)

  // So is one back from a redial inside the grace. Taking each new connection
  // as here turned the dot green on every redial.
  service.deactivatePeer(bob)
  service.deactivatePeer(alongside)
  const again = newConnection()
  service.activatePeer(again)
  assert.equal(service.isPeerIdle('bb00bb00'), true)

  // Gone past the grace, a new connection starts as here, which is all an
  // older build that never says either way can be.
  service.deactivatePeer(again)
  service.presence.clear()
  service.activatePeer(newConnection())
  assert.equal(service.isPeerIdle('bb00bb00'), false)
  for (const peer of service.peers.values()) clearInterval(peer.pingTimer)
})

test('a direct message says Idle for someone away, and offline is offline', async (t) => {
  const service = await startService(t)
  const bob = connect(service, 'bb00bb00', 'Bob')
  await proveRoom(service, bob)
  const room = service.rooms.get(ROOM_KEY)
  room.isDM = true
  room.dmWith = 'bb00bb00'

  assert.equal(service.publicRoom(room).dmIdle, false)
  await service.handlePeerMessage(bob, { type: 'presence', state: 'idle' })
  assert.equal(service.publicRoom(room).dmOnline, true)
  assert.equal(service.publicRoom(room).dmIdle, true)

  service.peers.delete(bob.connection)
  service.presence.clear()
  assert.equal(service.publicRoom(room).dmOnline, false)
  assert.equal(service.publicRoom(room).dmIdle, false)
})

test('a peer that will not stop saying it is no longer heard', async (t) => {
  const service = await startService(t)
  const bob = connect(service, 'bb00bb00', 'Bob')
  await proveRoom(service, bob)
  for (let i = 0; i < 30; i++) await service.handlePeerMessage(bob, { type: 'presence', state: 'active' })
  await service.handlePeerMessage(bob, { type: 'presence', state: 'idle' })
  assert.equal(service.isPeerIdle('bb00bb00'), false)
})

test('one person here on one device and away on another is here', () => {
  const collapsed = collapsePeerChatMembers([
    { id: 'aaaaaaaa', username: 'Bob', online: true, idle: true, self: false },
    { id: 'bbbbbbbb', username: 'Bob', online: true, idle: false, self: false }
  ])
  assert.deepEqual(collapsed.map((member) => member.id), ['bbbbbbbb'])
})

test('the app says away in the background and back when active, and only then', async () => {
  const index = await read('app/index.tsx')
  assert.match(index, /if \(\(nextState === 'background' \|\| nextState === 'active'\) && rpcRef\.current\) \{\s+void callRpc\(RPC_PEERCHAT_PRESENCE, \{ idle: nextState === 'background' \}\)/)
  assert.match(index, /void callRpc\(RPC_PEERCHAT_PRESENCE, \{ idle: appStateRef\.current === 'background' \}\)/)

  // Telling PeerChat never opens it.
  const router = await read('backend/rpc/router.mjs')
  assert.match(router, /if \(req\.command === RPC_PEERCHAT_PRESENCE\) \{\s+setPeerChatIdle\(parseJsonMessage\(req\.data\)\.idle === true\)\s+replyJson\(req, \{ ok: true \}\)/)
  const runtime = await read('backend/peerchat/runtime.mjs')
  assert.match(runtime, /nextService\.setIdle\(idle\)/)
})

test('PeerChat draws away in yellow and says Idle, and a group header still counts who is online', async () => {
  const screen = await read('app/peerchat/PeerChatScreen.tsx')
  assert.match(screen, /idle: '#f0b232'/)
  assert.match(screen, /idle: '#e5a50a',\s+idleText: '#9a6700'/)
  assert.match(screen, /if \(room\.isDM\) return isRoomIdle\(room\) \? 'Idle' : isRoomOnline\(room\) \? 'Online' : 'Offline'/)
  assert.equal(screen.match(/backgroundColor: memberDotColor\(member, colors\)/g)?.length, 2)
  assert.equal(screen.match(/member\.bio \|\| formatMemberPresence\(member\)/g)?.length, 2)
  assert.match(screen, /\? `\$\{room\.peerCount\} online`/)
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
    rooms: [ROOM_KEY],
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
