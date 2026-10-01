// One person on several devices: the phone's label after the name, the
// proof that lets only the person's own devices rename each other, and
// PeerChat carried between a desktop and this phone in a transfer.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { PeerChatService } from '../../backend/peerchat/service.mjs'
import { derivePeerChatTopic } from '../../backend/peerchat/protocol.mjs'
import {
  checkProfileProof,
  createLink,
  displayName,
  linkId,
  makeProfileProof,
  makeTransfer,
  nextLabel,
  normalizeMemberName,
  normalizeTransfer,
  PEERCHAT_INCOMING_FILE
} from '../../backend/peerchat/device-link.mjs'

const ROOM = 'aa'.repeat(32)
const DESKTOP_ROOM = 'cc'.repeat(32)
const DESKTOP_DM = 'dd'.repeat(32)

test('the proof is the same bytes PeerChat on the desktop makes', () => {
  // The same vector is in PeerChat's test/device-link.test.js.
  const link = { key: '0f'.repeat(32), origin: 'desktop', labels: ['mobile', 'desktop1'] }
  const profile = { username: 'ada', bio: 'hi there', avatar: 'data:image/png;base64,AAAA', at: 1750000000000 }
  assert.deepEqual(makeProfileProof(link, profile, '0e'.repeat(32)), {
    id: '148e442780792da6ee08d733108a2207',
    name: 'ada',
    bio: 'hi there',
    at: 1750000000000,
    labels: ['desktop1', 'mobile'],
    mac: 'd2c1d5265a5081255f224d5038103acd07098501a6035733cb243d3ff68e96fe'
  })
  // Made by one device, it is nobody else's.
  const proof = makeProfileProof(link, profile, '0e'.repeat(32))
  assert.equal(checkProfileProof(link, proof, profile.avatar, '0e'.repeat(32)), true)
  assert.equal(checkProfileProof(link, proof, profile.avatar, '0f'.repeat(32)), false)
  assert.equal(checkProfileProof(link, proof, profile.avatar), false)
  assert.equal(makeProfileProof(link, profile), null)
  assert.equal(linkId(link), '148e442780792da6ee08d733108a2207')
})

test('labels: one phone, numbered desktops, fixed after the name', () => {
  assert.equal(displayName('ada', ''), 'ada')
  assert.equal(displayName('ada', 'mobile'), 'ada@mobile')
  assert.equal(displayName('ada', 'not a label'), 'ada')
  assert.equal(displayName('a'.repeat(50), 'desktop2').length, 50)

  const fromPhone = createLink('mobile')
  assert.equal(nextLabel(fromPhone, 'desktop'), 'desktop')
  assert.equal(nextLabel({ ...fromPhone, labels: ['desktop'] }, 'desktop'), 'desktop2')
  assert.equal(nextLabel(createLink('desktop'), 'desktop'), 'desktop1')
  assert.equal(nextLabel(createLink('desktop'), 'mobile'), 'mobile')

  // What others send: a name, or a name and a label, and nothing else.
  assert.equal(normalizeMemberName('ada@desktop1'), 'ada@desktop1')
  assert.equal(normalizeMemberName(' Ada  Lovelace@mobile '), 'Ada Lovelace@mobile')
  assert.equal(normalizeMemberName('ada@evil'), '')
  assert.equal(normalizeMemberName('ada@'), '')
  assert.equal(normalizeMemberName('<b>ada</b>'), '')
})

test('a transfer keeps its rooms and refuses what it does not understand', () => {
  const link = createLink('desktop')
  const good = { version: 1, label: 'mobile', link, profile: { username: 'ada', at: 5 }, rooms: [{ roomKey: ROOM, name: 'Room', joinedAt: 9 }] }
  assert.equal(normalizeTransfer(good).rooms[0].joinedAt, 9)
  assert.equal(normalizeTransfer({ ...good, version: 2 }), null)
  assert.equal(normalizeTransfer({ ...good, label: 'tablet' }), null)
  assert.equal(normalizeTransfer({ ...good, link: { key: 'short' } }), null)
  assert.equal(normalizeTransfer({ ...good, profile: { username: 'ada@mobile' } }).profile, null)
  assert.equal(normalizeTransfer({ ...good, rooms: [{ roomKey: DESKTOP_DM, isDM: true, dmWith: 'nope' }] }).rooms.length, 0)
})

