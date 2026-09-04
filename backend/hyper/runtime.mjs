/* global Bare */

import Hyperdrive from 'hyperdrive'
import { create as createSDK } from 'hyper-sdk'
import {
  getLANDiscoveryStatus,
  resetLANDiscovery,
  startLANDiscovery
} from './lan-discovery.mjs'
import {
  getPrivateDriveKey,
  resetPrivateDriveKeyCache
} from './private-keys.mjs'
import {
  closeRuntimeCandidates,
  createRuntimeCoordinator,
  initializeRuntimeCandidate
} from './runtime-coordinator.mjs'
import {
  createPrivateHyperRuntimeOptions,
  createSyncedPrivateHyperRuntimeOptions,
  matchesHyperdriveAddress
} from './runtime-routing.mjs'
import {
  getExistingNamedDrive,
  HYPERDRIVE_DEVICE_DRIVE_NAME,
  HYPERDRIVE_PRIVATE_DRIVE_NAME
} from './storage-core.mjs'

let sdk = null
let sdkOpening = null
let storagePath = null
let deviceOnlySdk = null
let deviceOnlySdkOpening = null
let deviceOnlyStoragePath = null
let deviceOnlyDriveId = null
let syncedPrivateSdk = null
let syncedPrivateSdkOpening = null
let syncedPrivateStoragePath = null
let syncedPrivateDriveId = null
const runtimeCoordinator = createRuntimeCoordinator()

export function withHyperRuntimeOperation (task) {
  return runtimeCoordinator.runOperation(async () => task(await getHyperRuntime()))
}

export function withPrivateHyperRuntimeOperation (task) {
  return runtimeCoordinator.runOperation(async () => task(await getPrivateHyperRuntime()))
}

export function withSyncedPrivateHyperRuntimeOperation (task) {
  return runtimeCoordinator.runOperation(async () => task(await getSyncedPrivateHyperRuntime()))
}

export function withHyperRuntimeForAddress (address, task) {
  return runtimeCoordinator.runOperation(async () => {
    const deviceOnlyRuntime = await getPrivateHyperRuntime()
    const syncedRuntime = await getSyncedPrivateHyperRuntime()
    if (isDeviceOnlyHyperdriveAddress(address)) return task(deviceOnlyRuntime)
    if (isSyncedPrivateHyperdriveAddress(address)) return task(syncedRuntime)
    return task(await getHyperRuntime())
  })
}

export function withHyperRuntimeMaintenance (task) {
  return runtimeCoordinator.runMaintenance(task)
}

export async function getHyperRuntime () {
  if (sdk) return sdk

  if (!sdkOpening) {
    storagePath = getHyperSdkStoragePath()
    sdkOpening = createSDK({ storage: storagePath })
      .then(async (runtime) => {
        await startLANDiscovery(runtime)
        sdk = runtime
        return runtime
      })
  }

  try {
    return await sdkOpening
  } finally {
    sdkOpening = null
  }
}

export async function getPrivateHyperRuntime () {
  if (deviceOnlySdk) return deviceOnlySdk

  if (!deviceOnlySdkOpening) {
    deviceOnlyStoragePath = getPrivateHyperSdkStoragePath()
    deviceOnlySdkOpening = initializeRuntimeCandidate(
      () => createSDK(createPrivateHyperRuntimeOptions(deviceOnlyStoragePath)),
      async (runtime) => {
        const drive = await getExistingNamedDrive(runtime, {
          driveName: HYPERDRIVE_DEVICE_DRIVE_NAME,
          autoJoin: false
        })
        rememberDeviceOnlyHyperdrive(drive)
        deviceOnlySdk = runtime
      }
    )
  }

  try {
    return await deviceOnlySdkOpening
  } finally {
    deviceOnlySdkOpening = null
  }
}

export async function getSyncedPrivateHyperRuntime () {
  if (syncedPrivateSdk) return syncedPrivateSdk

  if (!syncedPrivateSdkOpening) {
    syncedPrivateStoragePath = getSyncedPrivateHyperSdkStoragePath()
    syncedPrivateSdkOpening = initializeRuntimeCandidate(
      () => createSDK(createSyncedPrivateHyperRuntimeOptions(syncedPrivateStoragePath)),
      async (runtime) => {
        const drive = await getSyncedPrivateHyperdrive(runtime)
        rememberSyncedPrivateHyperdrive(drive)
        syncedPrivateSdk = runtime
      }
    )
  }

  try {
    return await syncedPrivateSdkOpening
  } finally {
    syncedPrivateSdkOpening = null
  }
}

