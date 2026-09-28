import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  MAX_PEERCHAT_ROOM_STORAGE_BYTES,
  PeerChatService
} from '../../backend/peerchat/service.mjs'
import {
  derivePeerChatTopic,
  encryptPeerChatMessage,
  MAX_PEERCHAT_FRAME_BYTES
} from '../../backend/peerchat/protocol.mjs'
import { PRE_JOINED_PEERCHAT_ROOM_KEY } from '../../backend/peerchat/rooms.mjs'

const ROOM_KEY = 'ab'.repeat(32)
// The shape resizeImage produces: 369px JPEG, about 27 KB as a data url.
const CAROL_AVATAR = `data:image/jpeg;base64,${'A'.repeat(27_000)}`

test('PeerChat onboarding prejoins the welcome room before saving a unique profile', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-onboarding-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const sdk = createFakeSdk()
  const service = await new PeerChatService({ sdk, storagePath }).start()

  const result = await service.completeOnboarding({ username: 'Alice Mobile', bio: 'Hello' })

  assert.equal(result.profile.username, 'Alice Mobile')
  assert.equal(result.profile.bio, 'Hello')
  assert.equal(result.rooms.length, 1)
  assert.equal(result.rooms[0].roomKey, PRE_JOINED_PEERCHAT_ROOM_KEY)
  assert.equal(result.rooms[0].lastMessage, null)
  assert.deepEqual(sdk.joined, [derivePeerChatTopic(PRE_JOINED_PEERCHAT_ROOM_KEY).toString('hex')])
  await service.close()
})

test('PeerChat onboarding rejects a username already known in the welcome room', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-onboarding-name-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  const peer = createFakePeer('desktop', 'Alice')
  peer.rooms = [PRE_JOINED_PEERCHAT_ROOM_KEY]
  service.peers.set(peer.connection, peer)

  await assert.rejects(
    service.completeOnboarding({ username: 'alice' }),
    /Username is already taken/
  )
  assert.equal(service.getProfile().username, '')
  assert.equal(service.listRooms()[0].roomKey, PRE_JOINED_PEERCHAT_ROOM_KEY)
  await service.close()
})

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
  assert.equal(firstSdk.joined[0], derivePeerChatTopic(room.roomKey).toString('hex'))
  assert.notEqual(firstSdk.joined[0], room.roomKey)
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

  const syncTo = async (peerId, joinedAt) => {
    const frames = []
    const stored = service.rooms.get(room.roomKey)
    service.rememberRoomMember(stored, { id: peerId, username: peerId }, joinedAt)
    await service.syncHistoryToPeer({
      id: peerId,
      connection: { destroyed: false },
      rooms: [room.roomKey],
      transport: {
        send: (frame) => frames.push(JSON.parse(frame)) || true,
        close () {}
      }
    }, room.roomKey)
    return frames.map((frame) => frame.type)
  }

  // A member who was already here gets everything they missed.
  assert.deepEqual(await syncTo('aaaaaaaa', 1), ['sync', 'sync-reaction', 'sync-done'])

  // Someone joining after the message starts with an empty room instead of
  // inheriting a backlog they were never part of. Let the clock move on first:
  // a join time in the same millisecond as the message counts as having been
  // there for it, and a future one is clamped back to now.
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(await syncTo('bbbbbbbb', Date.now()), ['sync-done'])

  // And a peer who has not said when they joined gets nothing either.
  const unknownFrames = []
  await service.syncHistoryToPeer({
    id: 'cccccccc',
    connection: { destroyed: false },
    rooms: [room.roomKey],
    transport: {
      send: (frame) => unknownFrames.push(JSON.parse(frame)) || true,
      close () {}
    }
  }, room.roomKey)
  assert.deepEqual(unknownFrames.map((frame) => frame.type), ['sync-done'])

  await service.reactToMessage({ roomKey: room.roomKey, msgId: sent.id, emoji: '' })
  snapshot = await service.getSnapshot({ roomKey: room.roomKey, version: -1 })
  assert.deepEqual(snapshot.messages[0].reactions, [])
  await service.close()
})

test('PeerChat preserves desktop-compatible Hyperdrive attachment metadata', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-attachment-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  const room = await service.createRoom({ name: 'Files', username: 'Alice' })
  const url = `hyper://${'a'.repeat(52)}/shared/report.pdf`

  const sent = await service.sendMessage({
    roomKey: room.roomKey,
    message: url,
    fileName: 'report.pdf',
    fileSize: 2048,
    fileEnc: true
  })
  assert.equal(sent.fileName, 'report.pdf')
  assert.equal(sent.fileSize, 2048)
  assert.equal(sent.fileEnc, true)

  const snapshot = await service.getSnapshot({ roomKey: room.roomKey, version: -1 })
  assert.equal(snapshot.messages[0].message, url)
  assert.equal(snapshot.messages[0].fileName, 'report.pdf')
  assert.equal(snapshot.messages[0].fileSize, 2048)
  assert.equal(snapshot.messages[0].fileEnc, true)
  await service.close()
})

test('PeerChat preserves sanitized desktop-compatible link previews', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-preview-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  const room = await service.createRoom({ name: 'Links', username: 'Alice' })

  const sent = await service.sendMessage({
    roomKey: room.roomKey,
    message: 'Read https://example.com/article',
    preview: {
      url: 'https://example.com/article',
      host: 'EXAMPLE.COM',
      title: 'Example article',
      description: 'A safe preview'
    }
  })
  assert.deepEqual(sent.preview, {
    url: 'https://example.com/article',
    host: 'example.com',
    title: 'Example article',
    description: 'A safe preview'
  })

  const snapshot = await service.getSnapshot({ roomKey: room.roomKey, version: -1 })
  assert.deepEqual(snapshot.messages[0].preview, sent.preview)

  const unsafe = await service.sendMessage({
    roomKey: room.roomKey,
    message: 'Do not preview this',
    preview: { url: 'http://127.0.0.1/private', title: 'Private service' }
  })
  assert.equal(unsafe.preview, undefined)

  const fullMessage = 'x'.repeat(64 * 1024)
  const bounded = await service.sendMessage({
    roomKey: room.roomKey,
    message: fullMessage,
    preview: { url: 'https://example.com/', title: 'Dropped to preserve the message limit' }
  })
  assert.equal(bounded.message, fullMessage)
  assert.equal(bounded.preview, undefined)
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
  assert.equal(service.getUnreadTotal(), 1)
  assert.equal(Number.isSafeInteger(listed.lastReadTs), true)
  const previousLastReadTs = listed.lastReadTs

  const active = service.setActiveRoom({ roomKey: room.roomKey })
  assert.equal(active.rooms[0].unreadCount, 0)
  assert.equal(service.getUnreadTotal(), 0)
  assert.equal(active.rooms[0].lastReadTs >= previousLastReadTs, true)
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
  assert.equal(service.getUnreadTotal(), 1)
  await service.close()

  const restarted = await new PeerChatService({ sdk: createFakeSdk(cloneFeeds(feeds)), storagePath }).start()
  listed = restarted.listRooms()[0]
  assert.equal(listed.unreadCount, 1)
  assert.equal(listed.unreadMentions, 0)
  assert.equal(Number.isSafeInteger(listed.lastReadTs), true)
  await restarted.close()
})

