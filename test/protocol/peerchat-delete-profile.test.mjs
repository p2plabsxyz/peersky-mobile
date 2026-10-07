import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { attachmentDriveName } from '../../backend/peerchat/attachments.mjs'
import { deletePeerChatProfile } from '../../backend/peerchat/runtime.mjs'
import { PeerChatService } from '../../backend/peerchat/service.mjs'

const ROOM_KEY = 'ab'.repeat(32)

class FakeFeed extends EventEmitter {
  constructor () {
    super()
    this.entries = []
    this.purged = false
  }

  get length () { return this.entries.length }
  async ready () {}
  async get (index) { return this.entries[index] }
  async append (entry) { this.entries.push(entry); this.emit('append') }
  async close () {}
  async purge () { this.purged = true; this.entries = [] }
}

function createFakeSdk () {
  const feeds = new Map()
  const drives = new Map()
  const sdk = {
    publicKey: Buffer.alloc(32, 5),
    swarm: Object.assign(new EventEmitter(), { flush: async () => {} }),
    localSwarm: new EventEmitter(),
    feeds,
    drives,
    corestore: {
      get ({ name }) {
        if (!feeds.has(name)) feeds.set(name, new FakeFeed())
        return feeds.get(name)
      }
    },
    async getDrive (name) {
      if (!drives.has(name)) drives.set(name, { purged: false, async purge () { this.purged = true } })
      return drives.get(name)
    },
    join () {},
    async leave () {}
  }
  return sdk
}

// App Review asks that a profile made in the app can be deleted in the app.
// There is no server account, so this is everything PeerChat keeps here.
test('deleting the PeerChat profile leaves every room and removes what it kept', async (t) => {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-delete-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))
  const sdk = createFakeSdk()
  const service = await new PeerChatService({ sdk, storagePath }).start()
  service.setProfile({ username: 'Ada', bio: 'Hello' })
  await service.joinRoom({ roomKey: ROOM_KEY })
  await service.sendMessage({ roomKey: ROOM_KEY, message: 'Hi there' })
  await service.blockPeer({ peerId: 'cd34cd34', username: 'Mallory' })
  service.persistNow()

  const cache = path.join(storagePath, 'peerchat-attachment-cache')
  await mkdir(cache, { recursive: true })
  await writeFile(path.join(cache, 'photo.jpg'), 'decrypted bytes')
  assert.equal(existsSync(service.stateFilePath), true)

  const leaves = []
  const relay = service.relayToRoom.bind(service)
  service.relayToRoom = (roomKey, frame) => {
    if (frame.type === 'leave') leaves.push(roomKey)
    return relay(roomKey, frame)
  }
  let closed = false
  const result = await deletePeerChatProfile({
    getService: async () => service,
    closeService: async () => { closed = true; await service.close() }
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(closed, true)
  // Each room heard this device go, the way a normal leave sounds.
  assert.ok(leaves.includes(ROOM_KEY))
  // Its messages and attachments are gone from storage, not just hidden.
  assert.equal(sdk.feeds.get(`chat-${ROOM_KEY}`).purged, true)
  assert.equal(sdk.drives.get(attachmentDriveName(ROOM_KEY)).purged, true)
  assert.equal(existsSync(service.stateFilePath), false)
  assert.equal(existsSync(cache), false)

  // The next PeerChat to open here has no profile, no rooms, and no blocks.
  const fresh = await new PeerChatService({ sdk: createFakeSdk(), storagePath }).start()
  t.after(() => fresh.close())
  assert.equal(fresh.getProfile().username || '', '')
  assert.deepEqual(fresh.listRooms(), [])
  assert.deepEqual(fresh.listBlockedPeers(), [])
})
