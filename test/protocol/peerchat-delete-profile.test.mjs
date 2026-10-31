import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'

import { attachmentDriveName } from '../../backend/peerchat/attachments.mjs'
import { legacyRoomLogName, roomLogName } from '../../backend/peerchat/room-log.mjs'
import { deletePeerChatProfile, removeEmptiedRoomLogs } from '../../backend/peerchat/runtime.mjs'
import { PeerChatService } from '../../backend/peerchat/service.mjs'

const ROOM_KEY = 'ab'.repeat(32)
const LEFT_ROOM_KEY = 'cd'.repeat(32)

// The store and drives are real: the fakes this used before let purge()
// pass, while the real one threw and removed nothing.
function createSdk (store) {
  const drives = new Map()
  return {
    publicKey: Buffer.alloc(32, 5),
    swarm: Object.assign(new EventEmitter(), { flush: async () => {} }),
    localSwarm: new EventEmitter(),
    corestore: store,
    namespace: (name) => store.namespace(name),
    async getDrive (name) {
      if (!drives.has(name)) {
        const drive = new Hyperdrive(store.namespace(name))
        await drive.ready()
        drives.set(name, drive)
      }
      return drives.get(name)
    },
    join () {},
    async leave () {}
  }
}

function feedAlias (store, name) {
  return { name, namespace: store.ns }
}

async function logLength (store, name) {
  const log = store.get({ name })
  await log.ready()
  const length = log.length
  await log.close()
  return length
}

async function startWithRoom (t, roomKey) {
  const storagePath = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-delete-'))
  const holder = { store: new Corestore(path.join(storagePath, 'store')) }
  t.after(async () => {
    await holder.store.close()
    await rm(storagePath, { recursive: true, force: true })
  })
  const sdk = createSdk(holder.store)
  const service = await new PeerChatService({ sdk, storagePath }).start()
  service.setProfile({ username: 'Ada', bio: 'Hello' })
  await service.joinRoom({ roomKey })
  await service.sendMessage({ roomKey, message: 'Hi there' })
  return { storagePath, holder, sdk, service }
}

// App Review asks that a profile made in the app can be deleted in the app.
// There is no server account, so this is everything PeerChat keeps here.
test('deleting the PeerChat profile leaves every room and removes what it kept', async (t) => {
  const { storagePath, holder: { store }, sdk, service } = await startWithRoom(t, ROOM_KEY)
  await service.blockPeer({ peerId: 'cd34cd34', username: 'Mallory' })
  service.persistNow()

  // A room left earlier keeps its log, out of the room list, here one an
  // older build kept under the room's key.
  const leftLog = store.get({ name: legacyRoomLogName(LEFT_ROOM_KEY), valueEncoding: 'json' })
  await leftLog.append({ id: 'old', ct: 'sealed' })
  await leftLog.close()

  // A file this phone sent in the room.
  const sent = await sdk.getDrive(attachmentDriveName(ROOM_KEY))
  await sent.put('/1-0123456789abcdef.bin', Buffer.alloc(4096, 1))

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
  // Every message is gone from storage at once, the left room's too.
  assert.equal(await logLength(store, roomLogName(ROOM_KEY)), 0)
  assert.equal(await logLength(store, legacyRoomLogName(LEFT_ROOM_KEY)), 0)
  // The sent file's contents are gone here, and its drive still takes files.
  assert.equal(await sent.blobs.core.has(0), false)
  assert.equal(sent.writable, true)
  assert.equal(existsSync(service.stateFilePath), false)
  assert.equal(existsSync(cache), false)

  // The next PeerChat to open here has no profile, no rooms, and no blocks.
  const fresh = await new PeerChatService({ sdk, storagePath }).start()
  t.after(() => fresh.close())
  assert.equal(fresh.getProfile().username || '', '')
  assert.deepEqual(fresh.listRooms(), [])
  assert.deepEqual(fresh.listBlockedPeers(), [])

  // The logs' names, which hold the rooms' keys, go on the app's next run.
  await removeEmptiedRoomLogs(fresh)
  assert.notEqual(await store.storage.getAlias(feedAlias(store, roomLogName(ROOM_KEY))), null)
  await removeEmptiedRoomLogs(fresh, { run: 'next' })
  for (const name of [roomLogName(ROOM_KEY), legacyRoomLogName(LEFT_ROOM_KEY)]) {
    assert.equal(await store.storage.getAlias(feedAlias(store, name)), null)
  }
  assert.equal(existsSync(path.join(storagePath, 'peerchat-emptied-logs.json')), false)
})

test('a room joined again right after a profile delete keeps its new messages', async (t) => {
  const { storagePath, holder, sdk, service } = await startWithRoom(t, ROOM_KEY)
  await deletePeerChatProfile({
    getService: async () => service,
    closeService: () => service.close()
  })

  // At once, while the emptied log may still be open in memory.
  const again = await new PeerChatService({ sdk, storagePath }).start()
  again.setProfile({ username: 'Grace' })
  await again.joinRoom({ roomKey: ROOM_KEY })
  await again.sendMessage({ roomKey: ROOM_KEY, message: 'Back again' })
  assert.equal(await logLength(holder.store, roomLogName(ROOM_KEY)), 1)
  await again.close()

  // The next run of the app: the room is in use again, so its log stays.
  await holder.store.close()
  holder.store = new Corestore(path.join(storagePath, 'store'))
  const next = await new PeerChatService({ sdk: createSdk(holder.store), storagePath }).start()
  t.after(() => next.close())
  await removeEmptiedRoomLogs(next, { run: 'next' })
  assert.equal(await logLength(holder.store, roomLogName(ROOM_KEY)), 1)
  assert.deepEqual(next.listRooms().map((room) => room.roomKey), [ROOM_KEY])
})
