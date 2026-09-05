/* global BareKit, Bare */

import RPC from 'bare-rpc'
import { stopHolesail } from './holesail/session.mjs'
import { stopHyperAssetServer } from './hyper/fetch.mjs'
import { closeHyperRuntime } from './hyper/runtime.mjs'
import { disconnectP2pmdRoom } from './p2pmd/room.mjs'
import { closePeerChatService } from './peerchat/runtime.mjs'
import { routeRpcRequest } from './rpc/router.mjs'

const { IPC } = BareKit

createRpc()

function createRpc () {
  return new RPC(IPC, routeRpcRequest)
}

Bare.on('beforeExit', async () => {
  try {
    await closePeerChatService()
  } catch (error) {
    console.error('[peerchat] Failed to close service on beforeExit:', error)
  }

  try {
    await disconnectP2pmdRoom()
  } catch (error) {
    console.error('[p2pmd] Failed to disconnect room on beforeExit:', error)
  }

  try {
    await stopHolesail()
  } catch (error) {
    console.error('[holesail] Failed to stop runtime on beforeExit:', error)
  }

  try {
    await stopHyperAssetServer()
    await closeHyperRuntime()
  } catch (error) {
    console.error('[hyper] Failed to close runtime on beforeExit:', error)
  }
})
