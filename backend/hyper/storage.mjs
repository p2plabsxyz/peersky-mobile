import Corestore from 'corestore'
import { rmSync } from 'bare-fs'
import {
  closeHyperRuntime,
  getHyperRuntime,
  getHyperStoragePath,
  getPrivateHyperRuntime,
  getPrivateHyperStoragePath,
  withHyperRuntimeMaintenance,
  withHyperRuntimeOperation
} from './runtime.mjs'
import { resetHyperFetch, stopHyperAssetServer } from './fetch.mjs'
import {
  clearHyperArchive,
  listHyperArchive,
  removeHyperArchive
} from './archive.mjs'
import {
  clearDownloadedP2pCores,
  createRoutedP2pStorageRuntime,
  deleteRegisteredP2pAppData,
  listRegisteredP2pAppData
} from './storage-core.mjs'
import {
  removeHyperStoragePaths,
  runP2pAppDataDelete,
  runP2pCacheClear,
  runP2pDataClear
} from './storage-lifecycle.mjs'
import { closePeerChatService } from '../peerchat/runtime.mjs'

let storageTransition = Promise.resolve()

export async function listP2pAppData ({
  page = 1,
  pageSize = 5,
  archivePage = 1,
  archivePageSize = 5,
  archiveSource = 'all',
  includeAppData = true
} = {}, options = {}) {
  return withStorageTransition(async () => {
    const appData = includeAppData
      ? options.getRuntime
        ? await listRegisteredP2pAppData(await options.getRuntime(), { page, pageSize })
        : await withHyperRuntimeOperation(async (runtime) => (
          listRegisteredP2pAppData(
            await createP2pStorageRuntime(runtime),
            { page, pageSize }
          )
        ))
      : { ok: true }
    const archive = await (options.listArchive || listHyperArchive)({
      page: archivePage,
      pageSize: archivePageSize,
      source: archiveSource
    })

    return { ...appData, archive }
  })
}

export async function deleteP2pAppData ({ appId } = {}, options = {}) {
  return withStorageTransition(() => runP2pAppDataDelete({
    runExclusive: options.runExclusive || (options.getRuntime
      ? async (task) => task()
      : withHyperRuntimeMaintenance),
    getRuntime: options.getRuntime || createP2pStorageRuntime,
    deleteAppData: options.deleteAppData || deleteRegisteredP2pAppData,
    removeArchive: options.removeArchive || removeHyperArchive,
    appId
  }))
}

export async function clearP2pCache (options = {}) {
  return withStorageTransition(() => (
    options.getRuntime
      ? performP2pCacheClear(options)
      : withHyperRuntimeMaintenance(() => performP2pCacheClear(options))
  ))
}

export async function clearAllP2pData (options = {}) {
  return withStorageTransition(() => (
    options.getRuntime
      ? performAllP2pDataClear(options)
      : withHyperRuntimeMaintenance(() => performAllP2pDataClear(options))
  ))
}

async function performP2pCacheClear (options) {
  const getRuntime = options.getRuntime || getHyperRuntime
  const closeRuntime = options.closeRuntime || closeHyperRuntime
  const resetFetch = options.resetFetch || resetHyperFetch
  const stopAssetServer = options.stopAssetServer || stopHyperAssetServer
  const closeServices = options.closeServices || closePeerChatService
  const createStore = options.createStore || ((storagePath) => new Corestore(storagePath))

  const storagePath = options.storagePath || getHyperStoragePath()
  return runP2pCacheClear({
    getRuntime,
    storagePath,
    stopAssetServer,
    closeServices,
    closeRuntime,
    resetFetch,
    createStore,
    clearStore: clearDownloadedP2pCores,
    removeArchive: () => (options.removeArchive || removeHyperArchive)({ source: 'fetched' })
  })
}

function performAllP2pDataClear (options) {
  return runP2pDataClear({
    getRuntime: options.getRuntime || getHyperRuntime,
    getStoragePath: options.getStoragePath || getHyperStoragePath,
    stopAssetServer: options.stopAssetServer || stopHyperAssetServer,
    closeServices: options.closeServices || closePeerChatService,
    closeRuntime: options.closeRuntime || closeHyperRuntime,
    resetFetch: options.resetFetch || resetHyperFetch,
    removeStorage: options.removeStorage || ((storagePath) => removeHyperStoragePaths({
      storagePath,
      privateStoragePath: getPrivateHyperStoragePath(),
      removeStorage: (target) => rmSync(target, { recursive: true, force: true })
    })),
    clearArchive: options.clearArchive || clearHyperArchive
  })
}

async function createP2pStorageRuntime (mainRuntime = null) {
  const networkedRuntime = mainRuntime || await getHyperRuntime()
  return createRoutedP2pStorageRuntime(networkedRuntime, getPrivateHyperRuntime)
}

function withStorageTransition (task) {
  const next = storageTransition.then(task, task)
  storageTransition = next.catch(() => {})
  return next
}
