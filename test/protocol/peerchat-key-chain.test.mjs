import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import crypto from 'hypercore-crypto'

import {
  KEY_HOUR_MS,
  chainSecretAt,
  currentKeyGift,
  earlierKeyChain,
  hourOf,
  makeRotatingRoomKey,
  messageKeyAt,
  newKeyChain,
  roomRotates,
  takeKeyGift
} from '../../backend/peerchat/key-chain.mjs'
import { PeerChatService } from '../../backend/peerchat/service.mjs'
import {
  decryptPeerChatMessage,
  derivePeerChatTopic,
  encryptPeerChatMessage
} from '../../backend/peerchat/protocol.mjs'
import { decodeMessagePayload, encodeMessagePayload } from '../../backend/peerchat/link-preview.mjs'
import { normalizeSharedRooms } from '../../backend/peerchat/device-link.mjs'
import { PRE_JOINED_PEERCHAT_ROOM_KEY } from '../../backend/peerchat/rooms.mjs'
import { openPeerChatAttachment, uploadPeerChatAttachment } from '../../backend/peerchat/attachments.mjs'

// Room keys that rotate, so a stolen key cannot read old messages. Rooms and
// direct messages made on this version seal each hour's messages with a key
// from a chain that only goes forward. Rooms made before keep sealing with
// their room key, so every version reads them as it always has.

// The same vector is in peerchat's test/key-chain.test.js. If either app
// changes a byte of the chain, both of these fail.
const CHAIN = { first: 490000, secret: '11'.repeat(32) }
const MARKED = '7d7d9b49efb7ed5d6b3594fec3ecc129a689cc3d226b479d7fa329062d7bbd92'

test('works out the same keys as the desktop', () => {
  assert.equal(chainSecretAt(CHAIN, 490002), 'f1e0270a239eaaa0873b88aeeb5c3ecbf44f4ca6b906a4fc6e12340444b70b59')
  assert.equal(messageKeyAt(CHAIN, 490002).toString('hex'), 'fdb6e2c1df9797f5259bb9c5dcab8d53b5adb5ba4c5ffd9c8c9a9311b4688f57')
  assert.equal(roomRotates(MARKED), true)
})

test('leaves every room made before this as it was, P2P Republic included', () => {
  assert.equal(roomRotates(PRE_JOINED_PEERCHAT_ROOM_KEY), false)
  assert.equal(roomRotates('not a key'), false)
  assert.equal(roomRotates(MARKED.toUpperCase()), false)
})

test('goes forward only: nothing before the first hour a phone holds', () => {
  assert.equal(chainSecretAt(CHAIN, 489999), null)
  assert.equal(messageKeyAt(CHAIN, 489999), null)
  // Out of order asks give the same answers as in order ones.
  const later = chainSecretAt(CHAIN, 490010)
  assert.equal(chainSecretAt(CHAIN, 490002), 'f1e0270a239eaaa0873b88aeeb5c3ecbf44f4ca6b906a4fc6e12340444b70b59')
  assert.equal(chainSecretAt(CHAIN, 490010), later)
  assert.notEqual(chainSecretAt(CHAIN, 490011), later)
})

test('makes new rooms that carry the mark, with a chain for this hour', () => {
  assert.equal(roomRotates(makeRotatingRoomKey()), true)
  const now = 490000 * KEY_HOUR_MS + 5
  assert.equal(newKeyChain(now).first, 490000)
  assert.match(newKeyChain(now).secret, /^[0-9a-f]{64}$/)
})

test('gives a joining member the current hour and nothing older', () => {
  const now = 490003 * KEY_HOUR_MS + 1000
  assert.deepEqual(currentKeyGift(CHAIN, now), { e: 490003, secret: chainSecretAt(CHAIN, 490003) })
  assert.equal(hourOf(now), 490003)
})

