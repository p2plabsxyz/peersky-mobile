import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytes } from 'expo-crypto'
import { File, Paths } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'

import {
  decideLocalSealKey,
  LOCAL_SEAL_KEY_CHECK_FILE,
  LOCAL_SEALED_FILES,
  localSealKeyCheckFromDigest,
  localSealKeyCheckInput,
  parseLocalSealKeyCheck,
  serializeLocalSealKeyCheck
} from './local-seal-key-state.mjs'
import { isSealedText } from './sealed-text.mjs'

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
// Larger than any of the files it locks; anything bigger is not one of them.
const MAX_SEALED_FILE_BYTES = 4 * 1024 * 1024

let cached: string | null = null
let missing = false
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

/**
 * True when a key was made on this phone and could not be read this time.
 * Nothing that key would lock is written then, plain or otherwise.
 */
export function isLocalSealKeyMissing () {
  return missing
}

/** Called once the key is known, for what was read before it was. */
export function onLocalSealKey (listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * The key, made the first time. null when the system's secure storage cannot
 * be used, in which case nothing is locked and nothing locked is opened, or
 * when the key made here cannot be read (isLocalSealKeyMissing).
 */
export function loadLocalSealKey (): Promise<string | null> {
  if (cached) return Promise.resolve(cached)
  if (!loading) {
    loading = (async () => {
      const checkFile = new File(Paths.document, LOCAL_SEAL_KEY_CHECK_FILE)
      const check = readCheck(checkFile)
      // Read before asking the system: a key that was made here and cannot be
      // read now must never be made again (local-seal-key-state.mjs).
      const lockedFiles = !check && hasLockedFiles()
      try {
        const stored = await SecureStore.getItemAsync(ITEM, OPTIONS)
        const storedKeyCheck = stored && HEX_KEY.test(stored) ? await checkOf(stored) : ''
        const decision = decideLocalSealKey({ storedKey: stored, storedKeyCheck, check, lockedFiles })
        if (decision === 'missing') {
          missing = true
          console.warn('The local seal key made on this phone could not be read; nothing it locks is opened or written')
          return null
        }
        let value = stored as string
        if (decision === 'make') {
          value = toHex(getRandomBytes(32))
          await SecureStore.setItemAsync(ITEM, value, OPTIONS)
          // Kept only if it reads back: a key that was not kept would lock
          // files nothing could open after the next start.
          if (await SecureStore.getItemAsync(ITEM, OPTIONS) !== value) return null
        }
        if (!check) writeCheck(checkFile, await checkOf(value))
        missing = false
        cached = value
        for (const listener of listeners) listener()
        return value
      } catch (error) {
        // Not read this time. With a key made here before, that is a missing
        // key, never a reason to write in the open what it locks.
        missing = Boolean(check) || lockedFiles
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

async function checkOf (key: string) {
  return localSealKeyCheckFromDigest(await digestStringAsync(CryptoDigestAlgorithm.SHA256, localSealKeyCheckInput(key)))
}

function readCheck (file: File) {
  try {
    return file.exists ? parseLocalSealKeyCheck(file.textSync()) : null
  } catch {
    return null
  }
}

function writeCheck (file: File, check: string) {
  try {
    if (!file.exists) file.create({ intermediates: true })
    file.write(serializeLocalSealKeyCheck(check))
  } catch (error) {
    console.warn('Unable to keep the local seal key check:', error)
  }
}

function hasLockedFiles () {
  return LOCAL_SEALED_FILES.some((name) => {
    try {
      const file = new File(Paths.document, name)
      return file.exists && (file.size ?? 0) <= MAX_SEALED_FILE_BYTES && isSealedText(file.textSync())
    } catch {
      return false
    }
  })
}
