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

const ROOM_KEY = 'ab'.repeat(32)

test('PeerChat persists basic rooms and returns version-aware message snapshots', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))

  const feeds = new Map()
  const firstSdk = createFakeSdk(feeds)
  const service = await new PeerChatService({ sdk: firstSdk, storagePath }).start()
  const room = await service.createRoom({ name: 'Mobile Room', username: 'Alice Mobile' })
  const sent = await service.sendMessage({ roomKey: room.roomKey, message: 'Hello desktop' })
  const snapshot = await service.getSnapshot({ roomKey: room.roomKey, version: -1 })

  assert.equal(firstSdk.joined.length, 1)
  assert.equal(snapshot.profile.username, 'Alice Mobile')
  assert.equal(snapshot.room.name, 'Mobile Room')
  assert.equal(snapshot.messages.length, 1)
  assert.equal(snapshot.messages[0].id, sent.id)
  assert.equal(snapshot.messages[0].message, 'Hello desktop')
  assert.equal(snapshot.messages[0].self, true)

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