test('PeerChat exposes participant profiles from desktop profile and join frames', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-members-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  const room = await service.createRoom({ name: 'Members', username: 'Alice Mobile' })
  const peer = createFakePeer('deadbeef', '')
  peer.rooms = [room.roomKey]
  service.peers.set(peer.connection, peer)

  const avatar = 'data:image/png;base64,YQ=='
  await service.handlePeerMessage(peer, {
    type: 'join',
    roomKey: room.roomKey,
    username: 'Desktop User',
    bio: 'Desktop bio',
    avatar
  })
  assert.deepEqual(service.listRooms()[0].members, [
    { id: service.localId, username: 'Alice Mobile', bio: '', avatar: null, self: true, online: true },
    { id: 'deadbeef', username: 'Desktop User', bio: 'Desktop bio', avatar, self: false, online: true }
  ])

  await service.handlePeerMessage(peer, { type: 'profile', username: '<invalid>', bio: '', avatar: null })
  assert.equal(service.listRooms()[0].members[1].username, 'Desktop User')
  assert.equal(service.listRooms()[0].members[1].avatar, null)
  service.peers.delete(peer.connection)
  assert.equal(service.listRooms()[0].members[1].online, false)
  await service.close()

  const restarted = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  assert.deepEqual(restarted.listRooms()[0].members.map(({ id, username, online }) => ({ id, username, online })), [
    { id: restarted.localId, username: 'Alice Mobile', online: true },
    { id: 'deadbeef', username: 'Desktop User', online: false }
  ])
  await restarted.close()
})

test('PeerChat accepts valid room history from before the local join time', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-prejoin-history-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  await service.joinRoom({ roomKey: ROOM_KEY, username: 'Mobile' })
  const peer = createFakePeer('desktop-peer', 'Desktop')

  await service.handlePeerMessage(peer, {
    type: 'sync',
    id: 'message-before-mobile-joined',
    roomKey: ROOM_KEY,
    sender: 'desktop-peer',
    sn: 'Desktop',
    ...encryptPeerChatMessage('Earlier room history', ROOM_KEY),
    ts: Date.now() - 60_000
  })

  const snapshot = await service.getSnapshot({ roomKey: ROOM_KEY, version: -1 })
  assert.equal(snapshot.messages.length, 1)
  assert.equal(snapshot.messages[0].message, 'Earlier room history')
  await service.close()
})

test('PeerChat persists profile metadata and lets only hosts update room metadata', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-metadata-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const feeds = new Map()
  const service = await new PeerChatService({ sdk: createFakeSdk(feeds), storagePath }).start()
  service.setProfile({ username: 'Alice', bio: 'Mobile profile', linkPreview: false })
  const room = await service.createRoom({ name: 'Original', bio: 'First bio' })
  assert.equal(room.createdBy, service.localId)
  assert.equal(room.createdByName, 'Alice')
  assert.equal(Number.isSafeInteger(room.createdAt), true)

  const updated = service.updateRoom({
    roomKey: room.roomKey,
    name: 'Renamed',
    bio: 'Room details',
    link: 'https://example.com/chat'
  })
  assert.equal(updated.room.name, 'Renamed')
  assert.equal(updated.room.bio, 'Room details')
  assert.equal(updated.room.link, 'https://example.com/chat')
  await service.close()

  const restarted = await new PeerChatService({ sdk: createFakeSdk(cloneFeeds(feeds)), storagePath }).start()
  assert.equal(restarted.getProfile().bio, 'Mobile profile')
  assert.equal(restarted.getProfile().linkPreview, false)
  assert.equal(restarted.listRooms()[0].name, 'Renamed')
  assert.equal(restarted.listRooms()[0].bio, 'Room details')
  await restarted.close()

  const clientPath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-client-metadata-'))
  t.after(() => rm(clientPath, { recursive: true, force: true }))
  const client = await new PeerChatService({ sdk: createFakeSdk(), storagePath: clientPath }).start()
  await client.joinRoom({ roomKey: ROOM_KEY, username: 'Client' })
  assert.throws(
    () => client.updateRoom({ roomKey: ROOM_KEY, name: 'Spoofed' }),
    /Only the room host/
  )
  await client.close()
})

test('PeerChat persists and synchronizes host-owned room moderation settings', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-moderation-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const frames = []
  const feeds = new Map()
  const service = await new PeerChatService({ sdk: createFakeSdk(feeds), storagePath }).start()
  const room = await service.createRoom({
    name: 'Moderated room',
    username: 'Host',
    moderation: { abuseFilter: false, nsfwFilter: true, spamRateLimit: 15 }
  })
  assert.deepEqual(room.moderation, {
    abuseFilter: false,
    nsfwFilter: true,
    spamRateLimit: 15
  })

  const peer = createFakePeer('desktop-peer', 'Desktop', frames)
  peer.rooms = [room.roomKey]
  service.sendRoomMeta(peer, room.roomKey)
  assert.deepEqual(frames.at(-1).moderation, room.moderation)
  await service.close()

  const restarted = await new PeerChatService({ sdk: createFakeSdk(cloneFeeds(feeds)), storagePath }).start()
  assert.deepEqual(restarted.listRooms()[0].moderation, room.moderation)
  await restarted.close()

  const clientPath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-client-moderation-'))
  t.after(() => rm(clientPath, { recursive: true, force: true }))
  const client = await new PeerChatService({ sdk: createFakeSdk(), storagePath: clientPath }).start()
  await client.joinRoom({ roomKey: room.roomKey, username: 'Client' })
  const hostPeer = createFakePeer('desktop-peer', 'Host')
  hostPeer.rooms = [room.roomKey]
  await client.handlePeerMessage(hostPeer, {
    type: 'room-meta',
    roomKey: room.roomKey,
    moderation: room.moderation
  })
  assert.deepEqual(client.listRooms()[0].moderation, room.moderation)
  await client.close()
})