test('takes a key from the room only when it has none, and only for about now', () => {
  const now = 490003 * KEY_HOUR_MS
  const gift = currentKeyGift(CHAIN, now)
  assert.deepEqual(takeKeyGift(null, gift, now), { chain: { first: 490003, secret: gift.secret }, taken: true })
  // A far hour is not trusted, from anybody.
  assert.equal(takeKeyGift(null, { e: 490003 - 30, secret: gift.secret }, now).taken, false)
  // A phone with a chain keeps it, and says whether the two agree.
  assert.deepEqual(takeKeyGift(CHAIN, gift, now), { chain: CHAIN, taken: false, agrees: true })
  assert.equal(takeKeyGift(CHAIN, { e: 490003, secret: '22'.repeat(32) }, now).agrees, false)
  assert.equal(takeKeyGift(null, { e: 490003, secret: 'nope' }, now).taken, false)
})

test('lets the person\'s own devices share the earliest start of one chain', () => {
  const later = { first: 490005, secret: chainSecretAt(CHAIN, 490005) }
  assert.deepEqual(earlierKeyChain(later, CHAIN), CHAIN)
  assert.deepEqual(earlierKeyChain(CHAIN, later), CHAIN)
  // Not a different chain claiming to be earlier.
  assert.deepEqual(earlierKeyChain(later, { first: 489000, secret: '33'.repeat(32) }), later)
})

// Over the service. OLD was made before rotation and carries no mark. THEIRS
// was made elsewhere on this version, and this phone joined it with no chain.
const OLD = 'a1'.repeat(32)
const THEIRS = MARKED
const PHONE = crypto.keyPair(Buffer.alloc(32, 5))
const wireRoom = (roomKey) => derivePeerChatTopic(roomKey).toString('hex')
const textOf = (frame, roomKey, hourKey) => decodeMessagePayload(decryptPeerChatMessage(frame, roomKey, hourKey)).text

async function startService (t, storagePath) {
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => service.close())
  await service.loadSigningKeys()
  return service
}

async function setUp (t) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-key-chain-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await startService(t, storagePath)
  service.setProfile({ username: 'Ada', bio: '' })
  await service.joinRoom({ roomKey: OLD })
  await service.joinRoom({ roomKey: THEIRS })
  const room = await service.createRoom({ name: 'New room', username: 'Ada' })
  return { service, storagePath, mine: room.roomKey }
}

function connect (service, id, rooms) {
  const frames = []
  const peer = createFakePeer(id, frames, rooms)
  service.peers.set(peer.connection, peer)
  peer.frames = frames
  peer.inRoom = (roomKey) => frames.filter((frame) => frame.room === wireRoom(roomKey))
  peer.gifts = () => frames.filter((frame) => frame.type === 'room-chain')
  return peer
}

const roomOf = (service, roomKey) => service.listRooms().find((room) => room.roomKey === roomKey)

async function shown (service, roomKey) {
  const snapshot = await service.getSnapshot({ roomKey, version: -1 })
  return (snapshot.messages || []).filter((message) => !message.system)
}

test('a room made here rotates, and rooms from before stay as they were', async (t) => {
  const { service, mine } = await setUp(t)
  assert.equal(roomRotates(mine), true)
  assert.equal(roomOf(service, mine).rotates, true)
  assert.equal(roomOf(service, OLD).rotates, false)
  assert.equal(roomOf(service, THEIRS).rotates, false, 'no chain here yet')
  assert.equal(service.rooms.get(mine).chain.first, hourOf())

  // A direct message opened here too.
  const direct = await service.createDirectMessage({ peerId: 'dd00dd00', username: 'Dee' })
  assert.equal(roomRotates(direct.room.roomKey), true)
  assert.equal(direct.room.rotates, true)
})

test('somebody in a new room is handed the current hour ahead of the history, and nothing for an older room', async (t) => {
  const { service, mine } = await setUp(t)
  const peer = connect(service, 'aa00aa00', [mine, OLD])
  service.shareRoom(peer, mine)
  service.shareRoom(peer, OLD)

  const gifts = peer.gifts()
  assert.deepEqual(gifts.map((gift) => gift.room), [wireRoom(mine)])
  assert.equal(gifts[0].e, hourOf())
  assert.equal(gifts[0].secret, chainSecretAt(service.rooms.get(mine).chain, gifts[0].e))
  // The room key itself never goes over the wire.
  assert.equal('roomKey' in gifts[0], false)
  const order = peer.inRoom(mine).map((frame) => frame.type)
  assert.ok(order.indexOf('room-chain') > order.indexOf('room-meta'))
  assert.ok(order.indexOf('room-chain') < order.indexOf('join'))

  // Somebody removed gets nothing more, including a later hour.
  await service.removeRoomMember({ roomKey: mine, peerId: 'aa00aa00' })
  service.broadcastRoomChain(mine)
  assert.equal(peer.gifts().length, 1)
})

