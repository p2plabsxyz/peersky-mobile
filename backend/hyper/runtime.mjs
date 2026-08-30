/* global Bare */

import { create as createSDK } from 'hyper-sdk'
import {
  getLANDiscoveryStatus,
  resetLANDiscovery,
  startLANDiscovery
} from './lan-discovery.mjs'
import {
  closeRuntimeCandidates,
  createRuntimeCoordinator,
  initializeRuntimeCandidate
} from './runtime-coordinator.mjs'
import {
  createPrivateHyperRuntimeOptions,
  matchesHyperdriveAddress
} from './runtime-routing.mjs'
import {
  getExistingNamedDrive,
  HYPERDRIVE_PRIVATE_DRIVE_NAME
} from './storage-core.mjs'

let sdk = null
let sdkOpening = null
let storagePath = null
let privateSdk = null
let privateSdkOpening = null
let privateStoragePath = null
let privateDriveId = null
const runtimeCoordinator = createRuntimeCoordinator()

export function withHyperRuntimeOperation (task) {
  return runtimeCoordinator.runOperation(async () => task(await getHyperRuntime()))
}

export function withPrivateHyperRuntimeOperation (task) {
  return runtimeCoordinator.runOperation(async () => task(await getPrivateHyperRuntime()))
}

export function withHyperRuntimeForAddress (address, task) {
  return runtimeCoordinator.runOperation(async () => {
    const isolatedRuntime = await getPrivateHyperRuntime()
    if (isPrivateHyperdriveAddress(address)) return task(isolatedRuntime)
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
  if (privateSdk) return privateSdk

  if (!privateSdkOpening) {
    privateStoragePath = getPrivateHyperSdkStoragePath()
    privateSdkOpening = initializeRuntimeCandidate(
      () => createSDK(createPrivateHyperRuntimeOptions(privateStoragePath)),
      async (runtime) => {
        const drive = await getExistingNamedDrive(runtime, {
          driveName: HYPERDRIVE_PRIVATE_DRIVE_NAME,
          autoJoin: false
        })
        rememberPrivateHyperdrive(drive)
        privateSdk = runtime
      }
    )
  }

  try {
    return await privateSdkOpening
  } finally {
    privateSdkOpening = null
  }
}

export function rememberPrivateHyperdrive (drive) {
  if (drive?.id) privateDriveId = String(drive.id).toLowerCase()
}

export function getHyperStoragePath () {
  if (!storagePath && typeof Bare !== 'undefined') storagePath = getHyperSdkStoragePath()
  return storagePath
}

export function getPrivateHyperStoragePath () {
  if (!privateStoragePath && typeof Bare !== 'undefined') {
    privateStoragePath = getPrivateHyperSdkStoragePath()
  }
  return privateStoragePath
}

export function ensureLANDiscovery () {
  return withHyperRuntimeOperation((runtime) => startLANDiscovery(runtime))
}

export { getLANDiscoveryStatus }

export async function closeHyperRuntime () {
  try {
    await closeRuntimeCandidates([
      sdk || sdkOpening,
      privateSdk || privateSdkOpening
    ])
  } finally {
    sdk = null
    sdkOpening = null
    privateSdk = null
    privateSdkOpening = null
    privateDriveId = null
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

function isPrivateHyperdriveAddress (address) {
  return matchesHyperdriveAddress(address, privateDriveId)
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
