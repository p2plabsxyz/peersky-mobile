import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  MAX_PEERCHAT_ROOM_STORAGE_BYTES,
  PeerChatService
} from '../../backend/peerchat/service.mjs'
import { encryptPeerChatMessage } from '../../backend/peerchat/protocol.mjs'

const ROOM_KEY = 'ab'.repeat(32)

test('PeerChat persists basic rooms and returns version-aware message snapshots', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))

  const feeds = new Map()
  const firstSdk = createFakeSdk(feeds)
  const service = await new PeerChatService({ sdk: firstSdk, storagePath }).start()
  const room = await service.createRoom({ name: 'Mobile Room', username: 'Alice Mobile' })
  const replyTo = {
    id: 'desktop-message',
    sender: 'desktop-peer',
    sn: 'Desktop',
    text: 'Original message'
  }
  const sent = await service.sendMessage({ roomKey: room.roomKey, message: 'Hello desktop', replyTo })
  const snapshot = await service.getSnapshot({ roomKey: room.roomKey, version: -1 })

  assert.equal(firstSdk.joined.length, 1)
  assert.equal(snapshot.profile.username, 'Alice Mobile')
  assert.equal(snapshot.room.name, 'Mobile Room')
  assert.equal(snapshot.messages.length, 1)
  assert.equal(snapshot.messages[0].id, sent.id)
  assert.equal(snapshot.messages[0].message, 'Hello desktop')
  assert.equal(snapshot.messages[0].self, true)
  assert.deepEqual(snapshot.messages[0].replyTo, replyTo)

  const unchanged = await service.getSnapshot({
    roomKey: room.roomKey,
    version: snapshot.version
  })
  assert.equal(unchanged.messages, null)

  await service.close()
  const persisted = JSON.parse(await readFile(path.join(storagePath, 'peerchat-mobile.json'), 'utf8'))
  assert.equal(persisted.profile.username, 'Alice Mobile')
  assert.equal(persisted.rooms.length, 1)

  const secondSdk = createFakeSdk(cloneFeeds(feeds))
  const restarted = await new PeerChatService({ sdk: secondSdk, storagePath }).start()
  const restoredRooms = restarted.listRooms()
  const restored = await restarted.getSnapshot({ roomKey: room.roomKey, version: -1 })

  assert.equal(secondSdk.joined.length, 1)
  assert.equal(restoredRooms[0].name, 'Mobile Room')
  assert.equal(restored.messages[0].message, 'Hello desktop')
  assert.deepEqual(restored.messages[0].replyTo, replyTo)
  await restarted.close()
})

test('PeerChat rejects invalid identities, rooms, and empty messages', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-limits-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()

  assert.throws(() => service.setProfile({ username: 'invalid_name' }), /letters, numbers/)
  await assert.rejects(
    service.joinRoom({ roomKey: 'short', username: 'Alice' }),
    /64-character/
  )
  const room = await service.createRoom({ name: 'Room', username: 'Alice' })
  await assert.rejects(
    service.sendMessage({ roomKey: room.roomKey, message: '   ' }),
    /Enter a message/
  )
  await assert.rejects(
    service.sendMessage({ roomKey: room.roomKey, message: '😀'.repeat(32 * 1024) }),
    /UTF-8 bytes/
  )
  assert.equal(service.feeds.get(room.roomKey).length, 0)
  await service.close()
})

test('PeerChat preserves sanitized reply metadata from desktop peers', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-reply-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  await service.joinRoom({ roomKey: ROOM_KEY, username: 'Alice' })
  const peer = {
    id: 'desktop-peer',
    username: 'Desktop',
    rooms: [ROOM_KEY],
    initialSyncCount: 0,
    liveRate: { count: 0, resetsAt: Date.now() + 60_000 }
  }

  await service.handlePeerMessage(peer, {
    id: 'desktop-message',
    roomKey: ROOM_KEY,
    sender: 'ignored-live-sender',
    sn: 'Desktop',
    ...encryptPeerChatMessage('Reply from desktop', ROOM_KEY),
    replyTo: {
      id: 'mobile-message',
      sender: 'mobile-peer\u202E',
      sn: 'Alice',
      text: 'Original mobile message'
    },
    ts: Date.now()
  })

  const snapshot = await service.getSnapshot({ roomKey: ROOM_KEY, version: -1 })
  assert.deepEqual(snapshot.messages[0].replyTo, {
    id: 'mobile-message',
    sender: 'mobile-peer',
    sn: 'Alice',
    text: 'Original mobile message'
  })
  await service.close()
})