test('PeerChat blocks outgoing content before it reaches the encrypted feed', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-outgoing-moderation-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  const room = await service.createRoom({ name: 'Room', username: 'Alice' })

  await assert.rejects(
    service.sendMessage({ roomKey: room.roomKey, message: 'please stfu' }),
    /Message blocked/
  )
  assert.equal(service.feeds.get(room.roomKey).length, 0)
  await service.close()
})

test('PeerChat filters synced history without escalating the relaying peer', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-sync-moderation-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  await service.joinRoom({ roomKey: ROOM_KEY, username: 'Mobile' })
  const peer = createFakePeer('desktop-peer', 'Desktop')
  peer.initialSyncCount = 0

  for (let index = 0; index < 3; index += 1) {
    await service.handlePeerMessage(peer, {
      type: 'sync',
      id: `blocked-sync-${index}`,
      roomKey: ROOM_KEY,
      sender: 'history-author',
      sn: 'History author',
      ...encryptPeerChatMessage('stfu', ROOM_KEY),
      ts: Date.now() + index
    })
  }
  await service.handlePeerMessage(peer, {
    id: 'safe-live-message',
    roomKey: ROOM_KEY,
    sn: 'Desktop',
    ...encryptPeerChatMessage('Safe live message', ROOM_KEY),
    ts: Date.now() + 4
  })

  const snapshot = await service.getSnapshot({ roomKey: ROOM_KEY, version: -1 })
  assert.equal(snapshot.messages.filter((message) => message.system).length, 3)
  assert.equal(snapshot.messages.at(-1).message, 'Safe live message')
  await service.close()
})

test('PeerChat escalates repeated live violations and drops a kicked peer', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-live-moderation-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  await service.joinRoom({ roomKey: ROOM_KEY, username: 'Mobile' })
  const peer = createFakePeer('desktop-peer', 'Desktop')
  peer.initialSyncCount = 0

  for (let index = 0; index < 3; index += 1) {
    await service.handlePeerMessage(peer, {
      id: `blocked-live-${index}`,
      roomKey: ROOM_KEY,
      sn: 'Desktop',
      ...encryptPeerChatMessage('stfu', ROOM_KEY),
      ts: Date.now() + index
    })
  }
  await service.handlePeerMessage(peer, {
    id: 'dropped-after-kick',
    roomKey: ROOM_KEY,
    sn: 'Desktop',
    ...encryptPeerChatMessage('Safe but blocked during cooldown', ROOM_KEY),
    ts: Date.now() + 4
  })

  const snapshot = await service.getSnapshot({ roomKey: ROOM_KEY, version: -1 })
  assert.equal(snapshot.messages.length, 3)
  assert.match(snapshot.messages.at(-1).message, /temporarily removed/)
  await service.close()
})

test('PeerChat verifies and completes desktop-compatible direct-message invitations', async (t) => {
  const senderPath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-dm-sender-'))
  const receiverPath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-dm-receiver-'))
  t.after(() => rm(senderPath, { recursive: true, force: true }))
  t.after(() => rm(receiverPath, { recursive: true, force: true }))

  const sender = await new PeerChatService({ sdk: createFakeSdk(new Map(), 7), storagePath: senderPath }).start()
  const receiver = await new PeerChatService({ sdk: createFakeSdk(new Map(), 8), storagePath: receiverPath }).start()
  sender.setProfile({ username: 'Alice', bio: 'Sender' })
  receiver.setProfile({ username: 'Bob', bio: 'Receiver' })

  const inviteFrames = []
  const senderViewOfReceiver = createFakePeer(receiver.localId, 'Bob', inviteFrames)
  sender.peers.set(senderViewOfReceiver.connection, senderViewOfReceiver)
  const outgoing = await sender.createDirectMessage({ peerId: receiver.localId, username: 'Bob' })
  assert.equal(outgoing.room.isDM, true)
  assert.equal(outgoing.room.pendingAcceptance, true)

  const senderPeer = createFakePeer(sender.localId, 'Alice')
  receiver.peers.set(senderPeer.connection, senderPeer)

  // A key this device already holds as something other than a conversation
  // with them is not theirs to name.
  const ownRoom = await receiver.createRoom({ name: 'Bob only', username: 'Bob' })
  await receiver.handlePeerMessage(senderPeer, {
    ...inviteFrames[inviteFrames.length - 1],
    roomKey: ownRoom.roomKey
  })
  assert.equal(receiver.listPendingDirectMessages().length, 0)

  // A key they minted is theirs to name. The handshake already proved who they
  // are, and the key is a secret rather than something anybody could work out
  // from two public peer ids.
  await receiver.handlePeerMessage(senderPeer, inviteFrames.pop())
  assert.equal(receiver.listPendingDirectMessages()[0].fromUsername, 'Alice')

  await receiver.close()
  const restartedReceiver = await new PeerChatService({
    sdk: createFakeSdk(new Map(), 8),
    storagePath: receiverPath
  }).start()
  assert.equal(restartedReceiver.listPendingDirectMessages()[0].roomKey, outgoing.room.roomKey)

  const restartedSenderPeer = createFakePeer(sender.localId, 'Alice')
  restartedReceiver.peers.set(restartedSenderPeer.connection, restartedSenderPeer)

  const acceptFrames = []
  restartedSenderPeer.transport = {
    send: (frame) => acceptFrames.push(JSON.parse(frame)) || true,
    close () {}
  }
  const accepted = await restartedReceiver.acceptDirectMessage({ roomKey: outgoing.room.roomKey })
  assert.equal(accepted.room.pendingAcceptance, false)
  assert.equal(restartedReceiver.listPendingDirectMessages().length, 0)

  await sender.handlePeerMessage(senderViewOfReceiver, acceptFrames.pop())
  assert.equal(sender.listRooms()[0].pendingAcceptance, false)
  const sent = await sender.sendMessage({ roomKey: outgoing.room.roomKey, message: 'Private hello' })
  assert.equal(sent.message, 'Private hello')

  sender.rooms.get(outgoing.room.roomKey).rejected = true
  await assert.rejects(
    sender.sendMessage({ roomKey: outgoing.room.roomKey, message: 'Blocked message' }),
    /declined/
  )
  const retried = await sender.createDirectMessage({ peerId: receiver.localId, username: 'Bob' })
  assert.equal(retried.room.rejected, false)
  assert.equal(retried.room.pendingAcceptance, true)

  await sender.close()
  await restartedReceiver.close()
})