test('a new room\'s messages are sealed with the hour\'s key, and an old room\'s with its room key', async (t) => {
  const { service, mine } = await setUp(t)
  const peer = connect(service, 'aa00aa00', [mine, OLD])

  const sent = await service.sendMessage({ roomKey: mine, message: 'sealed by the hour' })
  assert.equal(sent.message, 'sealed by the hour')
  const frame = peer.inRoom(mine).find((candidate) => candidate.ct)
  assert.equal(frame.e, hourOf())
  assert.equal(textOf(frame, mine, messageKeyAt(service.rooms.get(mine).chain, frame.e)), 'sealed by the hour')
  assert.throws(() => decryptPeerChatMessage(frame, mine))

  await service.sendMessage({ roomKey: OLD, message: 'as it always was' })
  const oldFrame = peer.inRoom(OLD).find((candidate) => candidate.ct)
  assert.equal(oldFrame.e, undefined)
  assert.equal(textOf(oldFrame, OLD), 'as it always was')
  assert.deepEqual((await shown(service, OLD)).map((message) => message.message), ['as it always was'])
  assert.deepEqual((await shown(service, mine)).map((message) => message.message), ['sealed by the hour'])
})

test('an older room never takes a chain, whoever offers one', async (t) => {
  const { service } = await setUp(t)
  const peer = connect(service, 'aa00aa00', [OLD])
  await service.handlePeerMessage(peer, { type: 'room-chain', roomKey: OLD, e: hourOf(), secret: '44'.repeat(32) })
  assert.equal(roomOf(service, OLD).rotates, false)
  assert.equal(service.roomChainFor(OLD), null)
})

test('a room made elsewhere takes the current key once, passes it on, and reads from that hour on only', async (t) => {
  const { service } = await setUp(t)
  const hour = hourOf()
  // Their chain, from an hour before now, so there is something older to hide.
  const theirChain = { first: hour - 1, secret: randomBytes(32).toString('hex') }
  const relay = connect(service, 'aa00aa00', [THEIRS])
  const other = connect(service, 'cc00cc00', [THEIRS])

  await service.handlePeerMessage(relay, { type: 'room-chain', roomKey: THEIRS, e: hour, secret: chainSecretAt(theirChain, hour) })
  assert.deepEqual(service.rooms.get(THEIRS).chain, { first: hour, secret: chainSecretAt(theirChain, hour) })
  assert.equal(roomOf(service, THEIRS).rotates, true)
  // On to the rest of the room, and not back to whoever gave it.
  assert.equal(other.gifts().length, 1)
  assert.equal(relay.gifts().length, 0)
  // Another one is not taken.
  await service.handlePeerMessage(other, { type: 'room-chain', roomKey: THEIRS, e: hour, secret: '22'.repeat(32) })
  assert.equal(service.rooms.get(THEIRS).chain.secret, chainSecretAt(theirChain, hour))

  // A message from this hour, one from the hour before, and one from a build
  // without chains, sealed with the room key.
  const sealed = (text, hourKey) => encryptPeerChatMessage(encodeMessagePayload(text), THEIRS, hourKey)
  await service.handlePeerMessage(relay, { id: 'theirs-1', roomKey: THEIRS, sn: 'Pat', ts: Date.now(), e: hour, ...sealed('this hour', messageKeyAt(theirChain, hour)) })
  await service.handlePeerMessage(relay, { type: 'sync', id: 'theirs-2', roomKey: THEIRS, sender: 'a2a2a2a2', sn: 'Pat', ts: Date.now(), e: hour - 1, ...sealed('an hour ago', messageKeyAt(theirChain, hour - 1)) })
  await service.handlePeerMessage(relay, { id: 'theirs-3', roomKey: THEIRS, sn: 'Pat', ts: Date.now(), ...sealed('from an older build') })
  await service.handlePeerMessage(relay, { id: 'theirs-4', roomKey: THEIRS, sn: 'Pat', ts: Date.now(), e: 'soon', ...sealed('a bad hour', messageKeyAt(theirChain, hour)) })
  assert.deepEqual((await shown(service, THEIRS)).map((message) => message.message).sort(), ['from an older build', 'this hour'])

  // What this phone writes there now is sealed by the hour too.
  await service.sendMessage({ roomKey: THEIRS, message: 'mine, sealed' })
  const frame = other.inRoom(THEIRS).find((candidate) => candidate.ct)
  assert.equal(textOf(frame, THEIRS, messageKeyAt(theirChain, frame.e)), 'mine, sealed')
})

