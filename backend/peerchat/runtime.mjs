import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { getHyperRuntime, getHyperStoragePath } from '../hyper/runtime.mjs'
import { getDefaultIdentityStoragePath } from '../backup/device-keys.mjs'
import { attachmentDriveName, getAttachmentCacheDirectory } from './attachments.mjs'
import { PEERCHAT_INCOMING_FILE } from './device-link.mjs'
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
  if (serviceClosing) await serviceClosing
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
      if (generation !== serviceGeneration) {
        await nextService.close()
        throw new Error('PeerChat service was reset.')
      }
      service = nextService
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
  removeFile = (path) => rmSync(path, { recursive: true, force: true })
} = {}) {
  const peerChat = await getService()
  const { sdk, stateFilePath, storagePath } = peerChat
  const roomKeys = await peerChat.leaveAllRooms()
  await closeService()

  for (const roomKey of roomKeys) await purgePeerChatRoom(sdk, roomKey)
  removeFile(stateFilePath)
  removeFile(getAttachmentCacheDirectory(storagePath))
  return { ok: true }
}

async function purgePeerChatRoom (sdk, roomKey) {
  try {
    const feed = sdk.corestore.get({ name: `chat-${roomKey}` })
    await feed.ready()
    await feed.purge()
  } catch (error) {
    console.warn('[peerchat] Could not remove a room feed:', error?.message || error)
  }
  try {
    const drive = await sdk.getDrive(attachmentDriveName(roomKey))
    await drive.purge()
  } catch (error) {
    console.warn('[peerchat] Could not remove a room drive:', error?.message || error)
  }
}