export async function getSyncedPrivateHyperdrive (runtime = null) {
  const target = runtime || await getSyncedPrivateHyperRuntime()
  const encryptionKey = getPrivateDriveKey(syncedPrivateStoragePath || getSyncedPrivateHyperSdkStoragePath())
  if (!encryptionKey) throw new Error('Private drive encryption key is unavailable.')

  const corestore = target.namespace(HYPERDRIVE_PRIVATE_DRIVE_NAME)
  const drive = new Hyperdrive(corestore, undefined, { encryptionKey })
  await drive.ready()

  if (!drive.core.discovery) {
    await target.joinCore(drive.core)
  }

  return drive
}

export function rememberDeviceOnlyHyperdrive (drive) {
  if (drive?.id) deviceOnlyDriveId = String(drive.id).toLowerCase()
}

export function rememberSyncedPrivateHyperdrive (drive) {
  if (drive?.id) syncedPrivateDriveId = String(drive.id).toLowerCase()
}

export function isSyncedPrivateHyperdriveAddress (address) {
  return isSyncedPrivateHyperdriveAddressInternal(address)
}

export function isDeviceOnlyHyperdriveAddress (address) {
  return isDeviceOnlyHyperdriveAddressInternal(address)
}

export function getHyperStoragePath () {
  if (!storagePath && typeof Bare !== 'undefined') storagePath = getHyperSdkStoragePath()
  return storagePath
}

export function getPrivateHyperStoragePath () {
  if (!deviceOnlyStoragePath && typeof Bare !== 'undefined') {
    deviceOnlyStoragePath = getPrivateHyperSdkStoragePath()
  }
  return deviceOnlyStoragePath
}

export function getSyncedPrivateHyperStoragePath () {
  if (!syncedPrivateStoragePath && typeof Bare !== 'undefined') {
    syncedPrivateStoragePath = getSyncedPrivateHyperSdkStoragePath()
  }
  return syncedPrivateStoragePath
}

export function ensureLANDiscovery () {
  return withHyperRuntimeOperation((runtime) => startLANDiscovery(runtime))
}

export { getLANDiscoveryStatus }

export async function closeHyperRuntime () {
  try {
    await closeRuntimeCandidates([
      sdk || sdkOpening,
      deviceOnlySdk || deviceOnlySdkOpening,
      syncedPrivateSdk || syncedPrivateSdkOpening
    ])
  } finally {
    sdk = null
    sdkOpening = null
    deviceOnlySdk = null
    deviceOnlySdkOpening = null
    syncedPrivateSdk = null
    syncedPrivateSdkOpening = null
    deviceOnlyDriveId = null
    syncedPrivateDriveId = null
    resetPrivateDriveKeyCache()
    resetLANDiscovery()
  }
}

function getHyperSdkStoragePath () {
  const workletStoragePath = Bare.argv[0]
  if (!workletStoragePath) return 'hyper-storage'

  // Hyper SDK needs an app-owned storage directory. Bare.argv[0] can point at
  // the mutable device file used by Bare itself, so keep Hyper data beside it.
  return joinSiblingPath(workletStoragePath, 'hyper-sdk')
}

function getPrivateHyperSdkStoragePath () {
  const workletStoragePath = Bare.argv[0]
  if (!workletStoragePath) return 'hyper-storage-private'
  return joinSiblingPath(workletStoragePath, 'hyper-sdk-private')
}

function getSyncedPrivateHyperSdkStoragePath () {
  const workletStoragePath = Bare.argv[0]
  if (!workletStoragePath) return 'hyper-storage-synced-private'
  return joinSiblingPath(workletStoragePath, 'hyper-sdk-synced-private')
}

function isDeviceOnlyHyperdriveAddressInternal (address) {
  return matchesHyperdriveAddress(address, deviceOnlyDriveId)
}

function isSyncedPrivateHyperdriveAddressInternal (address) {
  return matchesHyperdriveAddress(address, syncedPrivateDriveId)
}

function joinSiblingPath (filepath, siblingName) {
  const normalized = String(filepath).replace(/[/\\]+$/, '')
  const separatorIndex = Math.max(
    normalized.lastIndexOf('/'),
    normalized.lastIndexOf('\\')
  )

  if (separatorIndex === -1) return `${normalized}-${siblingName}`

  return `${normalized.slice(0, separatorIndex + 1)}${siblingName}`
}
