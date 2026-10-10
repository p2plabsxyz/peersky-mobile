import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import crypto from 'hypercore-crypto'

import { PeerChatService } from '../../backend/peerchat/service.mjs'
import { derivePeerChatTopic, encryptPeerChatMessage } from '../../backend/peerchat/protocol.mjs'
import { signMessage } from '../../backend/peerchat/message-signature.mjs'

// A message is stored once, however many times it comes. The phone used to
// remember only the ids of the last 200 entries of each room when it started,
// in one set for every room cut at 10,000, so a peer's history that reached
// further back stored those messages again and the chat showed them twice
// (React warned about two children with the same key).

const ROOM = 'a1'.repeat(32)
const OTHER_ROOM = 'b2'.repeat(32)
const PHONE = crypto.keyPair(Buffer.alloc(32, 5))
const WRITER = crypto.keyPair(Buffer.alloc(32, 6))
const keyHex = (pair) => pair.publicKey.toString('hex')
const wireRoom = (roomKey) => derivePeerChatTopic(roomKey).toString('hex')

function written (pair, text, { id, ts }) {
  const sealed = encryptPeerChatMessage(text, ROOM)
  return {
    id,
    sender: keyHex(pair).slice(0, 8),
    sn: 'Writer',
    ...sealed,
    ts,
    ...signMessage({ topic: wireRoom(ROOM), id, ts, sn: 'Writer' }, sealed, pair)
  }
}

// The room's feed as an earlier run of the app left it.
async function startService (t, storedEntries) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-stored-once-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const sdk = createFakeSdk({ [`chat-${ROOM}`]: storedEntries })
  const service = await new PeerChatService({ sdk, storagePath }).start()
  t.after(() => service.close())
  await service.loadSigningKeys()
  service.setProfile({ username: 'Ada', bio: '' })
  await service.joinRoom({ roomKey: ROOM })
  service.rooms.get(ROOM).joinedAt = Date.now() - 600_000
  return service
}

async function shownIds (service) {
  const snapshot = await service.getSnapshot({ roomKey: ROOM, version: -1 })
  return (snapshot.messages || []).filter((message) => !message.system).map((message) => message.id)
}

function joinLines (count, ts) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${wireRoom(ROOM)}-p${index}-join-${ts + index}`,
    type: 'system',
    message: `Person ${index} joined`,
    ts: ts + index
  }))
}

// Entries the chat does not show as lines of their own.
function reactions (count, ts) {
  return Array.from({ length: count }, (_, index) => ({
    type: 'reaction',
    id: `reaction-${index}`,
    msgId: 'elsewhere',
    emoji: '\u{1F44D}',
    sender: index.toString(16).padStart(8, '0'),
    sn: `Person ${index}`,
    ts: ts + index
  }))
}

test('a message from earlier in the room that comes again in a peer\'s history is not stored twice', async (t) => {
  const now = Date.now()
  const old = written(WRITER, 'see you at seven', { id: '5a9359a9f939327d9b27e5f68182c258', ts: now - 300_000 })
  // Far enough back that it is not among the ids read when the room opens.
  const service = await startService(t, [old, ...reactions(250, now - 200_000)])
  assert.deepEqual(await shownIds(service), [old.id])

  const relay = connect(service, 'aa00aa00')
  await service.handlePeerMessage(relay, { ...old, type: 'sync', roomKey: ROOM })
  await service.handlePeerMessage(relay, { ...old, type: 'pass', room: wireRoom(ROOM), m: old })

  assert.deepEqual(await shownIds(service), [old.id])
  assert.equal(service.feeds.get(ROOM).length, 251)

  // Something new in the same history is still taken.
  const fresh = written(WRITER, 'running late', { id: 'fresh', ts: now - 1_000 })
  await service.handlePeerMessage(relay, { ...fresh, type: 'sync', roomKey: ROOM })
  assert.deepEqual(await shownIds(service), [old.id, 'fresh'])
})

test('a message an older build stored twice shows once', async (t) => {
  const now = Date.now()
  const twice = written(WRITER, 'stored twice', { id: 'twice', ts: now - 5_000 })
  const service = await startService(t, [twice, ...joinLines(3, now - 4_000), twice])
  assert.deepEqual(await shownIds(service), ['twice'])
})

test('a busy room does not make the phone forget what another room already has', async (t) => {
  const now = Date.now()
  const kept = written(WRITER, 'kept', { id: 'kept', ts: now - 9_000 })
  const service = await startService(t, [kept])
  await service.joinRoom({ roomKey: OTHER_ROOM })
  service.rooms.get(OTHER_ROOM).joinedAt = now - 600_000

  // A busy other room's history from many people, which used to push this
  // room's ids out of the one set every room shared. Each connection brings
  // at most 500 entries of history. The bodies are never opened.
  let relay
  for (let index = 0; index < 12_000; index += 1) {
    if (index % 500 === 0) relay = connect(service, (index / 500).toString(16).padStart(8, 'b'), [ROOM, OTHER_ROOM])
    await service.handlePeerMessage(relay, {
      type: 'sync',
      roomKey: OTHER_ROOM,
      id: `busy-${index}`,
      sender: relay.id,
      sn: 'Relay',
      ct: 'c0ffee',
      iv: '00112233445566778899aabb',
      tag: '0123456789abcdef0123456789abcdef',
      ts: now - 8_000
    })
  }

  // Someone who has just connected sends this room's history.
  await service.handlePeerMessage(connect(service, 'aa00aa00'), { ...kept, type: 'sync', roomKey: ROOM })
  assert.deepEqual(await shownIds(service), ['kept'])
})

function connect (service, id, rooms = [ROOM]) {
  const key = id.repeat(8)
  const peer = {
    active: true,
    connection: { destroyed: false, handshakeHash: Buffer.alloc(64, 9), publicKey: PHONE.publicKey },
    id,
    key,
    buffer: '',
    pendingMessages: 0,
    processing: Promise.resolve(),
    lastReceivedAt: Date.now(),
    username: id,
    bio: '',
    avatar: null,
    rooms: [...rooms],
    passes: true,
    initialSyncCount: 0,
    controlRate: { count: 0, resetsAt: Date.now() + 60_000 },
    liveRate: { count: 0, resetsAt: Date.now() + 60_000 },
    passRate: { count: 0, resetsAt: Date.now() + 60_000 },
    transport: { send: () => true }
  }
  service.peers.set(peer.connection, peer)
  return peer
}

function createFakeSdk (stored = {}) {
  const feeds = new Map(Object.entries(stored).map(([name, entries]) => [name, new FakeFeed(entries)]))
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

class FakeFeed extends EventEmitter {
  constructor (entries = []) {
    super()
    this.entries = entries.map((entry) => structuredClone(entry))
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
