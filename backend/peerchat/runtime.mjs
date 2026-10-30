import { randomBytes } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import b4a from 'b4a'
import { getHyperRuntime, getHyperStoragePath, waitForHyperStores } from '../hyper/runtime.mjs'
import { waitForChatSealKey } from '../hyper/sealed-file.mjs'
import { getExistingNamedDrive } from '../hyper/storage-core.mjs'
import { getDefaultIdentityStoragePath } from '../backup/device-keys.mjs'
import { attachmentDriveName, getAttachmentCacheDirectory } from './attachments.mjs'
import { PEERCHAT_INCOMING_FILE } from './device-link.mjs'
import { legacyRoomLogName, listStoredRoomLogs, removeStoredLog, roomLogName } from './room-log.mjs'
import { PeerChatService } from './service.mjs'

let service = null
let serviceOpening = null
let serviceClosing = null
let serviceGeneration = 0
// Whether the app is in the background, kept here so a PeerChat that opens
// later starts out knowing.
let idle = false

/**
 * Away from the app or back, from the app's own state. It never opens
 * PeerChat for someone who does not use it.
 */
export function setPeerChatIdle (value) {
  idle = value === true
  service?.setIdle(idle)
}

export async function getPeerChatService () {
  // PeerChat's file and logs are locked with the chat key, which a phone
  // started while locked gives the app only at the unlock: PeerChat waits for
  // it then, rather than start with nothing and write that over its chats.
  // One that can no longer be read throws.
  if (!service) await waitForChatSealKey()
  if (serviceClosing) await serviceClosing
  // A clear or a restore holds the stores shut while it closes PeerChat and
  // removes or replaces its files, and the store itself stays open a moment
  // after PeerChat closes. A PeerChat started in that moment, by the chat
  // screen asking for its rooms, read the files that were going and wrote
  // them back afterwards, so a cleared profile and its rooms came back.
  if (!service) await waitForHyperStores()
  const generation = serviceGeneration
  const sdk = await getHyperRuntime()
  if (serviceClosing) {
    await serviceClosing
    return getPeerChatService()
  }
  if (generation !== serviceGeneration) throw new Error('PeerChat service was reset.')
  if (service?.sdk === sdk) return service

  if (!serviceOpening) {
    const opening = (async () => {
      const previousService = service
      service = null
      if (previousService) await previousService.close()
      const nextService = new PeerChatService({
        sdk,
        storagePath: getHyperStoragePath() || 'hyper-storage',
        // A restore puts what it brings in the identity folder.
        incomingPath: join(getDefaultIdentityStoragePath(), PEERCHAT_INCOMING_FILE)
      })
      nextService.setIdle(idle)
      try {
        await nextService.start()
      } catch (error) {
        await nextService.close().catch(() => {})
        throw error
      }
      await removeEmptiedRoomLogs(nextService).catch((error) => {
        console.warn('[peerchat] Could not finish removing room logs:', error?.message || error)
      })
      if (generation !== serviceGeneration) {
        await nextService.close()
        throw new Error('PeerChat service was reset.')
      }
      service = nextService
      // The logs of rooms that are off the list, moved off their room keys
      // too, after PeerChat is up.
      nextService.moveLeftRoomLogs().catch((error) => {
        console.warn('[peerchat] Could not move old room logs:', error?.message || error)
      })
      return nextService
    })()
    serviceOpening = opening
  }

  const opening = serviceOpening
  try {
    return await opening
  } finally {
    if (serviceOpening === opening) serviceOpening = null
  }
}

/**
 * PeerChat for a transfer to another of this person's devices, or null when
 * there is no PeerChat name here yet.
 */
export async function exportPeerChatTransfer (targetType) {
  const peerChat = await getPeerChatService()
  return peerChat.exportTransfer({ targetType })
}

export async function closePeerChatService () {
  if (serviceClosing) return serviceClosing
  serviceGeneration += 1

  const previousService = service
  const opening = serviceOpening
  service = null
  serviceOpening = null

  const closing = (async () => {
    const openedService = opening ? await opening.catch(() => null) : null
    const concurrentlyAssignedService = service
    service = null

    const services = new Set([
      previousService,
      openedService,
      concurrentlyAssignedService
    ])
    services.delete(null)
    const results = await Promise.allSettled([...services].map((activeService) => activeService.close()))
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  })()
  serviceClosing = closing

  try {
    await closing
  } finally {
    if (serviceClosing === closing) serviceClosing = null
  }
}

/**
 * Removes everything PeerChat keeps on this device: the profile, every room
 * with its messages and attachments, requests and blocks. Each room hears that
 * this device left. What was already sent stays with the people it reached,
 * and the next PeerChat to open here starts from the welcome screen.
 */