test('a desktop gets the phone\'s name, every room with its key, and a label of its own', async (t) => {
  const { service, storagePath } = await startService(t)
  await service.completeOnboarding({ username: 'ada' })
  const room = await service.createRoom({ name: 'Phone room', username: 'ada' })

  const first = service.exportTransfer({ targetType: 'desktop' })
  assert.equal(first.label, 'desktop')
  assert.equal(first.link.origin, 'mobile')
  assert.equal(first.profile.username, 'ada')
  const sent = first.rooms.find((entry) => entry.roomKey === room.roomKey)
  assert.equal(sent.creatorKey, service.localKey)
  // Each desktop gets its own label, even before the first is heard from.
  const second = service.exportTransfer({ targetType: 'desktop' })
  assert.equal(second.link.key, first.link.key)
  assert.equal(second.label, 'desktop2')

  // The link is kept for the next transfer, and this phone has no label.
  const saved = JSON.parse(await readFile(path.join(storagePath, 'peerchat-mobile.json'), 'utf8'))
  assert.equal(saved.link.key, first.link.key)
  assert.deepEqual(saved.link.labels, ['desktop', 'desktop2'])
  assert.equal(service.getProfile().displayName, 'ada')
  await service.close()
})

test('a desktop\'s PeerChat left by a restore is taken once: its name with @mobile, and its rooms', async (t) => {
  const storagePath = await tempDir(t)
  const incomingPath = path.join(storagePath, PEERCHAT_INCOMING_FILE)
  const link = createLink('desktop')
  await writeFile(incomingPath, JSON.stringify(makeTransfer({
    link,
    label: 'mobile',
    profile: { username: 'ada', bio: 'from the desktop', avatar: null, at: 100 },
    rooms: [
      { roomKey: DESKTOP_ROOM, name: 'Desktop room', createdAt: 10, joinedAt: 20, creatorKey: '09'.repeat(32) },
      { roomKey: DESKTOP_DM, name: 'Ann', isDM: true, dmWith: '0a0b0c0d', createdAt: 30 }
    ]
  })))

  const sdk = createFakeSdk()
  const service = await new PeerChatService({ sdk, storagePath, incomingPath }).start()
  const profile = service.getProfile()
  assert.equal(profile.username, 'ada')
  assert.equal(profile.device, 'mobile')
  assert.equal(profile.displayName, 'ada@mobile')
  assert.equal(profile.bio, 'from the desktop')

  const rooms = service.listRooms()
  const room = rooms.find((entry) => entry.roomKey === DESKTOP_ROOM)
  assert.equal(room.name, 'Desktop room')
  assert.equal(room.isHost, false)
  // Joined as of when the person joined on the desktop, so the history since
  // then comes here too.
  assert.equal(service.rooms.get(DESKTOP_ROOM).joinedAt, 20)
  const dm = rooms.find((entry) => entry.roomKey === DESKTOP_DM)
  assert.equal(dm.isDM, true)
  assert.equal(dm.dmWith, '0a0b0c0d')
  assert.ok(sdk.joined.includes(derivePeerChatTopic(DESKTOP_ROOM).toString('hex')))
  assert.equal(existsSync(incomingPath), false)
  await service.close()

  // Kept across a restart, and the file is not taken twice.
  const restarted = await new PeerChatService({ sdk: createFakeSdk(), storagePath, incomingPath }).start()
  assert.equal(restarted.getProfile().displayName, 'ada@mobile')
  assert.equal(restarted.link.key, link.key)
  await restarted.close()
})

