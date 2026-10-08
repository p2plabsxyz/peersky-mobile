// Someone already chatting with ada pressed Message on ada@mobile and sent a
// second request, to the same person, instead of opening the chat they had.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { PeerChatService } from '../../backend/peerchat/service.mjs'
import { chatWithPerson } from '../../backend/peerchat/person-chat.mjs'

const withAda = { roomKey: 'a', dmWith: '0a0a0a0a', partnerName: 'ada', members: ['0a0a0a0a', '0b0b0b0b', '0c0c0c0c'] }

test('messaging someone\'s other device opens the chat it is already in, with the same person', () => {
  assert.equal(chatWithPerson([withAda], '0b0b0b0b', 'ada@mobile'), withAda)
  assert.equal(chatWithPerson([withAda], '0B0B0B0B', 'Ada@desktop2'), withAda)
  const withPhone = { ...withAda, dmWith: '0b0b0b0b', partnerName: 'ada@mobile' }
  assert.equal(chatWithPerson([withPhone], '0a0a0a0a', 'ada'), withPhone)
  // A device in no chat, or there under someone else's name, is asked as before.
  assert.equal(chatWithPerson([withAda], '0e0e0e0e', 'ada@mobile'), null)
  assert.equal(chatWithPerson([withAda], '0c0c0c0c', 'grace@mobile'), null)
})

test('PeerChat opens your chat with ada when you message ada@mobile, and asks nobody', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-person-chat-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const service = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  await service.completeOnboarding({ username: 'grace' })
  const chat = 'ad'.repeat(32)
  service.rooms.set(chat, {
    roomKey: chat,
    name: 'ada',
    isDM: true,
    dmWith: '0a0a0a0a',
    pendingAcceptance: false,
    createdAt: 1,
    members: [
      { id: '0a0a0a0a', username: 'ada', bio: '', avatar: null },
      { id: '0b0b0b0b', username: 'ada@mobile', bio: '', avatar: null }
    ]
  })
  const before = service.rooms.size

  const opened = await service.createDirectMessage({ peerId: '0b0b0b0b', username: 'ada@mobile' })
  assert.equal(opened.room.roomKey, chat)
  assert.equal(service.rooms.size, before)

  // Your own devices share one chat with yourself, whichever you message.
  service.siblings.add('0d0d0d0d')
  service.siblings.add('0f0f0f0f')
  const yours = 'fe'.repeat(32)
  service.rooms.set(yours, {
    roomKey: yours,
    name: 'ada',
    isDM: true,
    dmWith: '0d0d0d0d',
    pendingAcceptance: false,
    createdAt: 1,
    members: [{ id: '0f0f0f0f', username: 'grace@desktop1', bio: '', avatar: null }]
  })
  assert.equal((await service.createDirectMessage({ peerId: '0f0f0f0f', username: 'grace@desktop1' })).room.roomKey, yours)
  // Not one your device is missing from, as with a reinstalled phone's old key.
  service.siblings.add('0a1b2c3d')
  const fresh = await service.createDirectMessage({ peerId: '0a1b2c3d', username: 'grace@mobile' })
  assert.notEqual(fresh.room.roomKey, yours)
  service.rooms.delete(fresh.room.roomKey)
  service.rooms.delete(yours)
  service.siblings.clear()

  // Someone else, in no chat of yours, still gets a request.
  const asked = await service.createDirectMessage({ peerId: '0e0e0e0e', username: 'sam' })
  assert.notEqual(asked.room.roomKey, chat)
  assert.equal(asked.room.pendingAcceptance, true)
  await service.close()
})

function createFakeSdk () {
  const feeds = new Map()
  const swarm = new EventEmitter()
  swarm.flush = async () => {}
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

class FakeFeed extends EventEmitter {
  constructor () {
    super()
    this.entries = []
  }

  get length () { return this.entries.length }
  get byteLength () { return Buffer.byteLength(JSON.stringify(this.entries)) }
  async ready () {}
  async append (entry) { this.entries.push(structuredClone(entry)); this.emit('append') }
  async get (index) { return structuredClone(this.entries[index]) }
  async close () {}
}