export async function deletePeerChatProfile ({
  getService = getPeerChatService,
  closeService = closePeerChatService,
  removeFile = (path) => rmSync(path, { recursive: true, force: true }),
  run = RUN_ID
} = {}) {
  const peerChat = await getService()
  const { sdk, stateFilePath, storagePath } = peerChat
  const roomKeys = await peerChat.leaveAllRooms()
  // Rooms left earlier kept their messages here too, so every room log on
  // the phone goes, not only the rooms in the list.
  const known = new Set([...roomKeys, ...peerChat.leftRooms.keys(), ...peerChat.removedRooms.keys()])
  await closeService()

  const emptied = []
  for (const { name, roomKey } of await listStoredRoomLogs(sdk.corestore)) {
    if (roomKey) known.add(roomKey)
    try {
      const discoveryKey = await emptyRoomLog(sdk.corestore, name)
      if (discoveryKey) emptied.push(discoveryKey)
    } catch (error) {
      console.warn('[peerchat] Could not remove a room feed:', error?.message || error)
    }
  }
  for (const roomKey of known) await clearRoomDrive(sdk, roomKey)
  if (emptied.length > 0) rememberEmptiedRoomLogs(storagePath, emptied, run)
  removeFile(stateFilePath)
  removeFile(getAttachmentCacheDirectory(storagePath))
  return { ok: true }
}

// Which run of the app this is. See removeEmptiedRoomLogs.
const RUN_ID = b4a.toString(randomBytes(8), 'hex')
const EMPTIED_ROOM_LOGS_FILE = 'peerchat-emptied-logs.json'

// The files this phone sent in a room, which the people in it fetch from
// here. Their contents go and the drive stays: one made again under the same
// key would clash with the copies those people keep.
async function clearRoomDrive (sdk, roomKey) {
  try {
    const drive = await getExistingNamedDrive(sdk, { driveName: attachmentDriveName(roomKey) })
    if (drive) await drive.clearAll()
  } catch (error) {
    console.warn('[peerchat] Could not remove a room drive:', error?.message || error)
  }
}

// A room's messages are in one log that only this phone writes. Every one
// of them goes now, and the log stays, so the room joined again starts it
// over. Its name goes later, in removeEmptiedRoomLogs. This used to call
// purge(), which throws in hypercore 11 before it removes anything, so every
// room's messages and sent files stayed on the phone. Returns the emptied
// log's discovery key.
async function emptyRoomLog (store, name) {
  if (!await store.storage.getAlias({ name, namespace: store.ns })) return null
  const log = store.get({ name })
  try {
    await log.ready()
    if (log.length > 0) await log.truncate(0)
    return b4a.toString(log.discoveryKey, 'hex')
  } finally {
    await log.close()
  }
}

function rememberEmptiedRoomLogs (storagePath, discoveryKeys, run) {
  const path = join(storagePath, EMPTIED_ROOM_LOGS_FILE)
  let earlier = []
  try {
    earlier = JSON.parse(readFileSync(path, 'utf8')).discoveryKeys
  } catch {}
  const all = new Set([...(Array.isArray(earlier) ? earlier : []), ...discoveryKeys])
  writeFileSync(path, JSON.stringify({ version: 1, run, discoveryKeys: [...all] }))
}

/**
 * The names of the room logs a profile delete emptied, which hold the rooms'
 * keys, so nothing on the phone still says which rooms it was in. They go
 * on the app's next run, as PeerChat opens: until then the emptied logs can
 * still be open in memory, and with the name gone under an open log, a room
 * joined again at once wrote to a log the next start no longer had. A room
 * joined again since keeps its log.
 */
export async function removeEmptiedRoomLogs (service, { run = RUN_ID } = {}) {
  const path = join(service.storagePath, EMPTIED_ROOM_LOGS_FILE)
  let emptied
  try {
    emptied = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return
  }
  if (emptied?.run === run) return

  const discoveryKeys = new Set(Array.isArray(emptied?.discoveryKeys) ? emptied.discoveryKeys : [])
  const store = service.sdk.corestore
  // A room joined again since keeps its log, under either name.
  const inUse = new Set()
  for (const roomKey of new Set([...service.rooms.keys(), ...service.feeds.keys()])) {
    inUse.add(roomLogName(roomKey))
    inUse.add(legacyRoomLogName(roomKey))
  }
  for (const { name, discoveryKey } of await listStoredRoomLogs(store)) {
    if (!discoveryKeys.has(b4a.toString(discoveryKey, 'hex')) || inUse.has(name)) continue
    await removeStoredLog(store, name, discoveryKey)
  }
  rmSync(path, { force: true })
}
