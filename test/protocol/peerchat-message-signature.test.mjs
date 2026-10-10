import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import crypto from 'hypercore-crypto'

import { PeerChatService } from '../../backend/peerchat/service.mjs'
import {
  decryptPeerChatMessage,
  derivePeerChatTopic,
  encryptPeerChatMessage
} from '../../backend/peerchat/protocol.mjs'
import { decodeMessagePayload, encodeMessagePayload } from '../../backend/peerchat/link-preview.mjs'
import { messageKeyAt } from '../../backend/peerchat/key-chain.mjs'
import {
  messageHeader,
  readSignedMessage,
  readSignedReaction,
  signMessage,
  signReaction
} from '../../backend/peerchat/message-signature.mjs'

// Every message and reaction is signed by whoever wrote it, so it can come
// through anyone, in history or passed on from device to device, and still
// prove its author. Somebody else's history used to name any author it liked.

const wireRoom = (roomKey) => derivePeerChatTopic(roomKey).toString('hex')

// The same vector is in peerchat's test/message-signature.test.js. If either
// app changes a byte of what is signed, both of these fail.
const AUTHOR = crypto.keyPair(Buffer.alloc(32, 1))
const TOPIC = '2a1988aeeff0404ef0edef440f2f2e7864f15ff8543b9f7693b69db182bbf653'
const SEALED = { ct: 'c0ffee', iv: '00112233445566778899aabb', tag: '0123456789abcdef0123456789abcdef' }
const MESSAGE_SIGNATURE = '162e3146af18d3b84344d3b3fa260fa503c930fe6c8ef86e925817de766bb32d' +
  '54216601a0410c39c96b69c21a9082e611b3da46fb9b606827dd8c1adf2ce90c'
const REACTION_SIGNATURE = 'dcc5a8910e03054aeaecd8c212fce9f4d3bdd404f55cb81a1119ec344d5657ae' +
  'b8338629ffaf74592b76cf0978439e5b9ec0d99a7a4c3596aa0671c4e6d62701'

test('a message and a reaction are signed over the same bytes as on the desktop', () => {
  const message = signMessage({ topic: TOPIC, id: 'm1', ts: 1790000000000, e: 497659, sn: 'Ada', fwd: false }, SEALED, AUTHOR)
  assert.equal(message.ak, '8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c')
  assert.equal(message.h, `{"v":1,"room":"${TOPIC}","id":"m1","ts":1790000000000,"e":497659,"sn":"Ada"}`)
  assert.equal(message.as, MESSAGE_SIGNATURE)

  const reaction = signReaction({ topic: TOPIC, id: 'r1', ts: 1790000000001, msgId: 'm1', emoji: '\u{1F525}', sn: 'Ada' }, AUTHOR)
  assert.equal(reaction.h, `{"v":1,"room":"${TOPIC}","id":"r1","ts":1790000000001,"msgId":"m1","emoji":"\u{1F525}","sn":"Ada"}`)
  assert.equal(reaction.as, REACTION_SIGNATURE)

  // In a room made before keys rotated, the reply and file details sit next
  // to the body, so the header carries them and the signature covers them.
  assert.equal(messageHeader({
    topic: TOPIC,
    id: 'm2',
    ts: 1790000000002,
    sn: 'Ada',
    replyTo: { id: 'm1', sender: '8a88e3dd', sn: 'Ada', text: 'hi' },
    fileName: 'a.png',
    fileSize: 3,
    fileEnc: true,
    fwd: true
  }), `{"v":1,"room":"${TOPIC}","id":"m2","ts":1790000000002,"sn":"Ada",` +
    '"replyTo":{"id":"m1","sender":"8a88e3dd","sn":"Ada","text":"hi"},"fileName":"a.png","fileSize":3,"fileEnc":true,"fwd":true}')
})

