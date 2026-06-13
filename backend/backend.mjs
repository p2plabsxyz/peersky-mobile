/* global BareKit, Bare */

import RPC from 'bare-rpc'
import { closeHyperRuntime } from './hyper/runtime.mjs'
import { disconnectP2pmdRoom } from './p2pmd/room.mjs'
import { routeRpcRequest } from './rpc/router.mjs'

const { IPC } = BareKit

createRpc()

function createRpc () {
  return new RPC(IPC, routeRpcRequest)
}

Bare.on('beforeExit', async () => {
  try {
    await disconnectP2pmdRoom()
  } catch (error) {
    console.error('[p2pmd] Failed to disconnect room on beforeExit:', error)
  }

  try {
    await closeHyperRuntime()
  } catch (error) {
    console.error('[hyper] Failed to close runtime on beforeExit:', error)
  }
})
