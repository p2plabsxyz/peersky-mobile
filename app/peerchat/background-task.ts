// First, so a notification is in the language picked in PeerSky.
import '../i18n/setup'
import { AppState } from 'react-native'

import { RPC_APP_PEERCHAT_CHANGED, RPC_PEERCHAT_PRESENCE } from '../../backend/rpc/commands.mjs'
import { callBackend, onBackendRequest, startBackend, syncChatSealKey } from '../backend'
import { checkPeerChatNow, reportPeerChatLocked, reportPeerChatOffline, startPeerChatNotifier } from './notifier'

let watchingChanges = false

/**
 * Starts looking for PeerChat messages once the backend is up, with the
 * screen or without it, and looks again each time the backend says PeerChat
 * changed. Resolves after the first look.
 */
export function startPeerChatChecks () {
  if (!watchingChanges) {
    watchingChanges = true
    onBackendRequest((request) => {
      if (request.command === RPC_APP_PEERCHAT_CHANGED) checkPeerChatNow()
    })
  }
  return startPeerChatNotifier(callBackend)
}

/**
 * PeerChat as Android starts it with no screen. Its background service runs
 * this (plugins/templates/PeerChatBackgroundService.kt.template) after the
 * system stopped PeerSky, a reboot or an update, which used to bring back
 * only the service's notice with nothing behind it. The backend starts and
 * PeerChat is looked after as under the screen, which takes them up when
 * PeerSky is opened (app/backend.ts).
 */
export async function runPeerChatBackgroundTask () {
  try {
    await startBackend({ allowNetwork: false })
    // Chats are locked with a key the phone gives only while it is unlocked.
    // Started while it is locked, PeerChat waits, the notice says so, and
    // the service runs this again at the unlock.
    const chat = await syncChatSealKey()
    if (chat.state === 'locked') {
      reportPeerChatLocked()
      return
    }
    // Made here and gone: PeerChat cannot open its chats, and says so when
    // the app is opened.
    if (chat.state === 'missing') {
      reportPeerChatOffline()
      return
    }
    // People in a room see this phone as away, as they would with the app
    // in the background.
    void callBackend(RPC_PEERCHAT_PRESENCE, { idle: AppState.currentState !== 'active' }).catch(() => {})
    await startPeerChatChecks()
  } catch (error) {
    console.warn('[peerchat] Could not start PeerChat in the background:', error)
    reportPeerChatOffline()
  }
}
