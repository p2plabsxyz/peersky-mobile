/* global BareKit, Bare */

import RPC from 'bare-rpc'
import { closeHyperRuntime } from './hyper/runtime.mjs'
import { routeRpcRequest } from './rpc/router.mjs'

const { IPC } = BareKit

createRpc()

function createRpc () {
  return new RPC(IPC, routeRpcRequest)
}

Bare.on('beforeExit', async () => {
  try {
    await closeHyperRuntime()
  } catch (error) {
    console.error('[hyper] Failed to close runtime on beforeExit:', error)
  }
})