test('a signature that does not fit what arrived counts for nothing', () => {
  const signed = signMessage({ topic: TOPIC, id: 'm1', ts: 1790000000000, e: 497659, sn: 'Ada' }, SEALED, AUTHOR)
  const frame = { id: 'm1', e: 497659, ...SEALED, ...signed }
  assert.equal(readSignedMessage(frame, TOPIC).authorId, '8a88e3dd')
  assert.equal(readSignedMessage(frame, TOPIC).header.sn, 'Ada')

  assert.equal(readSignedMessage({ ...frame, ct: 'c0ffef' }, TOPIC), false)
  assert.equal(readSignedMessage({ ...frame, h: frame.h.replace('Ada', 'Eve') }, TOPIC), false)
  assert.equal(readSignedMessage({ ...frame, id: 'm9' }, TOPIC), false)
  assert.equal(readSignedMessage({ ...frame, e: 497660 }, TOPIC), false)
  assert.equal(readSignedMessage(frame, wireRoom('cd'.repeat(32))), false)
  assert.equal(readSignedMessage({ ...frame, ak: crypto.keyPair().publicKey.toString('hex') }, TOPIC), false)
  assert.equal(readSignedMessage({ ...frame, as: 'nope' }, TOPIC), false)
  // Nothing signed at all is what an older build sends.
  assert.equal(readSignedMessage({ id: 'm1', ...SEALED }, TOPIC), null)

  const reaction = { id: 'r1', ...signReaction({ topic: TOPIC, id: 'r1', ts: 1, msgId: 'm1', emoji: 'x', sn: 'Ada' }, AUTHOR) }
  assert.equal(readSignedReaction(reaction, TOPIC).header.emoji, 'x')
  assert.equal(readSignedReaction({ ...reaction, h: reaction.h.replace('"x"', '"y"') }, TOPIC), false)
  assert.equal(readSignedReaction({ id: 'r1', msgId: 'm1', emoji: 'x' }, TOPIC), null)
})

// Over the service. OLD was made before keys rotated; the phone joined it.
const OLD = 'a1'.repeat(32)
const PHONE = crypto.keyPair(Buffer.alloc(32, 5))
const WRITER = crypto.keyPair(Buffer.alloc(32, 6))
const OTHER_WRITER = crypto.keyPair(Buffer.alloc(32, 8))
const keyHex = (pair) => pair.publicKey.toString('hex')
const idOf = (pair) => keyHex(pair).slice(0, 8)

async function startService (t) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-signed-messages-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => service.close())
  await service.loadSigningKeys()
  service.setProfile({ username: 'Ada', bio: '' })
  await service.joinRoom({ roomKey: OLD })
  service.rooms.get(OLD).joinedAt = Date.now() - 60_000
  return service
}

function connect (service, idOrPair, { rooms = [OLD], passes = true } = {}) {
  const frames = []
  const key = typeof idOrPair === 'string' ? idOrPair.repeat(8) : keyHex(idOrPair)
  const peer = createFakePeer(key, frames, rooms)
  peer.passes = passes
  service.peers.set(peer.connection, peer)
  peer.frames = frames
  peer.passed = () => frames.filter((frame) => frame.type === 'pass')
  return peer
}

// A message as its author writes and signs it, ready to arrive any way.
function written (pair, roomKey, text, { id = `m-${Math.random().toString(16).slice(2)}`, ts = Date.now(), e, hourKey, sn = 'Writer' } = {}) {
  const sealed = encryptPeerChatMessage(text, roomKey, hourKey)
  return {
    id,
    sender: idOf(pair),
    sn,
    ...sealed,
    ...(e !== undefined && { e }),
    ts,
    ...signMessage({ topic: wireRoom(roomKey), id, ts, e, sn }, sealed, pair)
  }
}

async function shown (service, roomKey) {
  const snapshot = await service.getSnapshot({ roomKey, version: -1 })
  return (snapshot.messages || []).filter((message) => !message.system)
}

const noticesIn = async (service, roomKey) => {
  const snapshot = await service.getSnapshot({ roomKey, version: -1 })
  return (snapshot.messages || []).filter((message) => message.system).map((message) => message.message)
}