test('PeerChat lists everyone who has spoken in a room, not just the connected peers', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-members-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  service.setProfile({ username: 'Alice' })
  await service.joinRoom({ roomKey: ROOM_KEY })

  const peer = createFakePeer('bb00bb00', 'Bob')
  service.peers.set(peer.connection, peer)
  await service.handlePeerMessage(peer, {
    id: 'from-bob',
    roomKey: ROOM_KEY,
    sn: 'Bob',
    ...encryptPeerChatMessage('Hello from Bob', ROOM_KEY),
    ts: Date.now()
  })

  // Bob walks away. Desktop still shows him in the room, so mobile has to too.
  service.peers.delete(peer.connection)
  const snapshot = await service.getSnapshot({ roomKey: ROOM_KEY, version: -1 })
  const bob = snapshot.room.members.find((member) => member.username === 'Bob')
  assert.equal(bob?.online, false)
  assert.equal(snapshot.room.members[0].self, true)

  // Remembering him must not hand him the whole room the next time he connects.
  assert.equal(service.peerJoinedAt(ROOM_KEY, peer.id), null)

  await service.close()
  const restarted = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  assert.equal(restarted.listRooms()[0].members.some((member) => member.username === 'Bob'), true)
  assert.equal(restarted.peerJoinedAt(ROOM_KEY, peer.id), null)
  await restarted.close()
})

test('PeerChat exchanges room member lists with peers the desktop way', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-members-list-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  service.setProfile({ username: 'Alice' })
  await service.joinRoom({ roomKey: ROOM_KEY })

  const frames = []
  const peer = createFakePeer('bb00bb00', 'Bob', frames)

  // Desktop keys members by peer id, so the wire shape has to match.
  await service.handlePeerMessage(peer, {
    type: 'members-list',
    roomKey: ROOM_KEY,
    members: {
      cc00cc00: { username: 'Carol', bio: 'Third', avatar: CAROL_AVATAR, joinedAt: 1 },
      dd00dd00: { username: 'Dave', bio: '' },
      '': { username: 'Nobody' },
      ee00ee00: { username: '' }
    }
  })

  const names = service.listRooms()[0].members.map((member) => member.username).sort()
  assert.deepEqual(names, ['Alice', 'Carol', 'Dave'])

  // A third party does not get to set a join time: that decides which history
  // the peer is sent, and only they can announce it.
  assert.equal(service.peerJoinedAt(ROOM_KEY, 'cc00cc00'), null)

  // Pictures ride along, so an offline member is not a grey circle.
  assert.equal(service.listRooms()[0].members.find((m) => m.id === 'cc00cc00').avatar, CAROL_AVATAR)

  // Someone already lifted out of the feed has a name and nothing else. A peer
  // that knows them fills in the rest rather than being ignored as a duplicate.
  service.rooms.get(ROOM_KEY).members.push({ id: '11002200', username: 'Eve', bio: '', avatar: null })
  await service.handlePeerMessage(peer, {
    type: 'members-list',
    roomKey: ROOM_KEY,
    members: { 11002200: { username: 'Eve', bio: 'Back again', avatar: CAROL_AVATAR } }
  })
  const eve = service.listRooms()[0].members.find((m) => m.id === '11002200')
  assert.equal(eve.avatar, CAROL_AVATAR)
  assert.equal(eve.bio, 'Back again')

  // What we have seen from that person directly always wins.
  await service.handlePeerMessage(peer, {
    type: 'members-list',
    roomKey: ROOM_KEY,
    members: { 11002200: { username: 'Eve', bio: 'Stale', avatar: null } }
  })
  assert.equal(service.listRooms()[0].members.find((m) => m.id === '11002200').bio, 'Back again')

  // And we hand ours back the same way.
  service.shareMembers(peer, ROOM_KEY)
  const shared = frames.find((frame) => frame.type === 'members-list')
  assert.equal(shared.roomKey, ROOM_KEY)
  assert.equal(shared.members.cc00cc00.username, 'Carol')
  assert.equal(shared.members.cc00cc00.avatar, CAROL_AVATAR)

  // A crowded room is split so no single line is refused on the other side.
  const crowded = []
  service.rooms.get(ROOM_KEY).members = Array.from({ length: 64 }, (_, index) => ({
    id: index.toString(16).padStart(8, '0'),
    username: `Member ${index}`,
    bio: '',
    avatar: CAROL_AVATAR
  }))
  const many = createFakePeer('ff00ff00', 'Watcher', crowded)
  service.shareMembers(many, ROOM_KEY)
  const lists = crowded.filter((frame) => frame.type === 'members-list')
  assert.ok(lists.length > 1, 'a crowded room has to be split')
  const seen = new Set()
  for (const frame of lists) {
    assert.ok(
      Buffer.byteLength(JSON.stringify(frame)) < MAX_PEERCHAT_FRAME_BYTES,
      'an oversized line is dropped whole by the receiver'
    )
    for (const [id, member] of Object.entries(frame.members)) {
      seen.add(id)
      assert.equal(member.avatar, CAROL_AVATAR, 'splitting is not an excuse to drop the picture')
    }
  }
  assert.equal(seen.size, 64)
  await service.close()
})

test('PeerChat keeps room for a live member once the feed has filled the member list', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-member-cap-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  service.setProfile({ username: 'Alice' })
  await service.joinRoom({ roomKey: ROOM_KEY })

  // A long-lived shared room fills up with names lifted out of its history.
  const room = service.rooms.get(ROOM_KEY)
  room.members = Array.from({ length: 99 }, (_, index) => ({
    id: index.toString(16).padStart(8, '0'),
    username: `Ghost ${index}`,
    bio: '',
    avatar: null
  }))

  const joinTs = Date.now()
  const peer = createFakePeer('aa00aa00', 'Live Peer')
  assert.equal(service.rememberRoomMember(room, peer, joinTs), true, 'a live peer must still fit')

  // Without the join time we would sync them no history at all.
  assert.equal(service.peerJoinedAt(ROOM_KEY, peer.id), joinTs)
  assert.equal(room.members.length, 99, 'a feed-only name gave up its slot')
  assert.equal(room.members.some((member) => member.username === 'Ghost 0'), false)
  await service.close()
})

