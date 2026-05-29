/* global Bare */

import { create as createSDK } from 'hyper-sdk'

let sdk = null
let storagePath = null

export async function getHyperRuntime () {
  if (sdk) return sdk

  storagePath = Bare.argv[0] || 'hyper-storage'
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