test('what the phone writes is signed, and an old room keeps its reply and file details next to the body', async (t) => {
  const service = await startService(t)
  const watcher = connect(service, 'cc00cc00')
  const replyTo = { id: 'earlier', sender: 'aa00aa00', sn: 'Pat', text: 'see you there' }
  await service.sendMessage({ roomKey: OLD, message: 'on my way', replyTo })
  await service.sendMessage({ roomKey: OLD, message: `hyper://${'a'.repeat(52)}/1-00.bin`, fileName: 'map.png', fileSize: 12, fileEnc: true })

  const [reply, file] = watcher.frames.filter((frame) => frame.ct)
  const signedReply = readSignedMessage(reply, wireRoom(OLD))
  assert.equal(signedReply.authorId, idOf(PHONE))
  assert.deepEqual(signedReply.header.replyTo, replyTo)
  // An older build reads these from next to the body, as before.
  assert.deepEqual(reply.replyTo, replyTo)
  assert.equal(file.fileName, 'map.png')
  assert.equal(readSignedMessage(file, wireRoom(OLD)).header.fileName, 'map.png')
  assert.equal(decryptPeerChatMessage(reply, OLD), 'on my way')
})

test('a room whose keys rotate keeps the reply and the file details inside the sealed body', async (t) => {
  const service = await startService(t)
  const room = await service.createRoom({ name: 'New room', username: 'Ada' })
  const watcher = connect(service, 'cc00cc00', { rooms: [room.roomKey] })
  const replyTo = { id: 'earlier', sender: 'aa00aa00', sn: 'Pat', text: 'the secret plan' }
  const sentReply = await service.sendMessage({ roomKey: room.roomKey, message: 'agreed', replyTo })
  const sentFile = await service.sendMessage({
    roomKey: room.roomKey,
    message: `hyper://${'a'.repeat(52)}/1-00.bin`,
    fileName: 'plan.pdf',
    fileSize: 34,
    fileEnc: true,
    fileKey: '55'.repeat(32)
  })

  const [reply, file] = watcher.frames.filter((frame) => frame.ct)
  for (const frame of [reply, file]) {
    assert.equal(frame.replyTo, undefined)
    assert.equal(frame.fileName, undefined)
    assert.equal(frame.fileSize, undefined)
    assert.ok(readSignedMessage(frame, wireRoom(room.roomKey)))
    assert.ok(!frame.h.includes('secret plan') && !frame.h.includes('plan.pdf'))
  }
  const hourKey = messageKeyAt(service.rooms.get(room.roomKey).chain, reply.e)
  assert.deepEqual(decodeMessagePayload(decryptPeerChatMessage(reply, room.roomKey, hourKey)).replyTo, replyTo)
  assert.equal(decodeMessagePayload(decryptPeerChatMessage(file, room.roomKey, hourKey)).fileName, 'plan.pdf')

  // And the screen still gets them.
  assert.deepEqual(sentReply.replyTo, replyTo)
  assert.equal(sentFile.fileName, 'plan.pdf')
  assert.equal(sentFile.fileSize, 34)
  const listed = await shown(service, room.roomKey)
  assert.deepEqual(listed.find((message) => message.message === 'agreed').replyTo, replyTo)
  assert.equal(listed.find((message) => message.fileName).fileName, 'plan.pdf')
})

test('somebody else\'s history counts only when its author signed it', async (t) => {
  const service = await startService(t)
  const relay = connect(service, 'aa00aa00')
  relay.initialSyncCount = 0

  // Unsigned, naming somebody else: the hole this closes.
  await service.handlePeerMessage(relay, {
    type: 'sync',
    id: 'forged',
    roomKey: OLD,
    sender: idOf(WRITER),
    sn: 'Writer',
    ...encryptPeerChatMessage('I never said this', OLD),
    ts: Date.now()
  })
  // Signed by its author, carried by the relay.
  await service.handlePeerMessage(relay, { ...written(WRITER, OLD, 'I did say this', { id: 'real' }), type: 'sync', roomKey: OLD })
  // Signed, then changed on the way.
  const changed = written(WRITER, OLD, 'about to be changed', { id: 'changed' })
  await service.handlePeerMessage(relay, { ...changed, h: changed.h.replace('Writer', 'Someone'), type: 'sync', roomKey: OLD })
  // The relay's own history, unsigned, as an older build sends it.
  await service.handlePeerMessage(relay, {
    type: 'sync',
    id: 'relay-own',
    roomKey: OLD,
    sender: 'aa00aa00',
    sn: 'Relay',
    ...encryptPeerChatMessage('from an older build', OLD),
    ts: Date.now()
  })

  const listed = await shown(service, OLD)
  assert.deepEqual(listed.map((message) => message.message).sort(), ['I did say this', 'from an older build'])
  const real = listed.find((message) => message.id === 'real')
  assert.equal(real.sender, idOf(WRITER))
  assert.equal(real.senderName, 'Writer')
})

