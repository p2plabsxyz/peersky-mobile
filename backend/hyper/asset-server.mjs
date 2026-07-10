import http from 'bare-http1'
import { createHyperAssetServer } from './asset-server-core.mjs'

let assetServer = null
let assetServerInfo = null
let assetServerTransition = Promise.resolve()
const HYPER_ASSET_HOST = '127.0.0.1'

export { createHyperAssetServer } from './asset-server-core.mjs'

export async function startHyperAssetServer (fetch) {
  return withAssetServerTransition(async () => {
    if (assetServer && assetServerInfo) return assetServerInfo

    const instance = createHyperAssetServer({ fetch, httpImpl: http })

    try {
      const address = await listen(instance)
      const port = typeof address === 'object' && address ? address.port : null

      if (!Number.isInteger(port) || port < 1) {
        throw new Error('Hyper asset server started without a valid port')
      }

      assetServer = instance
      assetServerInfo = {
        host: HYPER_ASSET_HOST,
        port,
        localUrl: `http://${HYPER_ASSET_HOST}:${port}`
      }

      return assetServerInfo
    } catch (error) {
      try {
        instance.close()
      } catch {}

      throw error
    }
  })
}

export async function stopHyperAssetServer () {
  return withAssetServerTransition(async () => {
    assetServerInfo = null

    if (!assetServer) return

    const existing = assetServer
    assetServer = null

    await new Promise((resolve, reject) => {
      existing.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  })
}

function withAssetServerTransition (task) {
  const next = assetServerTransition.then(task, task)
  assetServerTransition = next.catch(() => {})
  return next
}

async function listen (server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve(server.address())
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, HYPER_ASSET_HOST)
  })
}
