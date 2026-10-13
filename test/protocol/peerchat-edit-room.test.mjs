import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { PeerChatService } from '../../backend/peerchat/service.mjs'

// Edit room on the phone: what the person who made a room sends when they
// change it, and what is refused. How the change travels is in
// peerchat-room-details-flow.test.mjs.

const PICTURE = 'data:image/png;base64,iVBORw0KGgo='

class FakeFeed extends EventEmitter {
  constructor () {
    super()
    this.entries = []
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

async function startService (t) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-edit-room-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const feeds = new Map()
  const swarm = new EventEmitter()
  swarm.flush = async () => {}
  const sdk = {
    publicKey: Buffer.alloc(32, 7),
    swarm,
    corestore: {
      get ({ name }) {
        if (!feeds.has(name)) feeds.set(name, new FakeFeed())
        return feeds.get(name)
      }
    },
    join () {},
    async leave () {}
  }
  const service = await new PeerChatService({ sdk, storagePath }).start()
  t.after(() => service.close())
  return service
}

test('the person who made a room changes all of it, and the list and the room show it', async (t) => {
  const service = await startService(t)
  const room = await service.createRoom({ name: 'Book club', bio: 'Monthly', username: 'Ada' })
  assert.equal(room.isCreator, true)

  const saved = service.updateRoom({
    roomKey: room.roomKey,
    name: 'Reading club',
    bio: 'Every week',
    link: 'https://example.org/club',
    avatar: PICTURE,
    moderation: { abuseFilter: false, nsfwFilter: true, spamRateLimit: 15 }
  })
  assert.equal(saved.room.name, 'Reading club')
  assert.equal(saved.room.bio, 'Every week')
  assert.equal(saved.room.link, 'https://example.org/club')
  assert.equal(saved.room.avatar, PICTURE)
  assert.deepEqual(saved.room.moderation, { abuseFilter: false, nsfwFilter: true, spamRateLimit: 15 })
  assert.equal(saved.rooms.find((entry) => entry.roomKey === room.roomKey).name, 'Reading club')

  // The picture taken away, and the link cleared.
  const cleared = service.updateRoom({ roomKey: room.roomKey, name: 'Reading club', bio: '', link: '', avatar: null })
  assert.equal(cleared.room.avatar, null)
  assert.equal(cleared.room.link, '')
  assert.equal(cleared.room.bio, '')
})

test('a refused change leaves the room as it was, and an empty name keeps the old one', async (t) => {
  const service = await startService(t)
  const room = await service.createRoom({ name: 'Book club', bio: 'Monthly', link: 'https://example.org', username: 'Ada' })

  assert.throws(
    () => service.updateRoom({ roomKey: room.roomKey, name: 'Changed', bio: 'Changed', link: 'javascript:alert(1)' }),
    /valid HTTP or HTTPS URL/
  )
  const after = service.listRooms().find((entry) => entry.roomKey === room.roomKey)
  assert.equal(after.name, 'Book club')
  assert.equal(after.bio, 'Monthly')
  assert.equal(after.link, 'https://example.org/')

  assert.throws(() => service.updateRoom({ roomKey: room.roomKey, avatar: 'not a picture' }), /room image/)
  assert.equal(service.listRooms().find((entry) => entry.roomKey === room.roomKey).name, 'Book club')

  const unnamed = service.updateRoom({ roomKey: room.roomKey, name: '   ' })
  assert.equal(unnamed.room.name, 'Book club')
})

test('nobody else changes a room, and a direct message has nothing to change', async (t) => {
  const service = await startService(t)
  await service.joinRoom({ roomKey: 'cd'.repeat(32), username: 'Ada' })
  assert.equal(service.listRooms().find((entry) => entry.roomKey === 'cd'.repeat(32)).isCreator, false)
  assert.throws(() => service.updateRoom({ roomKey: 'cd'.repeat(32), name: 'Mine now' }), /Only the person who made this room/)

  const { room } = await service.createDirectMessage({ peerId: 'cafef00d', username: 'Test Bea' })
  assert.throws(() => service.updateRoom({ roomKey: room.roomKey, name: 'Renamed' }), /direct message/)
})
