import { NativeEventEmitter, NativeModules, Platform } from 'react-native'

type PeerChatBackgroundModule = {
  setEnabled: (enabled: boolean) => Promise<void>
  setStatus?: (status: PeerChatBackgroundStatus) => void
  isIgnoringBatteryOptimizations: () => Promise<boolean>
  openBatteryOptimizationSettings: () => Promise<void>
  playSound: (kind: 'send' | 'receive' | 'pop') => void
  addListener: (eventName: string) => void
  removeListeners: (count: number) => void
}

// What the service's notice says: PeerChat answered, so it is connected, or
// the backend stopped or never started. Until the first, it says connecting.
export type PeerChatBackgroundStatus = 'connected' | 'offline'

const BACKGROUND_TICK_EVENT = 'PeerChatBackgroundTick'

function getPeerChatBackgroundModule () {
  return NativeModules.PeerChatBackground as PeerChatBackgroundModule | undefined
}

export async function setPeerChatBackgroundEnabled (enabled: boolean) {
  if (Platform.OS !== 'android') return
  const module = getPeerChatBackgroundModule()
  if (!module?.setEnabled) throw new Error('PeerChat background service is unavailable in this build.')
  await module.setEnabled(enabled)
}

// The notice never says connected while PeerChat is not running. This also
// tells the service the app is looking after PeerChat in this run, so it
// does not start it again on its own.
export function setPeerChatBackgroundStatus (status: PeerChatBackgroundStatus) {
  if (Platform.OS !== 'android') return
  try {
    getPeerChatBackgroundModule()?.setStatus?.(status)
  } catch (error) {
    console.warn('Unable to update the PeerChat background notice:', error)
  }
}

// A foreground service survives Doze. It does not survive Samsung's own
// sleeping-apps layer, which is what actually takes the peer offline after a
// day or two idle, so the exemption is worth asking for.
export async function isPeerChatBatteryUnrestricted () {
  if (Platform.OS !== 'android') return true
  const module = getPeerChatBackgroundModule()
  if (!module?.isIgnoringBatteryOptimizations) return true
  try {
    return await module.isIgnoringBatteryOptimizations()
  } catch {
    return true
  }
}

export async function openPeerChatBatterySettings () {
  if (Platform.OS !== 'android') return
  const module = getPeerChatBackgroundModule()
  if (!module?.openBatteryOptimizationSettings) return
  await module.openBatteryOptimizationSettings()
}

export function addPeerChatBackgroundTickListener (listener: () => void) {
  if (Platform.OS !== 'android') return { remove () {} }
  const module = getPeerChatBackgroundModule()
  if (!module?.addListener || !module?.removeListeners) return { remove () {} }
  return new NativeEventEmitter(module as never).addListener(BACKGROUND_TICK_EVENT, listener)
}

export function playAndroidPeerChatSound (kind: 'send' | 'receive' | 'pop') {
  if (Platform.OS !== 'android') return false
  const module = getPeerChatBackgroundModule()
  if (!module?.playSound) return false
  module.playSound(kind)
  return true
}
