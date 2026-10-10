import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import crypto from 'hypercore-crypto'

import { PeerChatService } from '../../backend/peerchat/service.mjs'

// The browser's Send to your devices puts the page in your chat with yourself,
// starting that chat when there is none, and sends it once another of your
// devices takes the chat.

const PHONE = crypto.keyPair(Buffer.alloc(32, 7))
const SIBLING = 'cafe0001'
const PAGE = 'Peer-to-peer\nhttps://en.wikipedia.org/wiki/Peer-to-peer'

async function startService (t) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-send-to-devices-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const feeds = new Map()
  const service = await new PeerChatService({ sdk: createFakeSdk(feeds), storagePath }).start()
  t.after(() => service.close())
  await service.loadSigningKeys()
  service.setProfile({ username: 'Ada', bio: '' })
  service.profile.linkPreview = false
  return { service, feeds }
}

const written = (feeds, roomKey) => (feeds.get(`chat-${roomKey}`)?.entries || []).filter((entry) => entry.ct)

test('with no other device linked, nothing is sent and the app is told so', async (t) => {
  const { service } = await startService(t)
  const result = await service.sendToOwnDevices({ message: PAGE })
  assert.equal(result.sent, false)
  assert.equal(result.noDevices, true)
  assert.equal(service.rooms.size, 0)
})

test('the page goes into an accepted chat with yourself', async (t) => {
  const { service, feeds } = await startService(t)
  service.siblings.add(SIBLING)
  const roomKey = 'd4'.repeat(32)
  service.rooms.set(roomKey, service.createDirectRoom({ roomKey, peerId: SIBLING, username: 'Ada', pendingAcceptance: false }))
  await service.joinRoomNetwork(roomKey)

  const result = await service.sendToOwnDevices({ message: PAGE })
  assert.equal(result.sent, true)
  assert.equal(written(feeds, roomKey).length, 1)
})

test('with no chat yet, one is started and the page waits until your other device takes it', async (t) => {
  const { service, feeds } = await startService(t)
  service.siblings.add(SIBLING)

  const result = await service.sendToOwnDevices({ message: PAGE })
  assert.equal(result.waiting, true)
  const room = [...service.rooms.values()].find((candidate) => candidate.isDM && candidate.dmWith === SIBLING)
  assert.ok(room?.pendingAcceptance)
  assert.equal(written(feeds, room.roomKey).length, 0)

  // The other device accepts, as it does by itself for one of yours.
  const sibling = connect(service, SIBLING)
  await service.handlePeerMessage(sibling, { type: 'dm-accept', roomKey: room.roomKey, fromUsername: 'Ada' })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(room.pendingAcceptance, false)
  assert.equal(written(feeds, room.roomKey).length, 1)
  assert.equal(service.ownDeviceOutbox.length, 0)
})

function connect (service, id) {
  const peer = {
    active: true,
    sibling: true,
    connection: { destroyed: false, handshakeHash: Buffer.alloc(64, 9), publicKey: PHONE.publicKey },
    id,
    key: id.repeat(8),
    buffer: '',
    pendingMessages: 0,
    processing: Promise.resolve(),
    lastReceivedAt: Date.now(),
    username: 'Ada',
    bio: '',
    avatar: null,
    rooms: [],
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

function createFakeSdk (feeds) {
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

test('the browser menu sends the page with its title, and says what happened', async () => {
  const { readFile } = await import('node:fs/promises')
  const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
  const menu = await read('app/settings/BrowserOverflowMenu.tsx')
  assert.match(menu, /label='Send to Your Devices'/)
  const app = await read('app/index.tsx')
  assert.match(app, /callRpc\(RPC_PEERCHAT_SEND_TO_DEVICES, \{ message \}\)/)
  assert.match(app, /message: 'Link another device to send pages to it',\s+actionLabel: 'Link Device'/)
  assert.match(app, /response\.waiting \? 'It goes to your other device once that is online' : 'Sent to your devices'/)
  const router = await read('backend/rpc/router.mjs')
  assert.match(router, /await peerChat\.sendToOwnDevices\(parseJsonMessage\(req\.data\)\)/)
})
