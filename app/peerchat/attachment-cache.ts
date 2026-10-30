import { useSyncExternalStore } from 'react'
import { Directory, Paths } from 'expo-file-system'
import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native'

// The pictures and files PeerChat opened to show them are kept decrypted
// beside its store (backend/peerchat/attachments.mjs), and stayed there for
// good. They go now before the phone locks, so a locked phone shows nobody a
// picture: on iOS as the app leaves the screen, which locking the phone does
// too, and on Android as the screen goes off, since the app runs on behind it
// there. The backend clears them as it starts as well. What is on screen is
// opened again when the app comes back.

let generation = 0
let cleared = false
const listeners = new Set<() => void>()

function attachmentCacheDirectory () {
  // In the store's folder, which sits beside the backend's own, hyper-storage
  // (backend/hyper/runtime.mjs).
  return new Directory(Paths.document, 'hyper-sdk', 'peerchat-attachment-cache')
}

export function clearPeerChatAttachmentCache () {
  try {
    const directory = attachmentCacheDirectory()
    if (directory.exists) directory.delete()
    cleared = true
  } catch (error) {
    console.warn('Unable to remove the PeerChat files opened to show them:', error)
  }
}

function subscribe (listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getGeneration () {
  return generation
}

/** Changes each time what was opened went, for a picture or video to open again. */
export function usePeerChatAttachmentGeneration () {
  return useSyncExternalStore(subscribe, getGeneration)
}

/** Clears the opened files at the moments above. Returns the way to stop. */
export function watchPeerChatAttachmentCache () {
  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'background' && Platform.OS === 'ios') clearPeerChatAttachmentCache()
    if (next === 'active' && cleared) {
      cleared = false
      generation += 1
      for (const listener of listeners) listener()
    }
  })
  const module = Platform.OS === 'android' ? NativeModules.PeerSkyChatKey : null
  const screenOff = module
    ? new NativeEventEmitter(module).addListener('PeerSkyScreenOff', clearPeerChatAttachmentCache)
    : null
  return () => {
    appState.remove()
    screenOff?.remove()
  }
}