test('sends its name with the label and a proof only the person\'s devices can check', async (t) => {
  const { service, link } = await linkedPhone(t)
  const frames = []
  const peer = createFakePeer('0b0b0b0b', 'ada', frames)
  service.peers.set(peer.connection, peer)

  service.sendProfile(peer)
  const profile = frames.find((frame) => frame.type === 'profile')
  assert.equal(profile.username, 'ada@mobile')
  assert.equal(profile.device, 'mobile')
  assert.equal(checkProfileProof(link, profile.link, profile.avatar, service.localKey), true)
  assert.equal(profile.link.name, 'ada')

  // Everything else it sends carries the label too.
  await service.sendMessage({ roomKey: DESKTOP_ROOM, message: 'hello' })
  assert.equal(frames.find((frame) => frame.type === 'message' || frame.sn)?.sn, 'ada@mobile')
  await service.close()
})

test('takes a rename from the desktop, and from nobody else', async (t) => {
  const { service, link } = await linkedPhone(t)
  const frames = []
  const desktop = createFakePeer('0b0b0b0b', 'ada', frames)
  service.peers.set(desktop.connection, desktop)

  const at = Date.now()
  await service.handlePeerMessage(desktop, {
    type: 'profile',
    username: 'adele',
    bio: 'new bio',
    avatar: null,
    link: makeProfileProof({ ...link, labels: ['mobile', 'desktop1'] }, { username: 'adele', bio: 'new bio', avatar: null, at }, desktop.key)
  })
  const renamed = service.getProfile()
  assert.equal(renamed.username, 'adele')
  assert.equal(renamed.displayName, 'adele@mobile')
  assert.equal(renamed.bio, 'new bio')
  // The label stays, and the labels the desktop knows are kept.
  assert.equal(renamed.device, 'mobile')
  assert.deepEqual(service.link.labels, ['desktop1', 'mobile'])
  // Told on to everyone, with the time it was set.
  const resent = frames.filter((frame) => frame.type === 'profile').pop()
  assert.equal(resent.username, 'adele@mobile')
  assert.equal(resent.link.at, at)

  // Somebody without the link, and an older name from the desktop.
  const stranger = createFakePeer('0c0c0c0c', 'mallory')
  service.peers.set(stranger.connection, stranger)
  await service.handlePeerMessage(stranger, {
    type: 'profile',
    username: 'mallory',
    link: makeProfileProof(createLink('desktop'), { username: 'mallory', at: at + 60_000 }, stranger.key)
  })
  await service.handlePeerMessage(desktop, {
    type: 'profile',
    username: 'ada',
    link: makeProfileProof(link, { username: 'ada', at: at - 1 }, desktop.key)
  })
  assert.equal(service.getProfile().username, 'adele')
  await service.close()
})

test('a name the person\'s own desktop has is not taken', async (t) => {
  const { service, link } = await linkedPhone(t)
  const desktop = createFakePeer('0b0b0b0b', 'ada')
  service.peers.set(desktop.connection, desktop)
  // The desktop was renamed while this phone was away, and this phone set
  // its own name before it heard.
  service.profile.at = Date.now() + 60_000
  await service.handlePeerMessage(desktop, {
    type: 'profile',
    username: 'adele',
    link: makeProfileProof(link, { username: 'adele', at: Date.now() }, desktop.key)
  })
  assert.equal(desktop.username, 'adele')
  assert.equal(service.setProfile({ username: 'adele' }).username, 'adele')

  const stranger = createFakePeer('0c0c0c0c', 'grace')
  service.peers.set(stranger.connection, stranger)
  assert.throws(() => service.setProfile({ username: 'grace' }), /already taken/)
  await service.close()
})