test('PeerChat refuses a rename that collides with someone already in a room', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-rename-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  service.setProfile({ username: 'Alice', bio: 'First' })
  await service.joinRoom({ roomKey: ROOM_KEY })

  const peer = createFakePeer('cc00cc00', 'Bob')
  service.peers.set(peer.connection, peer)

  assert.throws(() => service.setProfile({ username: 'bob' }), /already taken/)
  assert.throws(() => service.setProfile({ username: 'Bob' }), /already taken/)

  // Keeping the same name while editing the rest of the profile is not a rename.
  assert.equal(service.setProfile({ username: 'Alice', bio: 'Second' }).bio, 'Second')
  assert.equal(service.setProfile({ username: 'Carol' }).username, 'Carol')

  // An offline member counts too, the same as a connected one.
  service.peers.delete(peer.connection)
  service.rooms.get(ROOM_KEY).members = [{ id: 'cc00cc00', username: 'Bob', bio: '', avatar: null }]
  assert.throws(() => service.setProfile({ username: 'Bob' }), /already taken/)
  await service.close()
})

test('PeerChat opens a direct room for an offline peer and invites them on reconnect', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-offline-dm-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  service.setProfile({ username: 'Alice' })
  await service.joinRoom({ roomKey: ROOM_KEY })

  // Bob was here once, then left. His name is all we have.
  const bobId = 'bb00bb00'
  service.rooms.get(ROOM_KEY).members = [{ id: bobId, username: 'Bob', bio: 'Away', avatar: null }]

  const outgoing = await service.createDirectMessage({ peerId: bobId })
  assert.equal(outgoing.room.isDM, true)
  assert.equal(outgoing.room.pendingAcceptance, true)
  assert.equal(outgoing.room.name, 'Bob', 'falls back to the name we last saw')

  const frames = []
  const bob = createFakePeer(bobId, 'Bob', frames)
  bob.active = false
  bob.rooms = [outgoing.room.roomKey]
  service.pendingPeers.set(bob.connection, bob)
  service.activatePeer(bob)

  const invite = frames.find((frame) => frame.type === 'dm-invite')
  assert.equal(invite?.roomKey, outgoing.room.roomKey)
  await service.close()
})

test('PeerChat blocking stops direct messages both ways and survives a restart', async (t) => {
  const senderPath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-block-sender-'))
  const receiverPath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-block-receiver-'))
  t.after(() => rm(senderPath, { recursive: true, force: true }))
  t.after(() => rm(receiverPath, { recursive: true, force: true }))

  const sender = await new PeerChatService({ sdk: createFakeSdk(new Map(), 11), storagePath: senderPath }).start()
  const receiver = await new PeerChatService({ sdk: createFakeSdk(new Map(), 12), storagePath: receiverPath }).start()
  sender.setProfile({ username: 'Alice', bio: 'Sender' })
  receiver.setProfile({ username: 'Bob', bio: 'Receiver' })

  const inviteFrames = []
  const senderViewOfReceiver = createFakePeer(receiver.localId, 'Bob', inviteFrames)
  sender.peers.set(senderViewOfReceiver.connection, senderViewOfReceiver)
  const outgoing = await sender.createDirectMessage({ peerId: receiver.localId, username: 'Bob' })

  const blockedFrames = []
  const senderPeer = createFakePeer(sender.localId, 'Alice', blockedFrames)
  receiver.peers.set(senderPeer.connection, senderPeer)

  const blocked = receiver.blockPeer({ peerId: sender.localId, username: 'Alice' })
  assert.equal(blocked.blockedPeers.length, 1)
  assert.equal(blocked.blockedPeers[0].username, 'Alice')
  assert.equal(receiver.isPeerBlocked(sender.localId), true)

  // The invite arrives after the block, so it never becomes a request.
  await receiver.handlePeerMessage(senderPeer, inviteFrames.pop())
  assert.equal(receiver.listPendingDirectMessages().length, 0)

  const notice = blockedFrames.pop()
  assert.equal(notice.type, 'dm-blocked')
  await sender.handlePeerMessage(senderViewOfReceiver, notice)
  const senderSide = sender.listRooms().find((room) => room.roomKey === outgoing.room.roomKey)
  assert.equal(senderSide.blockedByPeer, true)
  // A block is not a decline: it reads differently and cannot be retried.
  assert.equal(senderSide.rejected, false)
  await assert.rejects(
    sender.sendMessage({ roomKey: outgoing.room.roomKey, message: 'Still trying' }),
    /blocked your direct messages/
  )

  // Asking again clears the flag and re-sends, otherwise an unblock on Bob's
  // side would leave Alice permanently locked out with no way back.
  const retried = await sender.createDirectMessage({ peerId: receiver.localId, username: 'Bob' })
  assert.equal(retried.room.blockedByPeer, false)
  assert.equal(retried.room.pendingAcceptance, true)
  assert.equal(inviteFrames.at(-1)?.type, 'dm-invite', 'the retry goes back out')

  // Still blocked, so the same answer comes back.
  await receiver.handlePeerMessage(senderPeer, inviteFrames.pop())
  await sender.handlePeerMessage(senderViewOfReceiver, blockedFrames.pop())
  assert.equal(sender.listRooms().find((room) => room.roomKey === outgoing.room.roomKey).blockedByPeer, true)

  // Blocking is one way. Alice can still open the room, Bob cannot start one.
  await assert.rejects(
    receiver.createDirectMessage({ peerId: sender.localId, username: 'Alice' }),
    /Unblock/
  )

  // An accepted direct room goes quiet too. Unblocked first as the control, so
  // the assertion below cannot pass just because the room was never wired up.
  const directRoom = await receiver.joinRoom({ roomKey: outgoing.room.roomKey })
  Object.assign(receiver.rooms.get(directRoom.roomKey), { isDM: true, dmWith: sender.localId })
  senderPeer.rooms.push(directRoom.roomKey)

  receiver.unblockPeer({ peerId: sender.localId })
  await receiver.handlePeerMessage(senderPeer, {
    id: 'allowed-dm-message',
    roomKey: directRoom.roomKey,
    sn: 'Alice',
    ...encryptPeerChatMessage('Before the block', directRoom.roomKey),
    ts: Date.now()
  })
  assert.equal((await receiver.getSnapshot({ roomKey: directRoom.roomKey, version: -1 })).messages.length, 1)

  receiver.blockPeer({ peerId: sender.localId, username: 'Alice' })
  await receiver.handlePeerMessage(senderPeer, {
    id: 'blocked-dm-message',
    roomKey: directRoom.roomKey,
    sn: 'Alice',
    ...encryptPeerChatMessage('After the block', directRoom.roomKey),
    ts: Date.now() + 1
  })
  const dmMessages = (await receiver.getSnapshot({ roomKey: directRoom.roomKey, version: -1 })).messages
  assert.equal(dmMessages.length, 1)
  assert.equal(dmMessages[0].message, 'Before the block')

  await receiver.close()
  const restarted = await new PeerChatService({
    sdk: createFakeSdk(new Map(), 12),
    storagePath: receiverPath
  }).start()
  assert.equal(restarted.isPeerBlocked(sender.localId), true)
  assert.equal(restarted.listBlockedPeers()[0].username, 'Alice')

  const unblocked = restarted.unblockPeer({ peerId: sender.localId })
  assert.deepEqual(unblocked.blockedPeers, [])
  assert.equal(restarted.isPeerBlocked(sender.localId), false)
  assert.throws(() => restarted.unblockPeer({ peerId: sender.localId }), /not blocked/)
  assert.throws(() => restarted.blockPeer({ peerId: restarted.localId }), /cannot block yourself/)

  await sender.close()
  await restarted.close()
})

