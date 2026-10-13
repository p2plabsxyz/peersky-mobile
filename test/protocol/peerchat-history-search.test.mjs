import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import crypto from 'hypercore-crypto'

import { collectPeerChatNotificationCandidates } from '../../app/peerchat/notification-state.mjs'
import { attachmentKind, attachmentLabel } from '../../backend/peerchat/attachment-label.mjs'
import {
  MAX_PEERCHAT_SEARCH_RESULTS,
  normalizePeerChatSearchQuery,
  peerChatSearchSnippet
} from '../../backend/peerchat/search.mjs'
import { PeerChatService } from '../../backend/peerchat/service.mjs'

// Searching every chat on this phone at once, reading further back in a chat
// to reach an older message, and what a file reads as in the chat list.

const FILE_URL = `hyper://${'a'.repeat(52)}/1700000000000-0123456789abcdef.bin`

class FakeFeed extends EventEmitter {
  constructor (entries = []) {
    super()
    this.entries = entries
  }

  get length () { return this.entries.length }
  get byteLength () { return Buffer.byteLength(JSON.stringify(this.entries)) }
  async ready () {}

  async append (entry) {
    this.entries.push(structuredClone(entry))
    this.emit('append')
  }

  async get (index) { return structuredClone(this.entries[index]) }
  async close () {}
}

function createFakeSdk (feeds = new Map(), keyPair = null) {
  const swarm = new EventEmitter()
  swarm.flush = async () => {}
  return {
    publicKey: keyPair ? keyPair.publicKey : Buffer.alloc(32, 7),
    swarm,
    corestore: {
      get ({ name }) {
        if (!feeds.has(name)) feeds.set(name, new FakeFeed())
        return feeds.get(name)
      },
      ...(keyPair && { createKeyPair: async () => keyPair })
    },
    join () {},
    async leave () {}
  }
}

async function startService (t, feeds = new Map(), storagePath = null) {
  const dir = storagePath || await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-search-'))
  if (!storagePath) t.after(() => rm(dir, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(feeds), storagePath: dir }).start()
  t.after(() => service.close())
  return { service, storagePath: dir }
}

// Somebody in the chats, so anything this phone sends shows up here.
function listeningPeer (service, rooms) {
  const frames = []
  service.peers.set('listener', {
    active: true,
    connection: { destroyed: false },
    id: 'cafef00d',
    key: 'cafef00d'.repeat(8),
    rooms,
    transport: { send: (frame) => frames.push(frame) || true }
  })
  return frames
}

test('a file reads as Photo, Video or its name, never its address', () => {
  assert.equal(attachmentKind('beach.JPG'), 'image')
  assert.equal(attachmentKind('IMG_0001.heic'), 'image')
  assert.equal(attachmentKind('clip.mov'), 'video')
  assert.equal(attachmentKind('notes.pdf'), null)
  assert.equal(attachmentLabel('beach.jpg'), 'Photo')
  assert.equal(attachmentLabel('clip.mp4'), 'Video')
  assert.equal(attachmentLabel('notes.pdf'), 'notes.pdf')
  assert.equal(attachmentLabel(''), 'File')
})

test('the chat list shows a file by what it is, and a notification says the same', async (t) => {
  const { service } = await startService(t)
  const room = await service.createRoom({ name: 'Trips', username: 'Ada' })
  const before = service.listRooms().map((entry) => ({ ...entry, unreadCount: 0 }))

  await service.sendMessage({ roomKey: room.roomKey, message: FILE_URL, fileName: 'beach.jpg', fileSize: 10, fileEnc: true })
  assert.equal(service.listRooms().find((entry) => entry.roomKey === room.roomKey).lastMessage.message, 'Photo')
  const after = service.listRooms().map((entry) => ({ ...entry, unreadCount: 1 }))
  assert.deepEqual(collectPeerChatNotificationCandidates(before, after).map((notice) => notice.body), ['Ada: Photo'])
  await service.sendMessage({ roomKey: room.roomKey, message: FILE_URL, fileName: 'clip.mp4', fileSize: 10, fileEnc: true })
  assert.equal(service.listRooms().find((entry) => entry.roomKey === room.roomKey).lastMessage.message, 'Video')
  await service.sendMessage({ roomKey: room.roomKey, message: FILE_URL, fileName: 'plan.pdf', fileSize: 10, fileEnc: true })
  assert.equal(service.listRooms().find((entry) => entry.roomKey === room.roomKey).lastMessage.message, 'plan.pdf')
  // A link typed as a message is still the link.
  await service.sendMessage({ roomKey: room.roomKey, message: 'hyper://example' })
  assert.equal(service.listRooms().find((entry) => entry.roomKey === room.roomKey).lastMessage.message, 'hyper://example')
})