test('a message straight from a connection has to be signed by that connection', async (t) => {
  const service = await startService(t)
  const relay = connect(service, 'aa00aa00')
  // Somebody else's signed message, sent as if it were the relay's own.
  await service.handlePeerMessage(relay, { ...written(WRITER, OLD, 'not yours to send', { id: 'borrowed' }), roomKey: OLD })
  // The relay's own, unsigned, as an older build sends it.
  await service.handlePeerMessage(relay, { id: 'own', roomKey: OLD, sn: 'Relay', ...encryptPeerChatMessage('mine', OLD), ts: Date.now() })
  assert.deepEqual((await shown(service, OLD)).map((message) => [message.message, message.sender]), [['mine', 'aa00aa00']])
})

test('a key ground to match somebody\'s id cannot sign as them', async (t) => {
  const service = await startService(t)
  const relay = connect(service, 'aa00aa00')
  relay.initialSyncCount = 0
  // The real owner of WRITER's id proved a different key on a connection.
  service.rememberProvenKey(idOf(WRITER), 'ee'.repeat(32))
  await service.handlePeerMessage(relay, { ...written(WRITER, OLD, 'pretending', { id: 'ground' }), type: 'sync', roomKey: OLD })
  // And nobody signs as this phone but this phone.
  const phoneId = service.localId
  assert.equal(service.authorKeyConflicts(phoneId, keyHex(WRITER)), true)
  assert.equal(service.authorKeyConflicts(phoneId, service.localKey), false)
  assert.deepEqual(await shown(service, OLD), [])
})

test('a signed message passed on is taken as its author\'s and goes on once to the rest of the room', async (t) => {
  const service = await startService(t)
  const relay = connect(service, 'aa00aa00')
  const other = connect(service, 'bb00bb00')
  const older = connect(service, 'cc00cc00', { passes: false })
  const writer = connect(service, WRITER)

  const message = written(WRITER, OLD, 'passed along', { id: 'passed' })
  await service.handlePeerMessage(relay, { type: 'pass', roomKey: OLD, m: message })
  await service.handlePeerMessage(other, { type: 'pass', roomKey: OLD, m: message })

  const listed = await shown(service, OLD)
  assert.deepEqual(listed.map((item) => [item.message, item.sender, item.senderName]), [['passed along', idOf(WRITER), 'Writer']])
  // On once, to whoever takes it and does not have it: not back to the relay,
  // not to its author, not to an older build. The second copy went nowhere.
  assert.equal(other.passed().length, 1)
  assert.equal(other.passed()[0].m.as, message.as)
  assert.equal(relay.passed().length, 0)
  assert.equal(writer.passed().length, 0)
  assert.equal(older.passed().length, 0)
})