test('PeerChat restores malformed direct-message state as a regular room', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-invalid-dm-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  await writeFile(path.join(storagePath, 'peerchat-mobile.json'), JSON.stringify({
    rooms: [{
      roomKey: ROOM_KEY,
      name: 'Invalid direct room',
      isDM: true,
      dmWith: 'invalid'
    }]
  }))

  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  assert.equal(service.listRooms()[0].isDM, false)
  assert.equal(service.listRooms()[0].dmWith, null)
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

test('PeerChat exchanges derived topics and opens every mutually held room', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-topics-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  const otherRoomKey = 'cd'.repeat(32)
  await service.joinRoom({ roomKey: ROOM_KEY, username: 'Alice' })
  await service.joinRoom({ roomKey: otherRoomKey, username: 'Alice' })

  const frames = []
  const peer = createFakePeer('de'.repeat(4), 'Desktop', frames)
  peer.rooms = [ROOM_KEY]
  service.peers.set(peer.connection, peer)
  service.shareTopics(peer)

  const topicsFrame = frames.shift()
  assert.equal(topicsFrame.type, 'topics')
  assert.deepEqual(new Set(topicsFrame.topics), new Set([
    derivePeerChatTopic(ROOM_KEY).toString('hex'),
    derivePeerChatTopic(otherRoomKey).toString('hex')
  ]))
  assert.equal(topicsFrame.topics.includes(ROOM_KEY), false)

  const sharedRooms = []
  service.shareRoom = (_peer, roomKey) => sharedRooms.push(roomKey)
  await service.handlePeerMessage(peer, {
    type: 'topics',
    topics: [
      derivePeerChatTopic(ROOM_KEY).toString('hex'),
      derivePeerChatTopic(otherRoomKey).toString('hex'),
      'ef'.repeat(32)
    ]
  })

  assert.equal(peer.handshake, true)
  assert.deepEqual(peer.rooms, [ROOM_KEY, otherRoomKey])
  assert.deepEqual(sharedRooms, [otherRoomKey])
  await service.close()
})

test('PeerChat evicts stale sockets so the swarm can reconnect after a network change', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-liveness-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  const peer = createFakePeer('de'.repeat(4), 'Desktop')
  let transportClosed = false
  let connectionDestroyed = false
  peer.lastReceivedAt = 1_000
  peer.transport.close = () => { transportClosed = true }
  peer.connection.destroy = () => {
    connectionDestroyed = true
    peer.connection.destroyed = true
  }
  service.peers.set(peer.connection, peer)

  assert.equal(service.checkPeerLiveness(peer, 61_000), false)
  assert.equal(service.peers.has(peer.connection), false)
  assert.equal(transportClosed, true)
  assert.equal(connectionDestroyed, true)
  await service.close()
})

test('PeerChat finishes sync state for a connection that drops during history replay', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-interrupted-sync-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  const room = await service.createRoom({ name: 'Replay Room', username: 'Alice' })
  await service.sendMessage({ roomKey: room.roomKey, message: 'Saved while offline' })
  const peer = createFakePeer('de'.repeat(4), 'Desktop')
  peer.rooms = [room.roomKey]
  peer.syncedRooms = new Set()
  peer.syncingRooms = new Map()
  peer.transport.send = (frame) => {
    if (JSON.parse(frame).type !== 'sync-done') return true
    peer.connection.destroyed = true
    return false
  }

  assert.equal(await service.syncHistoryToPeerOnce(peer, room.roomKey), false)
  assert.equal(peer.syncedRooms.has(room.roomKey), true)
  await service.close()
})

test('PeerChat reports syncing only while an empty room receives its first history', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-sync-state-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  await service.joinRoom({ roomKey: ROOM_KEY, username: 'Alice' })
  const peer = createFakePeer('de'.repeat(4), 'Desktop')
  peer.rooms = [ROOM_KEY]
  peer.syncedRooms = new Set()
  peer.syncingRooms = new Map()
  peer.syncingRooms.set(ROOM_KEY, Promise.resolve(true))
  service.peers.set(peer.connection, peer)

  assert.equal(service.listRooms()[0].connectionState, 'syncing')
  await service.sendMessage({ roomKey: ROOM_KEY, message: 'Local history exists' })
  assert.equal(service.listRooms()[0].connectionState, 'connected')

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

test('PeerChat rejects a duplicate message replayed after restart', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-restored-dedup-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const timestamp = Date.now()
  const duplicate = {
    id: 'desktop-message-before-restart',
    roomKey: ROOM_KEY,
    sender: 'desktop-peer',
    sn: 'Desktop',
    ...encryptPeerChatMessage('Already stored', ROOM_KEY),
    ts: timestamp
  }
  await writeFile(path.join(storagePath, 'peerchat-mobile.json'), JSON.stringify({
    profile: { username: 'Alice' },
    rooms: [{
      roomKey: ROOM_KEY,
      name: 'Restored Room',
      isHost: false,
      joinedAt: timestamp - 1000,
      unreadCount: 1
    }]
  }))

  const restoredFeed = new FakeFeed([duplicate])
  const service = await new PeerChatService({
    sdk: createFakeSdk(new Map([[`chat-${ROOM_KEY}`, restoredFeed]])),
    storagePath
  }).start()
  const peer = createFakePeer('de'.repeat(4), 'Desktop')
  peer.initialSyncCount = 0

  await service.handlePeerMessage(peer, { ...duplicate, type: 'sync' })

  assert.equal(restoredFeed.length, 1)
  assert.equal(service.listRooms()[0].unreadCount, 1)
  await service.close()
})

