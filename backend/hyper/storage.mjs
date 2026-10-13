import Corestore from 'corestore'
import {
  closeHyperRuntime,
  getHyperRuntime,
  getHyperStoragePath,
  getPrivateHyperRuntime,
  getPrivateHyperStoragePath,
  getPrivateDriveWarningForDriveId,
  getPrivateDriveWarnings,
  getSyncedPrivateHyperdrive,
  getSyncedPrivateHyperStoragePath,
  holdHyperStores,
  withHyperRuntimeMaintenance,
  withHyperRuntimeOperation
} from './runtime.mjs'
import { adoptedStoragePathFor, normalizeDriveAddressId } from './runtime-routing.mjs'
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
  runP2pAppDataDelete,
  runP2pCacheClear,
  runP2pDataClear,
  runP2pIdentityClear
} from './storage-lifecycle.mjs'
import { beginP2pReset, finishP2pReset, listP2pResetTargets, recoverP2pReset } from './p2p-reset.mjs'
import { hasPrivateDriveKey, resetPrivateDriveKeyCache } from './private-keys.mjs'
import { resetLinkedPrivateDrivesCache } from './linked-private-drives.mjs'
import { resetDeviceSyncStateCache } from './device-sync-state.mjs'
import { closePeerChatService } from '../peerchat/runtime.mjs'
import { closeHyperOfflineDownloads } from './offline-manager.mjs'
import { getDefaultIdentityStoragePath } from '../backup/device-keys.mjs'
import { discardPendingRestore, stopOutgoingTransfer } from '../backup/link-device.mjs'
import { disconnectP2pmdRoom } from '../p2pmd/room.mjs'

let storageTransition = Promise.resolve()

export async function listP2pAppData ({
  page = 1,
  pageSize = 5,
  archivePage = 1,
  archivePageSize = 5,
  archiveQuery = '',
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
      query: archiveQuery,
      source: archiveSource
    })

    return attachP2pDriveWarnings({ ...appData, archive })
  })
}

function attachP2pDriveWarnings (response) {
  const warnings = getPrivateDriveWarnings()
  if (warnings.length === 0 || typeof response !== 'object') return response

  for (const item of Array.isArray(response.items) ? response.items : []) {
    if (!Array.isArray(item.drives)) continue
    for (const driveSummary of item.drives) {
      const driveId = normalizeDriveAddressId(driveSummary.url)
      if (!driveId) continue
      const warning = getPrivateDriveWarningForDriveId(driveId)
      if (warning) driveSummary.warning = warning
    }
  }

  return { ...response, warning: warnings[0].message }
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
      : withHyperRuntimeMaintenance(
        () => performP2pCacheClear(options),
        closeHyperOfflineDownloads
      )
  ))
}

/**
 * Settings, P2P Data, Clear all P2P data: every store, and this device's
 * identity with them (p2p-reset.mjs has the list). The app shows its restart
 * screen first and asks for a fresh start after, as for Remove my data from
 * this phone in Link Device, because what is on screen still belongs to the
 * identity that went.
 */
export async function clearAllP2pData (options = {}) {
  return withStorageTransition(() => {
    const plan = getP2pResetPlan()
    return runP2pIdentityClear({
      beginReset: () => beginP2pReset(plan.identityPath),
      stopLinkDevice: async () => {
        discardPendingRestore()
        await stopOutgoingTransfer()
      },
      disconnectNotes: disconnectP2pmdRoom,
      runMaintenance: options.getRuntime
        ? (task) => task()
        : (task) => withHyperRuntimeMaintenance(task, closeHyperOfflineDownloads),
      clearData: () => performAllP2pDataClear(options, plan)
    })
  })
}

/**
 * Finishes a clear the app was killed in. Run as the backend starts, before
 * anything can open a store.
 */
export function recoverInterruptedP2pReset () {
  try {
    if (recoverP2pReset(getP2pResetPlan())) console.warn('[hyper] Finished clearing P2P data, which was cut short')
  } catch (error) {
    console.error('[hyper] Could not finish clearing P2P data:', error)
  }
}

function getP2pResetPlan () {
  const identityPath = getDefaultIdentityStoragePath()
  const syncedPrivatePath = getSyncedPrivateHyperStoragePath()
  return {
    identityPath,
    targets: listP2pResetTargets({
      identityPath,
      stores: [
        getHyperStoragePath(),
        getPrivateHyperStoragePath(),
        syncedPrivatePath,
        // Drives a desktop sent, in a store of their own beside the private one.
        syncedPrivatePath ? adoptedStoragePathFor(syncedPrivatePath) : null
      ]
    })
  }
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

function performAllP2pDataClear (options, plan) {
  return runP2pDataClear({
    getRuntime: options.getRuntime || getHyperRuntime,
    getStoragePath: options.getStoragePath || getHyperStoragePath,
    holdStores: options.holdStores || holdHyperStores,
    stopAssetServer: options.stopAssetServer || stopHyperAssetServer,
    closeServices: options.closeServices || closePeerChatService,
    closeRuntime: options.closeRuntime || closeHyperRuntime,
    resetFetch: options.resetFetch || resetHyperFetch,
    removeStorage: options.removeStorage || (() => {
      const { failed } = finishP2pReset(plan)
      // Read again from what is left, not from before.
      resetPrivateDriveKeyCache()
      resetLinkedPrivateDrivesCache()
      resetDeviceSyncStateCache()
      return failed.length > 0
        ? { warning: `P2P data was cleared, but ${failed.length === 1 ? 'one item' : `${failed.length} items`} could not be removed.` }
        : null
    }),
    clearArchive: options.clearArchive || clearHyperArchive
  })
}

async function createP2pStorageRuntime (mainRuntime = null) {
  const networkedRuntime = mainRuntime || await getHyperRuntime()
  return createRoutedP2pStorageRuntime(networkedRuntime, getPrivateHyperRuntime, () => getSyncedPrivateHyperdrive(), {
    hasPrivateDrive: () => hasPrivateDriveKey(getSyncedPrivateHyperStoragePath())
  })
}

function withStorageTransition (task) {
  const next = storageTransition.then(task, task)
  storageTransition = next.catch(() => {})
  return next
}