test('PeerChat stores, toggles, and history-syncs desktop-compatible reactions', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-reactions-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  const room = await service.createRoom({ name: 'Reaction Room', username: 'Alice' })
  const sent = await service.sendMessage({ roomKey: room.roomKey, message: 'React here' })

  await service.reactToMessage({ roomKey: room.roomKey, msgId: sent.id, emoji: '👍' })
  let snapshot = await service.getSnapshot({ roomKey: room.roomKey, version: -1 })
  assert.deepEqual(snapshot.messages[0].reactions, [{ emoji: '👍', count: 1, self: true }])

  const frames = []
  await service.syncHistoryToPeer({
    connection: { destroyed: false },
    rooms: [room.roomKey],
    transport: { send: (frame) => frames.push(JSON.parse(frame)) || true }
  }, room.roomKey)
  assert.deepEqual(frames.map((frame) => frame.type), ['sync', 'sync-reaction', 'sync-done'])

  await service.reactToMessage({ roomKey: room.roomKey, msgId: sent.id, emoji: '' })
  snapshot = await service.getSnapshot({ roomKey: room.roomKey, version: -1 })
  assert.deepEqual(snapshot.messages[0].reactions, [])
  await service.close()
})

test('PeerChat applies only the newest reaction event from a desktop peer', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-remote-reactions-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  const room = await service.createRoom({ name: 'Remote Reactions', username: 'Alice' })
  const sent = await service.sendMessage({ roomKey: room.roomKey, message: 'React here' })
  const now = Date.now()
  const peer = {
    id: 'desktop-peer',
    username: 'Desktop',
    rooms: [room.roomKey],
    initialSyncCount: 0,
    liveRate: { count: 0, resetsAt: now + 60_000 }
  }

  await service.handlePeerMessage(peer, {
    type: 'sync-reaction',
    id: 'new-reaction',
    roomKey: room.roomKey,
    msgId: sent.id,
    emoji: '🔥',
    sender: 'desktop-peer',
    sn: 'Desktop',
    ts: now
  })
  await service.handlePeerMessage(peer, {
    type: 'sync-reaction',
    id: 'stale-reaction',
    roomKey: room.roomKey,
    msgId: sent.id,
    emoji: '😢',
    sender: 'desktop-peer',
    sn: 'Desktop',
    ts: now - 1000
  })

  const snapshot = await service.getSnapshot({ roomKey: room.roomKey, version: -1 })
  assert.deepEqual(snapshot.messages[0].reactions, [{ emoji: '🔥', count: 1, self: false }])
  await service.close()
})

test('PeerChat persists bounded unread and mention counts and clears them for active rooms', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-unread-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const feeds = new Map()
  const service = await new PeerChatService({ sdk: createFakeSdk(feeds), storagePath }).start()
  const room = await service.createRoom({ name: 'Unread Room', username: 'Alice Mobile' })
  const peer = {
    id: 'desktop-peer',
    username: 'Desktop',
    rooms: [room.roomKey],
    initialSyncCount: 0,
    liveRate: { count: 0, resetsAt: Date.now() + 60_000 }
  }

  await service.handlePeerMessage(peer, {
    id: 'desktop-mention',
    roomKey: room.roomKey,
    sn: 'Desktop',
    ...encryptPeerChatMessage('Hello @alice mobile', room.roomKey),
    ts: Date.now() + 1_000
  })
  let listed = service.listRooms()[0]
  assert.equal(listed.unreadCount, 1)
  assert.equal(listed.unreadMentions, 1)

  const active = service.setActiveRoom({ roomKey: room.roomKey })
  assert.equal(active.rooms[0].unreadCount, 0)
  await service.handlePeerMessage(peer, {
    id: 'desktop-active-message',
    roomKey: room.roomKey,
    sn: 'Desktop',
    ...encryptPeerChatMessage('Visible now', room.roomKey),
    ts: Date.now() + 2_000
  })
  assert.equal(service.listRooms()[0].unreadCount, 0)

  service.setActiveRoom({ roomKey: null })
  await service.handlePeerMessage(peer, {
    id: 'desktop-unread-message',
    roomKey: room.roomKey,
    sn: 'Desktop',
    ...encryptPeerChatMessage('Read later', room.roomKey),
    ts: Date.now() + 3_000
  })
  assert.equal(service.listRooms()[0].unreadCount, 1)
  await service.close()

  const restarted = await new PeerChatService({ sdk: createFakeSdk(cloneFeeds(feeds)), storagePath }).start()
  listed = restarted.listRooms()[0]
  assert.equal(listed.unreadCount, 1)
  assert.equal(listed.unreadMentions, 0)
  await restarted.close()
})