// Removing somebody has to be a fact the room keeps, not one delete. The first
// attempt deleted the stored entry and the member came straight back, because
// the list is rebuilt from what peers relay.
async function createRoomWithMember (t, prefix) {
  const storagePath = await mkdtemp(path.join(tmpdir(), prefix))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  await service.completeOnboarding({ username: 'Akhilesh' })

  const room = await service.createRoom({ name: 'Test Room', username: 'Akhilesh' })
  const stored = service.rooms.get(room.roomKey)
  stored.members = [{ id: 'aabbccdd', username: 'Bob', bio: '', avatar: null, joinedAt: Date.now() }]

  const frames = []
  const peer = createFakePeer('aabbccdd', 'Bob', frames)
  peer.key = ''
  peer.rooms = [room.roomKey]
  peer.connection.destroy = function () { this.destroyed = true }
  service.peers.set(peer.connection, peer)

  return { service, roomKey: room.roomKey, peer, frames }
}

test('removing somebody takes them out of the member list and keeps them out', async (t) => {
  const { service, roomKey } = await createRoomWithMember(t, 'peersky-peerchat-remove-')

  assert.equal(service.isRoomCreator(roomKey), true)
  assert.deepEqual(service.listRoomMembers(roomKey).map((m) => m.username), ['Akhilesh', 'Bob'])

  await service.removeRoomMember({ roomKey, peerId: 'aabbccdd' })

  assert.deepEqual(service.listRoomMembers(roomKey).map((m) => m.username), ['Akhilesh'])

  // And they stay out when the room hears about them again, which is what
  // used to bring them back.
  service.rooms.get(roomKey).members.push({
    id: 'aabbccdd', username: 'Bob', bio: '', avatar: null, joinedAt: Date.now()
  })
  assert.deepEqual(service.listRoomMembers(roomKey).map((m) => m.username), ['Akhilesh'])

  const snapshot = service.listRooms().find((room) => room.roomKey === roomKey)
  assert.deepEqual(snapshot.members.map((m) => m.username), ['Akhilesh'])
  assert.equal(snapshot.bans.length, 1)
  await service.close()
})

test('the person being removed is told, and keeps the rooms they are still in', async (t) => {
  const { service, roomKey, peer, frames } = await createRoomWithMember(t, 'peersky-peerchat-notify-')

  await service.removeRoomMember({ roomKey, peerId: 'aabbccdd' })

  // Dropping them first destroyed the connection with this still queued on it,
  // so the one person who most needed to hear it was the one who never did.
  // It also took them offline in every other room the two of us share.
  const bans = frames.filter((frame) => frame.type === 'room-bans')
  assert.equal(bans.length, 1)
  assert.equal(bans[0].roomKey, roomKey)
  assert.deepEqual(bans[0].bans.map((ban) => ban.id), ['aabbccdd'])
  // And they keep the connection: it carries every room the two of you share,
  // so taking it down over one room took them offline in all of them.
  assert.notEqual(peer.connection.destroyed, true)
  await new Promise((resolve) => setTimeout(resolve, 1100))
  assert.notEqual(peer.connection.destroyed, true)
  await service.close()
})

test('removing somebody says so in the room', async (t) => {
  const { service, roomKey } = await createRoomWithMember(t, 'peersky-peerchat-remove-notice-')

  await service.removeRoomMember({ roomKey, peerId: 'aabbccdd' })

  const notices = service.feeds.get(roomKey).entries
    .filter((entry) => entry.type === 'system')
    .map((entry) => entry.message)
  assert.deepEqual(notices, ['Bob was removed from the room by Akhilesh'])
  await service.close()
})

test('nothing a removed person sends is read, live or relayed', async (t) => {
  const { service, roomKey, peer } = await createRoomWithMember(t, 'peersky-peerchat-remove-quiet-')
  await service.removeRoomMember({ roomKey, peerId: 'aabbccdd' })

  const before = service.feeds.get(roomKey).entries.length
  const encrypted = encryptPeerChatMessage('hello anyway', roomKey)

  // Straight from them.
  await service.handlePeerMessage(peer, {
    type: 'message', roomKey, id: 'live-1', ts: Date.now(), ...encrypted
  })

  // And the same message passed along by somebody else's history sync, which
  // is how their messages kept turning up after a removal.
  const relay = createFakePeer('99887766', 'Carol')
  relay.key = ''
  relay.rooms = [roomKey]
  service.peers.set(relay.connection, relay)
  await service.handlePeerMessage(relay, {
    type: 'sync', roomKey, id: 'sync-1', sender: 'aabbccdd', ts: Date.now(), ...encrypted
  })

  assert.equal(service.feeds.get(roomKey).entries.length, before)
  await service.close()
})

test('letting somebody back in puts them back in the list', async (t) => {
  const { service, roomKey } = await createRoomWithMember(t, 'peersky-peerchat-restore-')
  await service.removeRoomMember({ roomKey, peerId: 'aabbccdd' })
  assert.deepEqual(service.listRoomMembers(roomKey).map((m) => m.username), ['Akhilesh'])

  await service.restoreRoomMember({ roomKey, peerId: 'aabbccdd' })
  service.rooms.get(roomKey).members.push({
    id: 'aabbccdd', username: 'Bob', bio: '', avatar: null, joinedAt: Date.now()
  })
  assert.deepEqual(service.listRoomMembers(roomKey).map((m) => m.username), ['Akhilesh', 'Bob'])
  await service.close()
})