test('a file\'s address saved as the preview by an earlier build reads as the file after a restart', async (t) => {
  const feeds = new Map()
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-search-restart-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const first = await new PeerChatService({ sdk: createFakeSdk(feeds), storagePath }).start()
  const room = await first.createRoom({ name: 'Trips', username: 'Ada' })
  await first.sendMessage({ roomKey: room.roomKey, message: FILE_URL, fileName: 'beach.jpg', fileSize: 10, fileEnc: true })
  await first.close()

  // What an earlier build saved.
  const file = path.join(storagePath, 'peerchat-mobile.json')
  const saved = JSON.parse(await readFile(file, 'utf8'))
  const record = saved.rooms.find((entry) => entry.roomKey === room.roomKey)
  assert.equal(record.lastMessage.message, 'Photo')
  record.lastMessage.message = FILE_URL
  await writeFile(file, JSON.stringify(saved))

  const { service } = await startService(t, feeds, storagePath)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(service.listRooms().find((entry) => entry.roomKey === room.roomKey).lastMessage.message, 'Photo')
})

test('a chat reads further back when asked, and says whether there is more', async (t) => {
  const { service } = await startService(t)
  const room = await service.createRoom({ name: 'Long chat', username: 'Ada' })
  for (let n = 1; n <= 260; n += 1) {
    await service.sendMessage({ roomKey: room.roomKey, message: `Message ${n}` })
  }

  const opened = await service.getSnapshot({ roomKey: room.roomKey, version: -1 })
  assert.equal(opened.messages.length, 200)
  assert.equal(opened.messages[0].message, 'Message 61')
  assert.equal(opened.hasOlder, true)

  const further = await service.getSnapshot({ roomKey: room.roomKey, version: -1, limit: 400 })
  assert.equal(further.messages.length, 260)
  assert.equal(further.messages[0].message, 'Message 1')
  assert.equal(further.hasOlder, false)

  // Never less than a chat shows when it opens, and an unchanged chat sends
  // nothing either way.
  const small = await service.getSnapshot({ roomKey: room.roomKey, version: -1, limit: 3 })
  assert.equal(small.messages.length, 200)
  const unchanged = await service.getSnapshot({ roomKey: room.roomKey, version: further.version, limit: 400 })
  assert.equal(unchanged.messages, null)
  assert.equal('hasOlder' in unchanged, false)
})

test('searching finds messages in every chat, newest first, and sends nothing', async (t) => {
  const { service } = await startService(t)
  const trips = await service.createRoom({ name: 'Trips', username: 'Ada' })
  const work = await service.createRoom({ name: 'Work', username: 'Ada' })
  const frames = listeningPeer(service, [trips.roomKey, work.roomKey])

  const first = await service.sendMessage({ roomKey: trips.roomKey, message: 'The lighthouse tour starts at nine on Saturday morning' })
  await new Promise((resolve) => setTimeout(resolve, 5))
  await service.sendMessage({ roomKey: work.roomKey, message: 'Nothing about it here' })
  await new Promise((resolve) => setTimeout(resolve, 5))
  const second = await service.sendMessage({ roomKey: work.roomKey, message: 'Book the LIGHTHOUSE room for Monday' })
  await new Promise((resolve) => setTimeout(resolve, 5))
  await service.sendMessage({ roomKey: trips.roomKey, message: FILE_URL, fileName: 'lighthouse.jpg', fileSize: 10, fileEnc: true })
  assert.ok(frames.length >= 4, 'each message went to the peer')
  const sentBefore = frames.length

  const { results } = await service.searchMessages({ query: '  Lighthouse ' })
  assert.deepEqual(results.map((result) => result.roomName), ['Trips', 'Work', 'Trips'])
  // A file is found by its name and reads as what it is.
  assert.equal(results[0].message, 'Photo')
  assert.equal(results[0].fileName, 'lighthouse.jpg')
  assert.equal(results[1].id, second.id)
  assert.equal(results[1].roomKey, work.roomKey)
  assert.equal(results[1].message, 'Book the LIGHTHOUSE room for Monday')
  assert.equal(results[1].senderName, 'Ada')
  assert.equal(results[1].self, true)
  assert.equal(results[2].id, first.id)
  assert.equal(results[2].isDM, false)
  assert.ok(results[0].timestamp >= results[1].timestamp && results[1].timestamp >= results[2].timestamp)

  assert.deepEqual((await service.searchMessages({ query: '   ' })).results, [])
  assert.deepEqual((await service.searchMessages({ query: 'nowhere at all' })).results, [])
  // Searching told nobody anything.
  assert.equal(frames.length, sentBefore)

  // What comes later is found on the next search, from the text already kept.
  await new Promise((resolve) => setTimeout(resolve, 5))
  await service.sendMessage({ roomKey: work.roomKey, message: 'One more lighthouse' })
  const again = await service.searchMessages({ query: 'lighthouse' })
  assert.equal(again.results.length, 4)
  assert.equal(again.results[0].message, 'One more lighthouse')
})