test('PeerChat exposes bounded participant names from desktop profile frames', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-members-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  const room = await service.createRoom({ name: 'Members', username: 'Alice Mobile' })
  const peer = {
    id: 'desktop-peer',
    username: '',
    rooms: [room.roomKey],
    controlRate: { count: 0, resetsAt: Date.now() + 60_000 }
  }
  service.peers.set({}, peer)

  await service.handlePeerMessage(peer, { type: 'profile', username: 'Desktop User' })
  assert.deepEqual(service.listRooms()[0].members, [
    { id: service.localId, username: 'Alice Mobile', self: true },
    { id: 'desktop-peer', username: 'Desktop User', self: false }
  ])

  await service.handlePeerMessage(peer, { type: 'profile', username: '<invalid>' })
  assert.equal(service.listRooms()[0].members[1].username, 'Desktop User')
  await service.close()
})

test('PeerChat persists pinned rooms and sorts them before newer chats', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-pins-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const feeds = new Map()
  const service = await new PeerChatService({ sdk: createFakeSdk(feeds), storagePath }).start()
  const pinned = await service.createRoom({ name: 'Pinned', username: 'Alice' })
  const newer = await service.createRoom({ name: 'Newer', username: 'Alice' })

  const result = service.setRoomPinned({ roomKey: pinned.roomKey, pinned: true })
  assert.equal(result.rooms[0].roomKey, pinned.roomKey)
  assert.equal(result.rooms[0].isPinned, true)
  assert.equal(result.rooms[1].roomKey, newer.roomKey)
  assert.throws(
    () => service.setRoomPinned({ roomKey: pinned.roomKey, pinned: 'yes' }),
    /Invalid PeerChat pin state/
  )
  await service.close()

  const restarted = await new PeerChatService({ sdk: createFakeSdk(cloneFeeds(feeds)), storagePath }).start()
  assert.equal(restarted.listRooms()[0].roomKey, pinned.roomKey)
  assert.equal(restarted.listRooms()[0].isPinned, true)
  await restarted.close()
})

test('PeerChat persists local room mute preferences', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-mute-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const feeds = new Map()
  const service = await new PeerChatService({ sdk: createFakeSdk(feeds), storagePath }).start()
  const room = await service.createRoom({ name: 'Quiet Room', username: 'Alice' })

  const result = service.setRoomMuted({ roomKey: room.roomKey, muted: true })
  assert.equal(result.room.isMuted, true)
  assert.throws(
    () => service.setRoomMuted({ roomKey: room.roomKey, muted: 'yes' }),
    /Invalid PeerChat mute state/
  )
  await service.close()

  const restarted = await new PeerChatService({ sdk: createFakeSdk(cloneFeeds(feeds)), storagePath }).start()
  assert.equal(restarted.listRooms()[0].isMuted, true)
  await restarted.close()
})

test('PeerChat serializes concurrent room joins and removes feed listeners', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-joins-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const feeds = new Map()
  const sdk = createFakeSdk(feeds)
  const service = await new PeerChatService({ sdk, storagePath }).start()

  const [firstRoom, secondRoom] = await Promise.all([
    service.joinRoom({ roomKey: ROOM_KEY, username: 'Alice' }),
    service.joinRoom({ roomKey: ROOM_KEY, username: 'Alice' })
  ])
  const feed = feeds.get(`chat-${ROOM_KEY}`)

  assert.equal(firstRoom.roomKey, ROOM_KEY)
  assert.equal(secondRoom.roomKey, ROOM_KEY)
  assert.equal(sdk.coreGets, 1)
  assert.equal(feed.listenerCount('append'), 1)

  await service.leaveRoom({ roomKey: ROOM_KEY })
  assert.equal(feed.listenerCount('append'), 0)
  await service.joinRoom({ roomKey: ROOM_KEY, username: 'Alice' })
  assert.equal(feed.listenerCount('append'), 1)
  await service.close()
  assert.equal(feed.listenerCount('append'), 0)
})

test('PeerChat synchronizes history only once for repeated join frames', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-sync-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  await service.joinRoom({ roomKey: ROOM_KEY, username: 'Alice' })

  let syncCount = 0
  service.syncHistoryToPeer = async () => {
    syncCount += 1
    return true
  }
  const peer = {
    connection: { destroyed: false },
    controlRate: { count: 0, resetsAt: Date.now() + 60_000 },
    id: 'desktop',
    rooms: [ROOM_KEY],
    syncedRooms: new Set(),
    syncingRooms: new Map(),
    transport: { send: () => true }
  }

  await service.handlePeerMessage(peer, { type: 'join', roomKey: ROOM_KEY, username: 'Desktop' })
  await service.handlePeerMessage(peer, { type: 'join', roomKey: ROOM_KEY, username: 'Desktop' })
  assert.equal(syncCount, 1)
  await service.close()
})