test('the same person on two devices is one row, not two', async (t) => {
  const { service, roomKey, peer } = await createRoomWithMember(t, 'peersky-peerchat-collapse-')

  // A peer id comes from a device key, so a reinstall or a second device joins
  // under the same name. The room remembers both. This is what the member list
  // and the people search are both built from, so it has to collapse here.
  service.rooms.get(roomKey).members.push({
    id: '11223344', username: 'Bob', bio: '', avatar: null, joinedAt: Date.now()
  })

  const members = service.listRoomMembers(roomKey)
  assert.deepEqual(members.map((member) => member.username), ['Akhilesh', 'Bob'])
  // The one that is here now is the one worth showing: it is the one that can
  // be messaged.
  assert.equal(members.find((member) => member.username === 'Bob').id, peer.id)
  assert.equal(members.find((member) => member.username === 'Bob').online, true)
  await service.close()
})

// A direct-message key used to be sha256 of the two peer ids. Both are public,
// they are in every member list and on every personal QR code, so anybody who
// knew them could derive the key, join the topic and read the conversation and
// its media. The key is a secret now, minted and handed over on the connection.
test('a direct message gets a minted key, not one anybody can work out', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-dmkey-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  await service.completeOnboarding({ username: 'Akhilesh' })

  const { room } = await service.createDirectMessage({ peerId: 'aabbccdd', username: 'Bob' })
  const derivable = createHash('sha256')
    .update([service.localId, 'aabbccdd'].sort().join(':dm:'))
    .digest('hex')

  assert.match(room.roomKey, /^[a-f0-9]{64}$/)
  assert.notEqual(room.roomKey, derivable)

  // And two of them in a row are two different secrets, not one function of
  // the same public inputs.
  const other = await service.createDirectMessage({ peerId: '11223344', username: 'Eve' })
  assert.notEqual(other.room.roomKey, room.roomKey)
  await service.close()
})

test('asking the same person again reuses the conversation', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-dmsame-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  await service.completeOnboarding({ username: 'Akhilesh' })

  const first = await service.createDirectMessage({ peerId: 'aabbccdd', username: 'Bob' })
  const again = await service.createDirectMessage({ peerId: 'aabbccdd', username: 'Bob' })

  assert.equal(again.room.roomKey, first.room.roomKey)
  assert.equal(service.listRooms().filter((room) => room.isDM).length, 1)
  await service.close()
})

// Both sides press Message before either invite lands, so there are two keys
// for one conversation. Keys are random, so the lower one is an answer both
// reach alone.
test('two conversations opened at once converge on one', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-dmrace-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  await service.completeOnboarding({ username: 'Akhilesh' })

  const frames = []
  const peer = createFakePeer('aabbccdd', 'Bob', frames)
  service.peers.set(peer.connection, peer)
  const { room } = await service.createDirectMessage({ peerId: 'aabbccdd', username: 'Bob' })

  // Theirs sorts lower, so ours goes and theirs is what we answer.
  const lower = '00'.repeat(32)
  await service.handlePeerMessage(peer, {
    type: 'dm-invite', roomKey: lower, fromId: 'aabbccdd', fromUsername: 'Bob', toId: service.localId
  })
  assert.equal(service.rooms.has(room.roomKey), false, 'the higher key is given up')
  assert.equal(service.listPendingDirectMessages()[0].roomKey, lower)

  // And the other way round: theirs sorts higher, so ours stands and we offer
  // it again rather than keeping two.
  const second = await service.createDirectMessage({ peerId: '11223344', username: 'Eve' })
  const eve = createFakePeer('11223344', 'Eve', frames)
  service.peers.set(eve.connection, eve)
  frames.length = 0
  await service.handlePeerMessage(eve, {
    type: 'dm-invite', roomKey: 'ff'.repeat(32), fromId: '11223344', fromUsername: 'Eve', toId: service.localId
  })
  assert.equal(service.rooms.has(second.room.roomKey), true)
  assert.equal(service.listPendingDirectMessages().some((dm) => dm.fromId === '11223344'), false)
  assert.equal(frames.at(-1)?.type, 'dm-invite')
  assert.equal(frames.at(-1)?.roomKey, second.room.roomKey)
  await service.close()
})

// The bug that hid nobody. A removal records the peer's whole key whenever they
// are connected to take it from, and the member list has nothing but short ids
// to ask about. Asking with an id against a ban that carried a key answered
// "not removed", so everybody removed stayed in the list, kept being re-added
// by relayed lists, and could leave and rejoin as if nothing had happened.
test('somebody removed while connected leaves the list and stays out', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-keyban-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  await service.completeOnboarding({ username: 'Akhilesh' })

  const room = await service.createRoom({ name: 'Test Room', username: 'Akhilesh' })
  const roomKey = room.roomKey
  service.rooms.get(roomKey).members = [
    { id: 'aabbccdd', username: 'Bob', bio: '', avatar: null, joinedAt: Date.now() }
  ]

  // Connected, so the removal catches their key and not merely their first
  // eight characters.
  const peer = createFakePeer('aabbccdd', 'Bob', [])
  peer.key = 'aabbccdd' + 'ee'.repeat(28)
  peer.rooms = [roomKey]
  service.peers.set(peer.connection, peer)

  await service.removeRoomMember({ roomKey, peerId: 'aabbccdd' })

  assert.equal(service.rooms.get(roomKey).bans[0].key, 'aabbccdd' + 'ee'.repeat(28))
  assert.equal(service.isPeerIdRemovedFromRoom(roomKey, 'aabbccdd'), true)
  assert.deepEqual(service.listRoomMembers(roomKey).map((member) => member.username), ['Akhilesh'])

  // A member list relayed by somebody who has not heard yet does not put them
  // back, and neither does their own join announcement.
  service.mergeMembersList(roomKey, { aabbccdd: { username: 'Bob' } })
  service.rememberRoomMember(service.rooms.get(roomKey), peer)
  assert.deepEqual(service.listRoomMembers(roomKey).map((member) => member.username), ['Akhilesh'])

  // And the room is still shut to them, by key and by id alike.
  assert.equal(service.isPeerRemovedFromRoom(roomKey, peer), true)
  await service.close()
})

function createFakeSdk (feeds = new Map(), publicKeyByte = 7) {
  const swarm = new EventEmitter()
  swarm.flush = async () => {}
  const localSwarm = new EventEmitter()
  const joined = []

  const sdk = {
    publicKey: Buffer.alloc(32, publicKeyByte),
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

function createFakePeer (id, username, frames = []) {
  const connection = { destroyed: false }
  return {
    active: true,
    connection,
    id,
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