test('a phone without the key yet writes with the room key, which everyone can still read', async (t) => {
  const { service } = await setUp(t)
  const peer = connect(service, 'aa00aa00', [THEIRS])
  await service.sendMessage({ roomKey: THEIRS, message: 'before the key came' })
  const frame = peer.inRoom(THEIRS).find((candidate) => candidate.ct)
  assert.equal(frame.e, undefined)
  assert.equal(textOf(frame, THEIRS), 'before the key came')
})

test('a file in a new room carries a key of its own, and a file in an old room never does', async (t) => {
  const { service, mine } = await setUp(t)
  assert.equal(service.filesHaveOwnKeys(mine), true)
  assert.equal(service.filesHaveOwnKeys(OLD), false)
  assert.equal(service.filesHaveOwnKeys(THEIRS), false)

  const fileKey = '55'.repeat(32)
  const file = { message: `hyper://${'a'.repeat(52)}/1-00.bin`, fileName: 'photo.png', fileSize: 10, fileEnc: true, fileKey }
  assert.equal((await service.sendMessage({ roomKey: mine, ...file })).fileKey, fileKey)
  assert.equal((await shown(service, mine)).find((message) => message.fileName === 'photo.png').fileKey, fileKey)

  assert.equal((await service.sendMessage({ roomKey: OLD, ...file })).fileKey, undefined)
  assert.equal((await shown(service, OLD)).find((message) => message.fileName === 'photo.png').fileKey, undefined)
})

test('a file\'s own key comes through from somebody else, and stays with the message', async (t) => {
  const { service } = await setUp(t)
  const hour = hourOf()
  const theirChain = { first: hour, secret: randomBytes(32).toString('hex') }
  const peer = connect(service, 'aa00aa00', [THEIRS])
  await service.handlePeerMessage(peer, { type: 'room-chain', roomKey: THEIRS, e: hour, secret: theirChain.secret })
  const fileKey = '66'.repeat(32)
  const url = `hyper://${'b'.repeat(52)}/2-00.bin`
  await service.handlePeerMessage(peer, {
    id: 'their-file',
    roomKey: THEIRS,
    sn: 'Pat',
    ts: Date.now(),
    e: hour,
    fileName: 'clip.mp4',
    fileSize: 20,
    fileEnc: true,
    ...encryptPeerChatMessage(encodeMessagePayload(url, null, fileKey), THEIRS, messageKeyAt(theirChain, hour))
  })
  const file = (await shown(service, THEIRS)).find((message) => message.fileName === 'clip.mp4')
  assert.equal(file.fileKey, fileKey)
  assert.equal(file.message, url)
})

test('the chain is kept through a restart', async (t) => {
  const { service, storagePath, mine } = await setUp(t)
  const chain = service.rooms.get(mine).chain
  service.persistNow()
  await service.close()
  const restarted = await startService(t, storagePath)
  assert.deepEqual(restarted.rooms.get(mine).chain, chain)
  assert.equal(restarted.roomChainFor(OLD), null)
  assert.deepEqual((await shown(restarted, mine)), [])
})

