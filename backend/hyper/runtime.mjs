/* global Bare */

import { create as createSDK } from 'hyper-sdk'
import { createRuntimeCoordinator } from './runtime-coordinator.mjs'

let sdk = null
let sdkOpening = null
let storagePath = null
const runtimeCoordinator = createRuntimeCoordinator()

export function withHyperRuntimeOperation (task) {
  return runtimeCoordinator.runOperation(async () => task(await getHyperRuntime()))
}

export function withHyperRuntimeMaintenance (task) {
  return runtimeCoordinator.runMaintenance(task)
}

export async function getHyperRuntime () {
  if (sdk) return sdk

  if (!sdkOpening) {
    storagePath = getHyperSdkStoragePath()
    sdkOpening = createSDK({ storage: storagePath })
      .then((runtime) => {
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

export function getHyperStoragePath () {
  return storagePath
}

export async function closeHyperRuntime () {
  const runtime = sdk || (sdkOpening ? await sdkOpening : null)
  if (!runtime) return

  sdk = null
  sdkOpening = null

  await runtime.close()
}

function getHyperSdkStoragePath () {
  const workletStoragePath = Bare.argv[0]
  if (!workletStoragePath) return 'hyper-storage'

  // Hyper SDK needs an app-owned storage directory. Bare.argv[0] can point at
  // the mutable device file used by Bare itself, so keep Hyper data beside it.
  return joinSiblingPath(workletStoragePath, 'hyper-sdk')
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
