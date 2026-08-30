import { getHyperRuntime, getHyperStoragePath } from '../hyper/runtime.mjs'
import { PeerChatService } from './service.mjs'

let service = null
let serviceOpening = null

export async function getPeerChatService () {
  const sdk = await getHyperRuntime()
  if (service?.sdk === sdk) return service

  if (!serviceOpening) {
    serviceOpening = (async () => {
      const previousService = service
      service = null
      if (previousService) await previousService.close()
      const nextService = new PeerChatService({
        sdk,
        storagePath: getHyperStoragePath() || 'hyper-storage'
      })
      try {
        await nextService.start()
      } catch (error) {
        await nextService.close().catch(() => {})
        throw error
      }
      service = nextService
      return nextService
    })()
  }

  try {
    return await serviceOpening
  } finally {
    serviceOpening = null
  }
}

export async function closePeerChatService () {
  const activeService = service || (serviceOpening ? await serviceOpening.catch(() => null) : null)
  service = null
  serviceOpening = null
  await activeService?.close()
}