test('PeerChat retries an incomplete history sync and reports room connection state', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-retry-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  await service.joinRoom({ roomKey: ROOM_KEY, username: 'Alice' })

  let syncCount = 0
  service.syncHistoryToPeer = async () => {
    syncCount += 1
    return syncCount > 1
  }
  const peer = {
    active: true,
    connection: { destroyed: false },
    controlRate: { count: 0, resetsAt: Date.now() + 60_000 },
    id: 'desktop',
    rooms: [ROOM_KEY],
    syncedRooms: new Set(),
    syncingRooms: new Map(),
    transport: { send: () => true }
  }
  service.peers.set(peer.connection, peer)

  assert.equal(service.listRooms()[0].connectionState, 'connected')
  await service.handlePeerMessage(peer, { type: 'join', roomKey: ROOM_KEY, username: 'Desktop' })
  assert.equal(peer.syncedRooms.has(ROOM_KEY), false)
  await service.handlePeerMessage(peer, { type: 'join', roomKey: ROOM_KEY, username: 'Desktop' })
  assert.equal(syncCount, 2)
  assert.equal(peer.syncedRooms.has(ROOM_KEY), true)

  service.peers.delete(peer.connection)
  assert.equal(service.listRooms()[0].connectionState, 'waiting')
  await service.close()
})

test('PeerChat bounds restored deduplication scans and stored room bytes', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-storage-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  await writeFile(path.join(storagePath, 'peerchat-mobile.json'), JSON.stringify({
    profile: { username: 'Alice' },
    rooms: [{ roomKey: ROOM_KEY, name: 'Restored Room', isHost: false }]
  }))

  const restoredFeed = new FakeFeed(Array.from({ length: 350 }, (_, index) => ({ id: `message-${index}` })))
  const feeds = new Map([[`chat-${ROOM_KEY}`, restoredFeed]])
  const service = await new PeerChatService({ sdk: createFakeSdk(feeds), storagePath }).start()
  assert.equal(restoredFeed.getCalls, 200)
  await service.close()

  const quotaPath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-quota-'))
  t.after(() => rm(quotaPath, { recursive: true, force: true }))
  const fullFeed = new FakeFeed([], MAX_PEERCHAT_ROOM_STORAGE_BYTES)
  const quotaService = await new PeerChatService({
    sdk: createFakeSdk(new Map([[`chat-${ROOM_KEY}`, fullFeed]])),
    storagePath: quotaPath
  }).start()
  await quotaService.joinRoom({ roomKey: ROOM_KEY, username: 'Alice' })
  await assert.rejects(
    quotaService.sendMessage({ roomKey: ROOM_KEY, message: 'No room left' }),
    /storage limit/
  )
  assert.equal(fullFeed.length, 0)
  await quotaService.close()
})

function createFakeSdk (feeds = new Map()) {
  const swarm = new EventEmitter()
  swarm.flush = async () => {}
  const localSwarm = new EventEmitter()
  const joined = []

  const sdk = {
    publicKey: Buffer.alloc(32, 7),
    swarm,
    localSwarm,
    joined,
    coreGets: 0,
    corestore: {
      get ({ name }) {
        sdk.coreGets += 1
        if (!feeds.has(name)) feeds.set(name, new FakeFeed())
        return feeds.get(name)
      }
    },
    join (topic) {
      joined.push(Buffer.from(topic).toString('hex'))
    },
    async leave () {}
  }
  return sdk
}

class FakeFeed extends EventEmitter {
  constructor (entries = [], initialByteLength = 0) {
    super()
    this.entries = entries
    this.initialByteLength = initialByteLength
    this.getCalls = 0
  }

  get length () {
    return this.entries.length
  }

  get byteLength () {
    return this.initialByteLength + Buffer.byteLength(JSON.stringify(this.entries))
  }

  async ready () {}

  async append (entry) {
    this.entries.push(structuredClone(entry))
    this.emit('append')
  }

  async get (index) {
    this.getCalls += 1
    return structuredClone(this.entries[index])
  }

  async close () {}
}

function cloneFeeds (feeds) {
  return new Map([...feeds].map(([name, feed]) => [name, new FakeFeed(structuredClone(feed.entries))]))
}