test('the person\'s other device gets the room\'s history since the person joined', async (t) => {
  const { service, link } = await linkedPhone(t)
  const desktop = createFakePeer('0b0b0b0b', 'ada')
  const stranger = createFakePeer('0c0c0c0c', 'grace')
  service.peers.set(desktop.connection, desktop)
  service.peers.set(stranger.connection, stranger)
  await service.handlePeerMessage(desktop, { type: 'profile', username: 'ada@desktop1', link: makeProfileProof(link, { username: 'ada', at: 100 }, desktop.key) })
  // Both first seen now, and history already sent from then.
  const now = Date.now()
  service.rooms.get(DESKTOP_ROOM).members = [
    { id: '0b0b0b0b', username: 'ada@desktop1', bio: '', avatar: null, joinedAt: now },
    { id: '0c0c0c0c', username: 'grace', bio: '', avatar: null, joinedAt: now }
  ]
  desktop.syncedRooms = new Set([DESKTOP_ROOM])

  await service.handlePeerMessage(desktop, { type: 'join', roomKey: DESKTOP_ROOM, username: 'ada@desktop1', ts: 50 })
  assert.equal(service.peerJoinedAt(DESKTOP_ROOM, '0b0b0b0b'), 50)
  // Nobody else moves their join back.
  await service.handlePeerMessage(stranger, { type: 'join', roomKey: DESKTOP_ROOM, username: 'grace', ts: 50 })
  assert.equal(service.peerJoinedAt(DESKTOP_ROOM, '0c0c0c0c'), now)
  await service.close()
})

test('a join that comes before the peer lists its topics still counts, and gets the history', async (t) => {
  const { service } = await startService(t)
  await service.completeOnboarding({ username: 'grace' })
  const room = await service.createRoom({ name: 'Phone crew', username: 'grace' })
  await service.sendMessage({ roomKey: room.roomKey, message: 'made on the phone' })
  const frames = []
  const desktop = createFakePeer('0d0d0d0d', 'grace@desktop', frames)
  desktop.rooms = []
  service.peers.set(desktop.connection, desktop)

  await service.handlePeerMessage(desktop, { type: 'join', roomKey: room.roomKey, username: 'grace@desktop', ts: 1 })
  assert.ok(desktop.rooms.includes(room.roomKey))
  assert.equal(service.peerJoinedAt(room.roomKey, '0d0d0d0d'), 1)
  assert.equal(frames.filter((frame) => frame.type === 'sync' && frame.roomKey === room.roomKey).length, 1)
  // And this phone's own join, so they know when it joined.
  assert.ok(frames.some((frame) => frame.type === 'join' && frame.roomKey === room.roomKey))

  // A key this phone does not hold is still nobody's business.
  await service.handlePeerMessage(desktop, { type: 'join', roomKey: 'ee'.repeat(32), username: 'grace@desktop', ts: 1 })
  assert.equal(desktop.rooms.includes('ee'.repeat(32)), false)
  await service.close()
})

test('history waits for a peer\'s join, and goes once it comes', async (t) => {
  const { service } = await startService(t)
  await service.completeOnboarding({ username: 'grace' })
  const room = await service.createRoom({ name: 'Phone crew', username: 'grace' })
  await service.sendMessage({ roomKey: room.roomKey, message: 'made on the phone' })
  const frames = []
  const desktop = createFakePeer('0d0d0d0d', 'grace@desktop', frames)
  desktop.rooms = [room.roomKey]
  service.peers.set(desktop.connection, desktop)

  // Shared before they said when they joined: nothing yet.
  await service.syncHistoryToPeerOnce(desktop, room.roomKey)
  assert.equal(frames.length, 0)
  await service.handlePeerMessage(desktop, { type: 'join', roomKey: room.roomKey, username: 'grace@desktop', ts: 1 })
  assert.equal(frames.filter((frame) => frame.type === 'sync').length, 1)
  await service.close()
})

