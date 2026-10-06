import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { checkPeerChatContent } from '../../backend/peerchat/moderation.mjs'
import { encryptPeerChatMessage } from '../../backend/peerchat/protocol.mjs'
import { PeerChatService } from '../../backend/peerchat/service.mjs'

// A direct message is two people, either of whom can block the other, so the
// group filters stay out of it: threats, the word list and adult domain links
// all pass. Groups keep every filter. The spam limit holds in both.

const TEXT = 'please stfu you bastard, see pornhub.com'
const DM_KEY = 'd2'.repeat(32)

test('the content filters pass a direct message and hold in a group', () => {
  const direct = { abuseFilter: true, nsfwFilter: true, spamRateLimit: 10, directMessage: true }
  assert.deepEqual(checkPeerChatContent(TEXT, direct), { flagged: false, reason: '' })
  assert.equal(checkPeerChatContent('please stfu', null).flagged, true)
  assert.equal(checkPeerChatContent('you bastard', null).flagged, true)
  assert.equal(checkPeerChatContent('see pornhub.com', null).flagged, true)
  // A room's own settings cannot turn the adult domain list off.
  assert.equal(checkPeerChatContent('see pornhub.com', { abuseFilter: false, nsfwFilter: false }).flagged, true)
})

test('a direct message sends what a group refuses, and takes it in', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-dm-filters-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => service.close())
  service.setProfile({ username: 'Sam', bio: '' })

  const group = await service.createRoom({ name: 'Group', username: 'Sam' })
  await assert.rejects(service.sendMessage({ roomKey: group.roomKey, message: TEXT }), /Message blocked/)

  const peer = createFakePeer('ab12cd34', 'Alice', [group.roomKey, DM_KEY])
  service.peers.set(peer.connection, peer)
  service.rooms.set(DM_KEY, service.createDirectRoom({ roomKey: DM_KEY, peerId: peer.id, username: 'Alice', pendingAcceptance: false }))

  await service.sendMessage({ roomKey: DM_KEY, message: TEXT })
  await service.handlePeerMessage(peer, { id: 'dm-in', roomKey: DM_KEY, sn: 'Alice', ...encryptPeerChatMessage(TEXT, DM_KEY), ts: Date.now() })
  const dm = await service.getSnapshot({ roomKey: DM_KEY, version: -1 })
  assert.deepEqual(dm.messages.filter((message) => !message.system).map((message) => message.message), [TEXT, TEXT])

  await service.handlePeerMessage(peer, { id: 'group-in', roomKey: group.roomKey, sn: 'Alice', ...encryptPeerChatMessage(TEXT, group.roomKey), ts: Date.now() })
  const room = await service.getSnapshot({ roomKey: group.roomKey, version: -1 })
  assert.equal(room.messages.some((message) => message.message === TEXT), false)
  assert.equal(room.messages.filter((message) => message.system).length, 1)
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

function createFakePeer (id, username, rooms) {
  const connection = { destroyed: false, handshakeHash: Buffer.alloc(64, 9), publicKey: Buffer.alloc(32, 8) }
  return {
    active: true,
    connection,
    id,
    key: id.repeat(8),
    buffer: '',
    pendingMessages: 0,
    processing: Promise.resolve(),
    lastReceivedAt: Date.now(),
    initialSyncCount: 0,
    username,
    bio: '',
    avatar: null,
    rooms,
    controlRate: { count: 0, resetsAt: Date.now() + 60_000 },
    liveRate: { count: 0, resetsAt: Date.now() + 60_000 },
    transport: { send: () => true }
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
