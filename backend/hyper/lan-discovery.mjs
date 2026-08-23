import HyperDHTmDNS from '@p2plabs/hyperdht-mdns'
import { createMobileMDNSOptions } from './mobile-mdns.mjs'

let lan = null
let lanOpening = null
let attachedRuntime = null
let status = unavailableStatus()
const discoveredPeers = new Map()

export async function startLANDiscovery (runtime = null, options = {}) {
  if (lanOpening) await lanOpening

  if (!lan || lan.destroyed) {
    lanOpening = openLANDiscovery(runtime, options)
    try {
      await lanOpening
    } finally {
      lanOpening = null
    }
  }

  if (runtime && lan && !lan.destroyed && attachedRuntime !== runtime) {
    const attach = options.attach || HyperDHTmDNS.attachHyperSDK
    try {
      lan = await attach(runtime, { ...options.lanOptions, lan })
      attachedRuntime = runtime
      updateAvailableStatus()
    } catch (error) {
      status = unavailableStatus(error)
      options.logger?.warn?.(`[LAN] SDK attachment failed: ${errorMessage(error)}`)
    }
  }

  return getLANDiscoveryStatus()
}

async function openLANDiscovery (runtime, options) {
  const createLAN = options.createLAN || ((lanOptions) => new HyperDHTmDNS(lanOptions))
  const logger = options.logger || console
  const lanOptions = options.lanOptions || {}
  const host = lanOptions.host || HyperDHTmDNS.selectLocalIPv4()
  const mdnsOptions = lanOptions.mdnsOptions || createMobileMDNSOptions(host)
  const keyPair = runtime?.swarm?.keyPair
  let next = null

  try {
    next = createLAN({
      ...lanOptions,
      host,
      mdnsOptions,
      ...(keyPair ? { keyPair } : {})
    })
    wireLANEvents(next, logger)
    await next.ready()
    lan = next
    attachedRuntime = null
    updateAvailableStatus()
  } catch (error) {
    lan = null
    attachedRuntime = null
    status = unavailableStatus(error)
    logger.warn(`[LAN] Local discovery unavailable: ${errorMessage(error)}`)
    if (next && !next.destroyed) {
      await next.destroy().catch((cleanupError) => {
        logger.warn(`[LAN] Cleanup failed: ${errorMessage(cleanupError)}`)
      })
    }
  }
}

export function getLANDiscoveryStatus () {
  return {
    ...status,
    peers: [...discoveredPeers.values()].map((peer) => ({ ...peer }))
  }
}

export function resetLANDiscovery () {
  lan = null
  lanOpening = null
  attachedRuntime = null
  status = unavailableStatus()
  discoveredPeers.clear()
}

function updateAvailableStatus () {
  status = {
    available: true,
    host: lan.host || '',
    port: lan.port || null,
    publicKey: publicKeyHex(lan.keyPair?.publicKey)
  }
}

function wireLANEvents (instance, logger) {
  instance.on('peer', (peer) => {
    rememberPeer(peer, false)
  })
  instance.on('peer-reachable', (peer) => {
    rememberPeer(peer, true)
  })
  instance.on('peer-down', (service) => {
    const peerKey = servicePeerKey(service)
    if (peerKey) discoveredPeers.delete(peerKey)
  })
  instance.on('warning', (error) => {
    logger.warn(`[LAN] ${errorMessage(error)}`)
  })
  instance.on('error', (error) => {
    logger.error(`[LAN] ${errorMessage(error)}`)
  })
}

function unavailableStatus (error) {
  return {
    available: false,
    error: error ? errorMessage(error) : ''
  }
}

function rememberPeer (peer, reachable) {
  const publicKey = publicKeyHex(peer?.publicKey)
  if (!publicKey) return

  discoveredPeers.set(publicKey, {
    publicKey,
    host: typeof peer.host === 'string' ? peer.host : '',
    port: Number.isInteger(peer.port) ? peer.port : null,
    reachable: reachable || peer.reachable === true,
    sharedTopics: Array.isArray(peer.topics) ? peer.topics.length : 0,
    lastSeen: Date.now()
  })
}

function servicePeerKey (service) {
  return publicKeyHex(service?.txt?.peerKey)
}

function publicKeyHex (publicKey) {
  if (typeof publicKey === 'string' && /^[0-9a-f]{64}$/i.test(publicKey)) {
    return publicKey.toLowerCase()
  }
  if (!publicKey || typeof publicKey.toString !== 'function') return ''

  const value = publicKey.toString('hex')
  return /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : ''
}

function errorMessage (error) {
  return error instanceof Error ? error.message : String(error)
}
