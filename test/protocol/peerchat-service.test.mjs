import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { PeerChatService } from '../../backend/peerchat/service.mjs'

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
  await service.close()
})

function createFakeSdk (feeds = new Map()) {
  const swarm = new EventEmitter()
  swarm.flush = async () => {}
  const localSwarm = new EventEmitter()
  const joined = []

  return {
    publicKey: Buffer.alloc(32, 7),
    swarm,
    localSwarm,
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

class FakeFeed extends EventEmitter {
  constructor (entries = []) {
    super()
    this.entries = entries
  }

  get length () {
    return this.entries.length
  }

  async ready () {}

  async append (entry) {
    this.entries.push(structuredClone(entry))
    this.emit('append')
  }

  async get (index) {
    return structuredClone(this.entries[index])
  }
}

function cloneFeeds (feeds) {
  return new Map([...feeds].map(([name, feed]) => [name, new FakeFeed(structuredClone(feed.entries))]))
}
