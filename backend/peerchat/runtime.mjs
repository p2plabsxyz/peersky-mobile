import { join } from 'node:path'
import { getHyperRuntime, getHyperStoragePath } from '../hyper/runtime.mjs'
import { getDefaultIdentityStoragePath } from '../backup/device-keys.mjs'
import { PEERCHAT_INCOMING_FILE } from './device-link.mjs'
import { PeerChatService } from './service.mjs'

let service = null
let serviceOpening = null
let serviceClosing = null
let serviceGeneration = 0

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
