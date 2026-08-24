import Corestore from 'corestore'
import {
  closeHyperRuntime,
  getHyperRuntime,
  getHyperStoragePath,
  withHyperRuntimeMaintenance,
  withHyperRuntimeOperation
} from './runtime.mjs'
import { resetHyperFetch, stopHyperAssetServer } from './fetch.mjs'
import {
  clearDownloadedP2pCores,
  deleteRegisteredP2pAppData,
  listRegisteredP2pAppData
} from './storage-core.mjs'
import { runP2pCacheClear } from './storage-lifecycle.mjs'

let storageTransition = Promise.resolve()

export async function listP2pAppData ({ page = 1, pageSize = 5 } = {}, options = {}) {
  return withStorageTransition(async () => {
    if (options.getRuntime) {
      return listRegisteredP2pAppData(await options.getRuntime(), { page, pageSize })
    }
    return withHyperRuntimeOperation((runtime) => (
      listRegisteredP2pAppData(runtime, { page, pageSize })
    ))
  })
}

export async function deleteP2pAppData ({ appId } = {}, options = {}) {
  return withStorageTransition(async () => {
    if (options.getRuntime) {
      return deleteRegisteredP2pAppData(await options.getRuntime(), { appId })
    }
    return withHyperRuntimeOperation((runtime) => (
      deleteRegisteredP2pAppData(runtime, { appId })
    ))
  })
}

export async function clearP2pCache (options = {}) {
  return withStorageTransition(() => (
    options.getRuntime
      ? performP2pCacheClear(options)
      : withHyperRuntimeMaintenance(() => performP2pCacheClear(options))
  ))
}

async function performP2pCacheClear (options) {
  const getRuntime = options.getRuntime || getHyperRuntime
  const closeRuntime = options.closeRuntime || closeHyperRuntime
  const resetFetch = options.resetFetch || resetHyperFetch
  const stopAssetServer = options.stopAssetServer || stopHyperAssetServer
  const createStore = options.createStore || ((storagePath) => new Corestore(storagePath))

  const storagePath = options.storagePath || getHyperStoragePath()
  return runP2pCacheClear({
    getRuntime,
    storagePath,
    stopAssetServer,
    closeRuntime,
    resetFetch,
    createStore,
    clearStore: clearDownloadedP2pCores
  })
}

function withStorageTransition (task) {
  const next = storageTransition.then(task, task)
  storageTransition = next.catch(() => {})
  return next
}