test('a room made on the phone keeps the time it was made as its join time', async (t) => {
  const { service, storagePath } = await startService(t)
  await service.completeOnboarding({ username: 'grace' })
  const room = await service.createRoom({ name: 'Phone crew', username: 'grace' })
  const made = service.rooms.get(room.roomKey).createdAt
  assert.equal(service.rooms.get(room.roomKey).joinedAt, made)
  await service.close()

  // Saved by an older build, with no join time at all.
  const state = JSON.parse(await readFile(path.join(storagePath, 'peerchat-mobile.json'), 'utf8'))
  for (const entry of state.rooms) delete entry.joinedAt
  await writeFile(path.join(storagePath, 'peerchat-mobile.json'), JSON.stringify(state))
  const restarted = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  assert.equal(restarted.rooms.get(room.roomKey).joinedAt, made)
  assert.equal(restarted.exportTransfer({ targetType: 'desktop' }).rooms.find((entry) => entry.roomKey === room.roomKey).joinedAt, made)
  await restarted.close()
})

test('a proof made by another device and passed on renames nothing and opens no rooms', async (t) => {
  const { service, link } = await linkedPhone(t)
  const frames = []
  const desktop = createFakePeer('0b0b0b0b', 'ada', frames)
  const stranger = createFakePeer('0c0c0c0c', 'mallory', frames)
  service.peers.set(stranger.connection, stranger)
  // The desktop's own proof, seen in a shared room and sent on by somebody else.
  await service.handlePeerMessage(stranger, {
    type: 'profile',
    username: 'eve',
    link: makeProfileProof(link, { username: 'eve', at: Date.now() + 60_000 }, desktop.key)
  })
  await service.handlePeerMessage(stranger, { type: 'link-rooms', rooms: [{ roomKey: 'ab'.repeat(32), name: 'Not yours' }] })
  assert.equal(service.getProfile().username, 'ada')
  assert.equal(service.rooms.has('ab'.repeat(32)), false)
  assert.equal(frames.some((frame) => frame.type === 'link-rooms'), false)
  await service.close()
})

test('rooms go between the person\'s devices once one proves it is theirs', async (t) => {
  const { service, link } = await linkedPhone(t)
  const frames = []
  const desktop = createFakePeer('0b0b0b0b', 'ada', frames)
  service.peers.set(desktop.connection, desktop)
  await service.handlePeerMessage(desktop, {
    type: 'profile',
    username: 'ada',
    link: makeProfileProof(link, { username: 'ada', at: 100 }, desktop.key)
  })
  // Everything this phone is in, with the keys, once.
  const offered = frames.find((frame) => frame.type === 'link-rooms')
  assert.ok(offered.rooms.some((room) => room.roomKey === DESKTOP_ROOM))
  await service.handlePeerMessage(desktop, {
    type: 'profile',
    username: 'ada',
    link: makeProfileProof(link, { username: 'ada', at: 100 }, desktop.key)
  })
  assert.equal(frames.filter((frame) => frame.type === 'link-rooms').length, 1)

  // A room the desktop is in comes here and is joined.
  const shared = 'ee'.repeat(32)
  await service.handlePeerMessage(desktop, { type: 'link-rooms', rooms: [{ roomKey: shared, name: 'Shared', createdAt: 10, joinedAt: 20 }] })
  assert.equal(service.rooms.get(shared).name, 'Shared')
  assert.equal(service.rooms.get(shared).joinedAt, 20)
  assert.ok(service.sdk.joined.includes(derivePeerChatTopic(shared).toString('hex')))

  // A room made here goes to the desktop.
  frames.length = 0
  const made = await service.createRoom({ name: 'Made here', username: 'ada' })
  const sent = frames.find((frame) => frame.type === 'link-rooms')
  assert.deepEqual(sent.rooms.map((room) => room.roomKey), [made.roomKey])
  assert.equal(sent.rooms[0].creatorKey, service.localKey)

  // Left here, it is not taken back.
  await service.leaveRoom({ roomKey: shared })
  await service.handlePeerMessage(desktop, { type: 'link-rooms', rooms: [{ roomKey: shared, name: 'Shared' }] })
  assert.equal(service.rooms.has(shared), false)
  await service.close()

  // And that holds after a restart, until it is joined again.
  const storagePath = service.storagePath
  const restarted = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  const again = createFakePeer('0b0b0b0b', 'ada', [])
  restarted.peers.set(again.connection, again)
  await restarted.handlePeerMessage(again, { type: 'profile', username: 'ada', link: makeProfileProof(restarted.link, { username: 'ada', at: 100 }, again.key) })
  await restarted.handlePeerMessage(again, { type: 'link-rooms', rooms: [{ roomKey: shared, name: 'Shared' }] })
  assert.equal(restarted.rooms.has(shared), false)
  await restarted.joinRoom({ roomKey: shared })
  assert.equal(restarted.rooms.has(shared), true)
  await restarted.close()
})