test('a search leaves out people you blocked, and stops at the newest fifty', async (t) => {
  const { service } = await startService(t)
  const room = await service.createRoom({ name: 'Busy', username: 'Ada' })
  for (let n = 1; n <= MAX_PEERCHAT_SEARCH_RESULTS + 5; n += 1) {
    await service.sendMessage({ roomKey: room.roomKey, message: `Ping ${n}` })
  }
  const { results } = await service.searchMessages({ query: 'ping' })
  assert.equal(results.length, MAX_PEERCHAT_SEARCH_RESULTS)
  assert.equal(results[0].message, `Ping ${MAX_PEERCHAT_SEARCH_RESULTS + 5}`)
  assert.equal((await service.searchMessages({ query: 'ping', limit: 3 })).results.length, 3)

  // A message from someone blocked, stored as it came.
  const feed = service.feeds.get(room.roomKey)
  const mine = structuredClone(feed.entries.at(-1))
  feed.entries.push({ ...mine, id: 'f'.repeat(32), sender: 'cafebabe', sn: 'Test Bea', ts: Date.now() + 1000 })
  assert.equal((await service.searchMessages({ query: 'ping', limit: 1 })).results[0].senderName, 'Test Bea')
  await service.blockPeer({ peerId: 'cafebabe', username: 'Test Bea' })
  const blocked = await service.searchMessages({ query: 'ping', limit: 1 })
  assert.notEqual(blocked.results[0].senderName, 'Test Bea')
})

test('a leaving room takes its search text with it', async (t) => {
  const { service } = await startService(t)
  const room = await service.createRoom({ name: 'Short lived', username: 'Ada' })
  await service.sendMessage({ roomKey: room.roomKey, message: 'Goodbye for now' })
  assert.equal((await service.searchMessages({ query: 'goodbye' })).results.length, 1)
  assert.ok(service.searchTextCharacters > 0)
  await service.leaveRoom({ roomKey: room.roomKey })
  assert.equal(service.searchTextCharacters, 0)
  assert.deepEqual((await service.searchMessages({ query: 'goodbye' })).results, [])
})

test('a search snippet is the words around the match, on one line', () => {
  assert.equal(normalizePeerChatSearchQuery('  LightHouse  '), 'lighthouse')
  assert.equal(normalizePeerChatSearchQuery(null), '')
  assert.equal(peerChatSearchSnippet('Short\nmessage', 'short'), 'Short message')
  const long = `${'word '.repeat(30)}the lighthouse is open ${'after '.repeat(30)}`
  const snippet = peerChatSearchSnippet(long, 'lighthouse')
  assert.ok(snippet.startsWith('…'))
  assert.ok(snippet.endsWith('…'))
  assert.ok(snippet.includes('the lighthouse is open'))
  assert.ok(snippet.length < long.length)
})

// Removing somebody moves a room to a new key, and what was said before the
// move is still the room's: the search finds it under the room as it is now.
test('a room that moved is searched with the history it had before', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-search-moved-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({
    sdk: createFakeSdk(new Map(), crypto.keyPair(Buffer.alloc(32, 41))),
    storagePath
  }).start()
  t.after(() => service.close())
  await service.loadSigningKeys()
  const room = await service.createRoom({ name: 'Garden', username: 'Ada' })
  await service.sendMessage({ roomKey: room.roomKey, message: 'Tomatoes before the move' })
  const moved = service.moveRoom(room.roomKey)
  assert.ok(moved, 'the room moved')
  await service.joinRoomNetwork(moved)
  await service.sendMessage({ roomKey: moved, message: 'Tomatoes after the move' })

  const { results } = await service.searchMessages({ query: 'tomatoes' })
  assert.deepEqual(results.map((result) => result.message), ['Tomatoes after the move', 'Tomatoes before the move'])
  for (const result of results) assert.equal(result.roomKey, moved)
})