test('the person\'s other devices get the chain, and keep the earliest start of the same one', async (t) => {
  const { service, mine } = await setUp(t)
  const chain = service.rooms.get(mine).chain
  assert.deepEqual(service.sharedRoomEntry(service.rooms.get(mine)).chain, chain)
  assert.equal(service.sharedRoomEntry(service.rooms.get(OLD)).chain, undefined)

  const shared = normalizeSharedRooms([
    { roomKey: MARKED, name: 'Theirs', chain: CHAIN },
    { roomKey: OLD, name: 'Old room' },
    { roomKey: 'b4'.repeat(32), name: 'Broken', chain: { first: -1, secret: 'zz' } }
  ])
  assert.deepEqual(shared[0].chain, CHAIN)
  assert.equal(shared[1].chain, undefined)
  assert.equal(shared[2].chain, undefined)

  // This phone took THEIRS at a later hour. The person's other device was in
  // it earlier, on the same chain, and this phone takes that start.
  const hour = hourOf()
  const earlier = { first: hour - 3, secret: randomBytes(32).toString('hex') }
  service.rooms.get(THEIRS).chain = { first: hour, secret: chainSecretAt(earlier, hour) }
  await service.takeSiblingRooms([{ roomKey: THEIRS, name: 'Theirs', chain: earlier }])
  assert.deepEqual(service.rooms.get(THEIRS).chain, earlier)
  // A different chain claiming to start earlier is not.
  await service.takeSiblingRooms([{ roomKey: THEIRS, name: 'Theirs', chain: { first: hour - 9, secret: '77'.repeat(32) } }])
  assert.deepEqual(service.rooms.get(THEIRS).chain, earlier)
})

test('a file in a room whose keys rotate is sealed with its own key, and opens only with it', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-file-key-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pickerDirectory = path.join(root, 'cache', 'documentpicker')
  await mkdir(pickerDirectory, { recursive: true })
  const sourcePath = path.join(pickerDirectory, 'photo.png')
  const plaintext = Buffer.from('a picture in a room whose keys rotate')
  await writeFile(sourcePath, plaintext)
  const runtime = { async getDrive () { return drive } }
  const stored = new Map()
  const drive = {
    id: 'c'.repeat(52),
    createWriteStream (pathname) {
      const chunks = []
      return new Writable({
        write (chunk, encoding, callback) {
          chunks.push(Buffer.from(chunk))
          callback()
        },
        final (callback) {
          stored.set(pathname, Buffer.concat(chunks))
          callback()
        }
      })
    },
    createReadStream (pathname) {
      return Readable.from([stored.get(pathname)])
    },
    async entry (pathname) {
      const bytes = stored.get(pathname)
      return bytes ? { value: { blob: { byteLength: bytes.byteLength } } } : null
    }
  }
  const pick = { roomKey: MARKED, fileUri: pathToFileURL(sourcePath).toString(), byteLength: plaintext.byteLength }
  const open = (extra) => openPeerChatAttachment({
    roomKey: MARKED,
    url: uploaded.item.url,
    fileName: 'photo.png',
    fileSize: plaintext.byteLength,
    encrypted: true,
    ...extra
  }, { runtime, storagePath: path.join(root, String(Math.random())) })

  const uploaded = await uploadPeerChatAttachment({ ...pick, ownKey: true }, { runtime })
  assert.equal(uploaded.ok, true)
  assert.match(uploaded.item.fileKey, /^[0-9a-f]{64}$/)
  const opened = await open({ fileKey: uploaded.item.fileKey })
  assert.equal(opened.ok, true)
  assert.deepEqual(await readFile(new URL(opened.localUri)), plaintext)
  // The room key alone does not open it.
  assert.equal((await open({})).ok, false)
  assert.equal((await open({ fileKey: 'not a key' })).ok, false)

  // Anywhere else, the room key seals it, as before.
  const plain = await uploadPeerChatAttachment(pick, { runtime })
  assert.equal(plain.item.fileKey, undefined)
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

function createFakePeer (id, frames, rooms) {
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
    rooms: [...rooms],
    initialSyncCount: 0,
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
