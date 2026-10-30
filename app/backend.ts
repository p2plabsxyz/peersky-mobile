import b4a from 'b4a'
import RPC from 'bare-rpc'
import { Paths } from 'expo-file-system'
import { AppState, Platform } from 'react-native'
import { Worklet } from 'react-native-bare-kit'

import { RPC_HYPER_INIT, RPC_HYPER_REFRESH } from '../backend/rpc/commands.mjs'
import bundle from './app.bundle.mjs'
import { resumeBareInBackground } from './bare-background.mjs'
import { watchHyperNetwork } from './hyper-network-refresh'
import { t } from './i18n/i18n.mjs'
import { isLocalSealKeyMissing, loadLocalSealKey } from './privacy/local-seal-key'
import { toBareFsPath } from './settings/link-device-state.mjs'

// The Bare backend, which runs Hyper and the P2P apps. There is one for the
// whole run of the app, kept here rather than in the screen, because Android
// runs PeerSky without its screen too: its PeerChat service starts the backend
// itself after the system stopped the app, a reboot or an update
// (peerchat/background-task.ts), and the backend goes on once PeerSky is
// swiped away from Recents. The screen takes up whichever one is running.

export type BackendInitResponse = {
  ok: boolean
  error?: string
  storagePath?: string
  lan?: { available?: boolean, host?: string, port?: number }
}

export type BackendRequest = {
  readonly command: number
  readonly data: string | Uint8Array | null
}

let worklet: Worklet | null = null
let rpc: RPC | null = null
let ready: BackendInitResponse | null = null
let starting: Promise<BackendInitResponse> | null = null
// Set once a clear or a restore has put new data under the running backend.
// The next start, as the screen opens again, begins a new one.
let restartWanted = false
let stopBareBackground: (() => void) | null = null
let stopNetworkWatch: (() => void) | null = null
const requestListeners = new Set<(request: BackendRequest) => void>()

/** Where the backend keeps its stores. */
export function getBackendStoragePath () {
  return Paths.document?.uri ? `${toBareFsPath(Paths.document.uri)}/hyper-storage` : 'hyper-storage'
}

/** The documents folder, where the app's own files and the identity are. */
export function getIdentityStoragePath () {
  return Paths.document?.uri ? toBareFsPath(Paths.document.uri) : getBackendStoragePath()
}

export function getBackendRpc () {
  return rpc
}

/**
 * Starts the backend, or hands back the one already running. allowNetwork
 * lets offline folders go on downloading, which the screen decides from the
 * user's Wi-Fi setting; started without the screen, they wait for it.
 */
export function startBackend ({ allowNetwork = false }: { allowNetwork?: boolean } = {}): Promise<BackendInitResponse> {
  if (restartWanted && !starting) {
    restartWanted = false
    stopBackend()
  }
  if (ready && rpc) return Promise.resolve(ready)
  if (!starting) {
    starting = startOnce(allowNetwork).finally(() => { starting = null })
  }
  return starting
}

async function startOnce (allowNetwork: boolean) {
  if (!worklet) {
    // The key that locks private keys and file names on disk, from the
    // Keychain or the Android Keystore (privacy/local-seal-key.ts). 'missing'
    // says this phone has one that could not be read, so the backend writes
    // nothing it would lock (backend/hyper/sealed-file.mjs).
    const sealKey = await loadLocalSealKey()
    const next = new Worklet()
    next.start('/app.bundle', bundle, [getBackendStoragePath(), sealKey || '', isLocalSealKeyMissing() ? 'missing' : ''])

    // The backend pushes here when PeerChat changes, so a new message shows
    // the moment it lands instead of waiting for the next poll.
    const nextRpc = new RPC(next.IPC, (request) => {
      for (const listener of requestListeners) {
        try {
          listener(request)
        } catch (error) {
          console.warn('[backend] A listener failed:', error)
        }
      }
      try {
        request.reply()
      } catch {}
    })
    worklet = next
    rpc = nextRpc
    // Without this iOS kills the app half a minute after it leaves the
    // screen (app/bare-background.mjs).
    if (Platform.OS === 'ios') stopBareBackground = resumeBareInBackground(next, AppState)
  }

  const response = await callBackend(RPC_HYPER_INIT, { allowNetwork }) as BackendInitResponse
  if (!response.ok) throw new Error(response.error || 'Unable to initialize Hyper')
  ready = response
  // A new network leaves the swarm announced where it was. Looked after for
  // as long as the backend runs, with the screen or without it.
  if (!stopNetworkWatch) stopNetworkWatch = watchHyperNetwork(() => callBackend(RPC_HYPER_REFRESH, {}))
  return response
}

export async function callBackend (command: number, payload: object = {}) {
  // Asked while the backend is still starting, as a PeerChat tab brought back
  // at startup asks the moment it opens: it waits for the backend rather than
  // failing with "Worklet is not ready" and showing no profile.
  if (!rpc && starting) await starting.catch(() => {})
  const current = rpc
  if (!current) throw new Error(t('Worklet is not ready'))

  const request = current.request(command)
  request.send(JSON.stringify(payload))
  const reply = await request.reply()
  if (!reply) return { ok: false, error: t('Missing response') }
  return JSON.parse(typeof reply === 'string' ? reply : b4a.toString(reply as Uint8Array))
}

/** What the backend asks of the app: PeerChat changed, Link Device progress. */
export function onBackendRequest (listener: (request: BackendRequest) => void) {
  requestListeners.add(listener)
  return () => { requestListeners.delete(listener) }
}

/**
 * A clear or a restore replaced the data under the backend, so the next start
 * makes a new one rather than taking up this one. Until then it carries on:
 * it may still be finishing the clear.
 */
export function requireBackendRestart () {
  restartWanted = true
}

function stopBackend () {
  stopNetworkWatch?.()
  stopNetworkWatch = null
  stopBareBackground?.()
  stopBareBackground = null
  const current = worklet
  worklet = null
  rpc = null
  ready = null
  current?.terminate()
}
