/* global BareKit, Bare */

import RPC from 'bare-rpc'
import { stopHolesail } from './holesail/session.mjs'
import { stopHyperAssetServer } from './hyper/fetch.mjs'
import { closeHyperOfflineDownloads } from './hyper/offline-manager.mjs'
import { closeHyperRuntime } from './hyper/runtime.mjs'
import { disconnectP2pmdRoom } from './p2pmd/room.mjs'
import { closePeerChatService } from './peerchat/runtime.mjs'
import { stopPeerTunesServer } from './peertunes/server.mjs'
import { setAppNotifier } from './rpc/notify.mjs'
import { routeRpcRequest } from './rpc/router.mjs'
import { recoverLinkDeviceStorage } from './backup/link-device.mjs'

const { IPC } = BareKit

// Before anything can open a store: a restore the app was killed in the
// middle of is undone here, while nothing has its files open.
recoverLinkDeviceStorage()
createRpc()

function createRpc () {
  const rpc = new RPC(IPC, routeRpcRequest)

  // Fire and forget: the app acknowledges so the request does not sit pending,
  // but nothing here waits on it.
  setAppNotifier((command, payload) => {
    const request = rpc.request(command)
    request.send(JSON.stringify(payload))
    request.reply().catch(() => {})
  })

  return rpc
}

Bare.on('beforeExit', async () => {
  try {
    await closeHyperOfflineDownloads()
  } catch (error) {
    console.error('[hyper] Failed to stop offline downloads on beforeExit:', error)
  }

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
    await stopPeerTunesServer()
  } catch (error) {
    console.error('[peertunes] Failed to stop the loopback server on beforeExit:', error)
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
