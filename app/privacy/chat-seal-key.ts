import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytes } from 'expo-crypto'
import { File, Paths } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'
import { NativeModules, Platform } from 'react-native'

import {
  CHAT_SEAL_KEY_CHECK_FILE,
  CHAT_SEALED_APP_FILES,
  CHAT_SEALED_START,
  chatSealKeyCheckInput,
  decideChatSealKey
} from './chat-seal-key-state.mjs'
import {
  localSealKeyCheckFromDigest,
  parseLocalSealKeyCheck,
  serializeLocalSealKeyCheck
} from './local-seal-key-state.mjs'

// The key chats and notes are locked with (backend/hyper/sealed-file.mjs),
// apart from the local seal key, which the system gives any time after the
// first unlock. This one it gives only while the phone is unlocked: the iOS
// Keychain's when-unlocked class, on this device only, and on Android the
// app's own Keystore module (plugins/templates/PeerSkyChatKeyModule.kt), which
// needs the phone unlocked from Android 15. Read while the phone is locked,
// after Android brought PeerSky back on its own, it is not there, and
// PeerChat waits for the unlock.

export type ChatSealKeyState = 'ready' | 'locked' | 'missing' | 'unavailable'

type Read =
  | { read: 'ok', storedKey: string | null }
  | { read: 'locked' | 'gone' | 'error', error?: unknown }

type ChatKeyModule = {
  getKey(): Promise<string | null>
  makeKey(): Promise<string>
}

const ITEM = 'peersky.chat-seal-key'
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
}
const HEX_KEY = /^[0-9a-f]{64}$/

let cached: string | null = null
let state: ChatSealKeyState | null = null
let loading: Promise<{ key: string, state: ChatSealKeyState }> | null = null

function toHex (bytes: Uint8Array) {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** How the key stood when last asked, or null before then. */
export function getChatSealKeyState () {
  return state
}

/**
 * The key, made the first time, or why there is none. Asked again each time
 * until it is ready: the phone may be unlocked by then.
 */
export function loadChatSealKey (): Promise<{ key: string, state: ChatSealKeyState }> {
  if (cached) return Promise.resolve({ key: cached, state: 'ready' })
  if (!loading) {
    loading = (async (): Promise<{ key: string, state: ChatSealKeyState }> => {
      const checkFile = new File(Paths.document, CHAT_SEAL_KEY_CHECK_FILE)
      const check = readCheck(checkFile)
      // Read before asking the system: a key that was made here and cannot
      // be read now must never be made again (chat-seal-key-state.mjs).
      const sealedFiles = !check && hasChatSealedFiles()
      const stored = await readKey()
      const storedKey = stored.read === 'ok' ? stored.storedKey : null
      const storedKeyCheck = storedKey && HEX_KEY.test(storedKey) ? await checkOf(storedKey) : ''
      const decision = decideChatSealKey({ read: stored.read, storedKey, storedKeyCheck, check, sealedFiles })
      if (decision !== 'use' && decision !== 'make') {
        if (decision === 'missing') console.warn('The chat key made on this phone could not be read; chats and notes stay locked')
        if (stored.read === 'error') console.warn('Unable to read the chat key:', stored.error)
        const waiting = decision as ChatSealKeyState
        state = waiting
        return { key: '', state: waiting }
      }
      let value = storedKey as string
      if (decision === 'make') {
        const made = await makeKey()
        if (made.read !== 'ok' || !made.storedKey) {
          if (made.read === 'error') console.warn('Unable to make the chat key:', made.error)
          // Locked, it is made at the unlock. Anything else is a phone that
          // cannot keep one, which keeps chats as it always did.
          state = made.read === 'locked' ? 'locked' : 'unavailable'
          return { key: '', state }
        }
        value = made.storedKey
      }
      if (!check) writeCheck(checkFile, await checkOf(value))
      cached = value
      state = 'ready'
      return { key: value, state: 'ready' }
    })().finally(() => { loading = null })
  }
  return loading as Promise<{ key: string, state: ChatSealKeyState }>
}

async function readKey (): Promise<Read> {
  if (Platform.OS === 'android') {
    const module = chatKeyModule()
    if (!module) return { read: 'error', error: new Error('PeerSkyChatKey is not in this build') }
    try {
      return { read: 'ok', storedKey: await module.getKey() }
    } catch (error) {
      const code = (error as { code?: string })?.code
      return { read: code === 'LOCKED' ? 'locked' : code === 'GONE' ? 'gone' : 'error', error }
    }
  }
  try {
    return { read: 'ok', storedKey: await SecureStore.getItemAsync(ITEM, OPTIONS) }
  } catch (error) {
    return { read: isKeychainLocked(error) ? 'locked' : 'error', error }
  }
}

async function makeKey (): Promise<Read> {
  if (Platform.OS === 'android') {
    const module = chatKeyModule()
    if (!module) return { read: 'error', error: new Error('PeerSkyChatKey is not in this build') }
    try {
      return { read: 'ok', storedKey: await module.makeKey() }
    } catch (error) {
      return { read: (error as { code?: string })?.code === 'LOCKED' ? 'locked' : 'error', error }
    }
  }
  const value = toHex(getRandomBytes(32))
  try {
    await SecureStore.setItemAsync(ITEM, value, OPTIONS)
    // Kept only if it reads back: a key that was not kept would lock files
    // nothing could open after the next start.
    if (await SecureStore.getItemAsync(ITEM, OPTIONS) !== value) return { read: 'error', error: new Error('The chat key did not read back') }
    return { read: 'ok', storedKey: value }
  } catch (error) {
    return { read: isKeychainLocked(error) ? 'locked' : 'error', error }
  }
}

function chatKeyModule (): ChatKeyModule | null {
  return (NativeModules.PeerSkyChatKey as ChatKeyModule | undefined) || null
}

// errSecInteractionNotAllowed, which is what the Keychain answers for a
// when-unlocked item while the phone is locked.
function isKeychainLocked (error: unknown) {
  const text = String((error as { message?: string })?.message || error)
  return /interaction is not allowed|-25308/i.test(text)
}

async function checkOf (key: string) {
  return localSealKeyCheckFromDigest(await digestStringAsync(CryptoDigestAlgorithm.SHA256, chatSealKeyCheckInput(key)))
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
    console.warn('Unable to keep the chat key check:', error)
  }
}

// From each file's first bytes only: PeerChat's runs to megabytes.
function hasChatSealedFiles () {
  const start = new TextEncoder().encode(CHAT_SEALED_START)
  return CHAT_SEALED_APP_FILES.some((name) => {
    try {
      const file = new File(Paths.document, ...name.split('/'))
      if (!file.exists || (file.size ?? 0) < start.byteLength) return false
      const handle = file.open()
      try {
        const bytes = handle.readBytes(start.byteLength)
        return bytes.every((byte, index) => byte === start[index])
      } finally {
        handle.close()
      }
    } catch {
      return false
    }
  })
}
