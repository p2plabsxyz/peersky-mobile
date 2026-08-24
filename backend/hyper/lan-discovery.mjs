import HyperDHTmDNS from '@p2plabs/hyperdht-mdns'
import { createMobileMDNSOptions } from './mobile-mdns.mjs'

const DEFAULT_DISCOVERY_SETTLE_MS = 500
const READINESS_BARRIER = Symbol.for('peersky.hyperdht-mdns.readiness-barrier')

let lan = null
let lanOpening = null
let attachedRuntime = null
let status = unavailableStatus()
const discoveredPeers = new Map()
const activeConnections = new Map()

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
    addLANReadinessBarrier(next, options.readinessBarrierOptions)
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
    joinedTopics: countJoinedTopics(),
    activeConnections: countActiveConnections(),
    peers: [...discoveredPeers.values()].map((peer) => ({ ...peer }))
  }
}

export function resetLANDiscovery () {
  lan = null
  lanOpening = null
  attachedRuntime = null
  status = unavailableStatus()
  discoveredPeers.clear()
  activeConnections.clear()
}

// hyper-sdk uses swarm.flush() as the end of its initial peer search. The
// package's LAN flush currently completes independently of its queued mDNS TXT
// update, so an empty readable Hyperdrive can be reported before another phone
// sees the shared topic. Keep the package adapter isolated here and make both
// flush paths wait for publication plus a short multicast settling window.
export function addLANReadinessBarrier (instance, {
  settleMs = DEFAULT_DISCOVERY_SETTLE_MS,
  wait = delay
} = {}) {
  if (!instance || instance[READINESS_BARRIER]) return instance

  Object.defineProperty(instance, READINESS_BARRIER, {
    configurable: false,
    enumerable: false,
    value: true
  })

  if (typeof instance.flush === 'function') {
    const flush = instance.flush.bind(instance)
    instance.flush = async (...args) => {
      await waitForAdvertisement(instance)
      if (settleMs > 0) await wait(settleMs)
      return flush(...args)
    }
  }

  if (typeof instance.join === 'function') {
    const join = instance.join.bind(instance)
    instance.join = (...args) => {
      const session = join(...args)
      if (!session || typeof session.flushed !== 'function') return session

      const flushed = session.flushed.bind(session)
      session.flushed = async (...flushArgs) => {
        await waitForAdvertisement(instance)
        if (settleMs > 0) await wait(settleMs)
        return flushed(...flushArgs)
      }
      return session
    }
  }

  return instance
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
    if (peerKey) {
      discoveredPeers.delete(peerKey)
      activeConnections.delete(peerKey)
    }
  })
  instance.on('connection', (socket, peerInfo) => {
    rememberConnection(socket, peerInfo)
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

  const previous = discoveredPeers.get(publicKey)

  discoveredPeers.set(publicKey, {
    publicKey,
    host: typeof peer.host === 'string' ? peer.host : previous?.host || '',
    port: Number.isInteger(peer.port) ? peer.port : previous?.port || null,
    reachable: reachable || peer.reachable === true,
    connected: previous?.connected === true,
    activeConnections: activeConnections.get(publicKey)?.size || 0,
    sharedTopics: Array.isArray(peer.topics) ? peer.topics.length : previous?.sharedTopics || 0,
    lastConnected: previous?.lastConnected || null,
    lastSeen: Date.now()
  })
}

function rememberConnection (socket, peerInfo) {
  const publicKey = publicKeyHex(peerInfo?.publicKey || socket?.remotePublicKey)
  if (!publicKey) return

  const sockets = activeConnections.get(publicKey) || new Set()
  if (socket) sockets.add(socket)
  activeConnections.set(publicKey, sockets)

  const previous = discoveredPeers.get(publicKey)
  const relay = Array.isArray(peerInfo?.relayAddresses) ? peerInfo.relayAddresses[0] : null
  discoveredPeers.set(publicKey, {
    publicKey,
    host: typeof relay?.host === 'string' ? relay.host : previous?.host || '',
    port: Number.isInteger(relay?.port) ? relay.port : previous?.port || null,
    reachable: true,
    connected: true,
    activeConnections: sockets.size,
    sharedTopics: Array.isArray(peerInfo?.topics) ? peerInfo.topics.length : previous?.sharedTopics || 0,
    lastConnected: Date.now(),
    lastSeen: Date.now()
  })

  socket?.once?.('close', () => {
    const currentSockets = activeConnections.get(publicKey)
    currentSockets?.delete(socket)
    if (currentSockets?.size === 0) activeConnections.delete(publicKey)

    const current = discoveredPeers.get(publicKey)
    if (!current) return
    discoveredPeers.set(publicKey, {
      ...current,
      connected: (currentSockets?.size || 0) > 0,
      activeConnections: currentSockets?.size || 0,
      lastSeen: Date.now()
    })
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

async function waitForAdvertisement (instance) {
  const pending = instance?._advertisementQueue
  if (pending && typeof pending.then === 'function') await pending
}

function countJoinedTopics () {
  if (!lan || typeof lan.topics !== 'function') return 0

  try {
    return [...lan.topics()].length
  } catch {
    return 0
  }
}

function countActiveConnections () {
  let count = 0
  for (const sockets of activeConnections.values()) count += sockets.size
  return count
}

function delay (milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