test('a message straight from its author goes on to the others who pass messages on', async (t) => {
  const service = await startService(t)
  const writer = connect(service, WRITER)
  const relay = connect(service, 'aa00aa00')
  const older = connect(service, 'cc00cc00', { passes: false })
  await service.handlePeerMessage(writer, { ...written(WRITER, OLD, 'hello room', { id: 'direct' }), roomKey: OLD })
  assert.equal(relay.passed().length, 1)
  assert.equal(writer.passed().length, 0)
  assert.equal(older.passed().length, 0)
  // An unsigned one, from an older build, is not passed on: nobody could
  // check who wrote it.
  const oldBuild = connect(service, 'dd00dd00', { passes: false })
  await service.handlePeerMessage(oldBuild, { id: 'old-build', roomKey: OLD, sn: 'Olly', ...encryptPeerChatMessage('from an older build', OLD), ts: Date.now() })
  assert.equal(relay.passed().length, 1)
  assert.deepEqual((await shown(service, OLD)).map((message) => message.message).sort(), ['from an older build', 'hello room'])
})

test('nothing unsigned, stale, from before joining, or from someone removed is taken passed on', async (t) => {
  const service = await startService(t)
  const relay = connect(service, 'aa00aa00')
  const room = service.rooms.get(OLD)

  await service.handlePeerMessage(relay, {
    type: 'pass',
    roomKey: OLD,
    m: { id: 'unsigned', sender: idOf(WRITER), sn: 'Writer', ...encryptPeerChatMessage('unsigned', OLD), ts: Date.now() }
  })
  await service.handlePeerMessage(relay, { type: 'pass', roomKey: OLD, m: written(WRITER, OLD, 'stale', { ts: Date.now() - 11 * 60_000 }) })
  await service.handlePeerMessage(relay, { type: 'pass', roomKey: OLD, m: written(WRITER, OLD, 'before I joined', { ts: room.joinedAt - 1000 }) })
  room.bans = [{ id: idOf(OTHER_WRITER), key: keyHex(OTHER_WRITER), at: Date.now(), name: 'Gone' }]
  await service.handlePeerMessage(relay, { type: 'pass', roomKey: OLD, m: written(OTHER_WRITER, OLD, 'removed') })
  await service.handlePeerMessage(relay, { type: 'pass', roomKey: OLD, m: written(WRITER, OLD, 'this one counts') })

  assert.deepEqual((await shown(service, OLD)).map((message) => message.message), ['this one counts'])
})

test('each person has their own limit, whichever way their messages come, and nobody is blamed for passing them on', async (t) => {
  const service = await startService(t)
  const relay = connect(service, 'aa00aa00')
  // Twelve in a burst from one writer, through the relay: the room's spam
  // limit is ten in ten seconds, counted against the writer.
  for (let index = 0; index < 12; index += 1) {
    await service.handlePeerMessage(relay, { type: 'pass', roomKey: OLD, m: written(WRITER, OLD, `burst ${index}`, { ts: Date.now() + index }) })
  }
  await service.handlePeerMessage(relay, { type: 'pass', roomKey: OLD, m: written(OTHER_WRITER, OLD, 'somebody else', { sn: 'Other' }) })
  // And the relay's own message straight from it.
  await service.handlePeerMessage(relay, { id: 'relay-live', roomKey: OLD, sn: 'Relay', ...encryptPeerChatMessage('relay talking', OLD), ts: Date.now() })

  const notices = await noticesIn(service, OLD)
  assert.ok(notices.length >= 1 && notices.every((notice) => notice.includes('Writer') && !notice.includes('aa00aa00')), notices.join(' | '))
  const texts = (await shown(service, OLD)).map((message) => message.message)
  assert.ok(texts.includes('somebody else') && texts.includes('relay talking'))
  assert.equal(service.moderator.isKicked('aa00aa00', OLD), false)

  // Past the room's limit sits each person's own budget per minute.
  for (let index = 0; index < 120; index += 1) assert.equal(service.consumeAuthorRate(OLD, 'f00df00d'), true)
  assert.equal(service.consumeAuthorRate(OLD, 'f00df00d'), false)
  assert.equal(service.consumeAuthorRate(OLD, 'beefbeef'), true)
})

test('the handshake says the phone passes messages on, and takes it from a peer that says so', async (t) => {
  const service = await startService(t)
  const peer = connect(service, 'aa00aa00', { passes: false })
  service.shareTopics(peer)
  assert.equal(peer.frames.find((frame) => frame.type === 'topics').pass, true)
  await service.handlePeerMessage(peer, { type: 'topics', rooms: [], pass: true })
  assert.equal(peer.passes, true)
})

