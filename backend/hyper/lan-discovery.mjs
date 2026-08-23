import HyperDHTmDNS from '@p2plabs/hyperdht-mdns'

let lan = null
let status = unavailableStatus()

export async function startLANDiscovery (runtime, options = {}) {
  if (lan && !lan.destroyed) return getLANDiscoveryStatus()

  const createLAN = options.createLAN || ((lanOptions) => new HyperDHTmDNS(lanOptions))
  const attach = options.attach || HyperDHTmDNS.attachHyperSDK
  const logger = options.logger || console
  const lanOptions = options.lanOptions || {}
  let next = null

  try {
    next = createLAN({
      ...lanOptions,
      keyPair: runtime.swarm.keyPair
    })
    wireLANEvents(next, logger)
    await next.ready()
    lan = await attach(runtime, { ...lanOptions, lan: next })
    status = {
      available: true,
      host: lan.host || '',
      port: lan.port || null
    }
  } catch (error) {
    lan = null
    status = unavailableStatus(error)
    logger.warn(`[LAN] Local discovery unavailable: ${errorMessage(error)}`)
    if (next && !next.destroyed) {
      await next.destroy().catch((cleanupError) => {
        logger.warn(`[LAN] Cleanup failed: ${errorMessage(cleanupError)}`)
      })
    }
  }

  return getLANDiscoveryStatus()
}

export function getLANDiscoveryStatus () {
  return { ...status }
}

export function resetLANDiscovery () {
  lan = null
  status = unavailableStatus()
}

function wireLANEvents (instance, logger) {
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

function errorMessage (error) {
  return error instanceof Error ? error.message : String(error)
}
