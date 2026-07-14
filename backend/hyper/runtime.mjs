/* global Bare */

import { create as createSDK } from 'hyper-sdk'

let sdk = null
let storagePath = null

export async function getHyperRuntime () {
  if (sdk) return sdk

  storagePath = getHyperSdkStoragePath()
  sdk = await createSDK({ storage: storagePath })

  return sdk
}

export function getHyperStoragePath () {
  return storagePath
}

export async function closeHyperRuntime () {
  if (!sdk) return

  const runtime = sdk
  sdk = null

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
