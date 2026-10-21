import { getRandomBytes } from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'

// The key that locks the private drive key and the names of private files on
// this phone (backend/hyper/sealed-file.mjs, app/privacy/sealed-text.mjs). The
// system keeps it: the iOS Keychain, or encrypted under an Android Keystore
// key. Only this app reads it, on this phone, once the phone has been unlocked
// since it started; it is in no backup and goes to no other device, which get
// a key of their own. Nobody is asked for anything.

const ITEM = 'peersky.local-seal-key'
const HEX_KEY = /^[0-9a-f]{64}$/
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
}

let cached: string | null = null
let loading: Promise<string | null> | null = null
const listeners = new Set<() => void>()

function toHex (bytes: Uint8Array) {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

export function getLocalSealKey () {
  return cached
}

/** Called once the key is known, for what was read before it was. */
export function onLocalSealKey (listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * The key, made the first time. null when the system's secure storage cannot
 * be used, in which case nothing is locked and nothing locked is opened.
 */
export function loadLocalSealKey (): Promise<string | null> {
  if (cached) return Promise.resolve(cached)
  if (!loading) {
    loading = (async () => {
      try {
        let value = await SecureStore.getItemAsync(ITEM, OPTIONS)
        if (!value || !HEX_KEY.test(value)) {
          value = toHex(getRandomBytes(32))
          await SecureStore.setItemAsync(ITEM, value, OPTIONS)
          // Kept only if it reads back: a key that was not kept would lock
          // files nothing could open after the next start.
          if (await SecureStore.getItemAsync(ITEM, OPTIONS) !== value) return null
        }
        cached = value
        for (const listener of listeners) listener()
        return value
      } catch (error) {
        console.warn('Unable to read the local seal key:', error)
        return null
      }
    })().finally(() => { loading = null })
  }
  return loading
}

export function localRandomBytes (length: number) {
  return getRandomBytes(length)
}