test('a direct conversation goes to the other devices only once accepted', async (t) => {
  const { service, link } = await linkedPhone(t)
  const frames = []
  const desktop = createFakePeer('0b0b0b0b', 'ada', frames)
  service.peers.set(desktop.connection, desktop)
  const dm = 'dd'.repeat(32)
  service.rooms.set(dm, { roomKey: dm, name: 'Ann', isDM: true, dmWith: '0a0b0c0d', pendingAcceptance: true, createdAt: 1, members: [] })
  await service.handlePeerMessage(desktop, { type: 'profile', username: 'ada', link: makeProfileProof(link, { username: 'ada', at: 100 }, desktop.key) })
  const offered = frames.find((frame) => frame.type === 'link-rooms')
  assert.equal(offered.rooms.some((room) => room.roomKey === dm), false)
  await service.close()
})

test('shows other people\'s labels as they send them', async (t) => {
  const { service } = await linkedPhone(t)
  const peer = createFakePeer('0e0e0e0e', '')
  peer.rooms = [DESKTOP_ROOM]
  service.peers.set(peer.connection, peer)
  await service.handlePeerMessage(peer, { type: 'join', roomKey: DESKTOP_ROOM, username: 'grace@desktop2' })
  const members = service.listRoomMembers(DESKTOP_ROOM)
  assert.ok(members.find((member) => member.username === 'grace@desktop2'))
  assert.ok(members.find((member) => member.self && member.username === 'ada@mobile'))
  await service.close()
})

// A phone that took a desktop's PeerChat: 'ada@mobile' in DESKTOP_ROOM.
async function linkedPhone (t) {
  const storagePath = await tempDir(t)
  const incomingPath = path.join(storagePath, PEERCHAT_INCOMING_FILE)
  const link = createLink('desktop')
  await writeFile(incomingPath, JSON.stringify(makeTransfer({
    link,
    label: 'mobile',
    profile: { username: 'ada', bio: '', avatar: null, at: 100 },
    rooms: [{ roomKey: DESKTOP_ROOM, name: 'Desktop room', createdAt: 10 }]
  })))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath, incomingPath }).start()
  return { service, link }
}

async function startService (t) {
  const storagePath = await tempDir(t)
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  return { service, storagePath }
}

async function tempDir (t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-devices-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function createFakeSdk () {
  const feeds = new Map()
  const swarm = new EventEmitter()
  swarm.flush = async () => {}
  const joined = []
  return {
    publicKey: Buffer.alloc(32, 7),
    swarm,
    localSwarm: new EventEmitter(),
    joined,
    corestore: {
      get ({ name }) {
        if (!feeds.has(name)) feeds.set(name, new FakeFeed())
        return feeds.get(name)
      }
    },
    join (topic) {
      joined.push(Buffer.from(topic).toString('hex'))
    },
    async leave () {}
  }
}

function createFakePeer (id, username, frames = []) {
  return {
    active: true,
    connection: { destroyed: false },
    id,
    // The whole network key the connection was made with.
    key: id.repeat(8),
    username,
    bio: '',
    avatar: null,
    rooms: [DESKTOP_ROOM],
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
