/* global BareKit, Bare */

import RPC from 'bare-rpc'
import { closeHyperRuntime } from './hyper/runtime.mjs'
import { stopHolesail } from './holesail/session.mjs'
import { stopP2pmdServer } from './p2pmd/server.mjs'
import { routeRpcRequest } from './rpc/router.mjs'

const { IPC } = BareKit

createRpc()

function createRpc () {
  return new RPC(IPC, routeRpcRequest)
}

Bare.on('beforeExit', async () => {
  try {
    await stopP2pmdServer()
  } catch (error) {
    console.error('[p2pmd] Failed to stop server on beforeExit:', error)
  }

  try {
    await stopHolesail()
  } catch (error) {
    console.error('[holesail] Failed to stop session on beforeExit:', error)
  }

  try {
    await closeHyperRuntime()
  } catch (error) {
    console.error('[hyper] Failed to close runtime on beforeExit:', error)
  }
})