test('a reaction is signed and passed on like a message', async (t) => {
  const service = await startService(t)
  const sent = await service.sendMessage({ roomKey: OLD, message: 'react to this' })
  const relay = connect(service, 'aa00aa00')
  relay.initialSyncCount = 0
  const other = connect(service, 'bb00bb00')
  const own = await service.reactToMessage({ roomKey: OLD, msgId: sent.id, emoji: '\u{1F44D}' })
  assert.equal(readSignedReaction(own, wireRoom(OLD)).authorId, service.localId)

  const id = 'their-reaction'
  const ts = Date.now()
  const reaction = {
    type: 'reaction',
    id,
    msgId: sent.id,
    emoji: '\u{1F525}',
    sender: idOf(WRITER),
    sn: 'Writer',
    ts,
    ...signReaction({ topic: wireRoom(OLD), id, ts, msgId: sent.id, emoji: '\u{1F525}', sn: 'Writer' }, WRITER)
  }
  await service.handlePeerMessage(relay, { type: 'pass', roomKey: OLD, m: reaction })
  assert.equal(other.passed().filter((frame) => frame.m.type === 'reaction').length, 1)
  // Unsigned, naming somebody else, in history: not counted.
  await service.handlePeerMessage(relay, {
    type: 'sync-reaction',
    id: 'forged-reaction',
    roomKey: OLD,
    msgId: sent.id,
    emoji: '\u{1F4A9}',
    sender: idOf(OTHER_WRITER),
    sn: 'Other',
    ts
  })
  const [listed] = await shown(service, OLD)
  assert.deepEqual(listed.reactions.map((summary) => summary.emoji).sort(), ['\u{1F44D}', '\u{1F525}'].sort())
})

test('a received message keeps its signature, so it can go on in history and still check out', async (t) => {
  const service = await startService(t)
  const relay = connect(service, 'aa00aa00')
  await service.handlePeerMessage(relay, { type: 'pass', roomKey: OLD, m: written(WRITER, OLD, 'kept as it came', { id: 'kept' }) })
  const entries = service.feeds.get(OLD).entries.filter((entry) => entry.ct)
  assert.equal(entries.length, 1)
  assert.ok(readSignedMessage(entries[0], wireRoom(OLD)))
  assert.equal(entries[0].sender, idOf(WRITER))
  // A preview the room's filters hold back stays in the body and is left out
  // when it is read, instead of the body being sealed again.
  const sealed = encryptPeerChatMessage(encodeMessagePayload('a link', { url: 'https://pornhub.com/', title: 'x' }), OLD)
  const id = 'with-preview'
  const ts = Date.now()
  await service.handlePeerMessage(relay, {
    type: 'pass',
    roomKey: OLD,
    m: { id, sender: idOf(WRITER), sn: 'Writer', ...sealed, ts, ...signMessage({ topic: wireRoom(OLD), id, ts, sn: 'Writer' }, sealed, WRITER) }
  })
  const withPreview = (await shown(service, OLD)).find((message) => message.id === id)
  assert.equal(withPreview?.preview, undefined)
  assert.equal(service.feeds.get(OLD).entries.find((entry) => entry.id === id).ct, sealed.ct)
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

function createFakePeer (key, frames, rooms) {
  return {
    active: true,
    connection: { destroyed: false, handshakeHash: Buffer.alloc(64, 9), publicKey: PHONE.publicKey },
    id: key.slice(0, 8),
    key,
    buffer: '',
    pendingMessages: 0,
    processing: Promise.resolve(),
    lastReceivedAt: Date.now(),
    username: key.slice(0, 8),
    bio: '',
    avatar: null,
    rooms: [...rooms],
    initialSyncCount: 0,
    controlRate: { count: 0, resetsAt: Date.now() + 60_000 },
    liveRate: { count: 0, resetsAt: Date.now() + 60_000 },
    passRate: { count: 0, resetsAt: Date.now() + 60_000 },
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
