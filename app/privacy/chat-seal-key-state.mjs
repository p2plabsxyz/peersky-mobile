// What to do with what the system gives back for the chat key
// (chat-seal-key.ts), kept apart so it can be tested.
//
// The chat key locks chats and notes (backend/hyper/sealed-file.mjs), and the
// system gives it only while the phone is unlocked. So a read can fail for
// that alone, and nothing then is made in its place: a new key would leave
// every chat the old one locked shut for good. As with the local seal key, a
// check made from the key is kept beside the files, and a key made here
// before is never made again (local-seal-key-state.mjs).

export const CHAT_SEAL_KEY_CHECK_FILE = 'chat-seal-key-check.json'

// The app's own files the key locks, in the documents folder. One of them
// locked means a key was made here before the check was kept.
export const CHAT_SEALED_APP_FILES = Object.freeze([
  'peerchat-ui-state.json',
  'p2pmd-room-history.json',
  // Beside the backend's own folder, hyper-storage (backend/hyper/runtime.mjs).
  'hyper-sdk/peerchat-mobile.json'
])

// How a file locked with the chat key starts (sealed-file.mjs sealJson).
export const CHAT_SEALED_START = '{"peersky-sealed":1,"key":"chat"'

const HEX_KEY = /^[0-9a-f]{64}$/

/** The text hashed for the check: never the key itself on disk. */
export function chatSealKeyCheckInput (key) {
  return `peersky-chat-seal-key-check:${key}`
}

/**
 * 'use' the key the system gave back, 'make' the first one, 'locked' when the
 * phone is locked and it comes at the unlock, or 'missing': one was made here
 * and is not what came back, so nothing is made over it.
 * @param {{ read: 'ok' | 'locked' | 'gone' | 'error', storedKey?: unknown, storedKeyCheck?: string, check: string | null, sealedFiles: boolean }} state
 */
export function decideChatSealKey ({ read, storedKey, storedKeyCheck = '', check, sealedFiles }) {
  if (read === 'locked') return 'locked'
  const madeHere = Boolean(check) || sealedFiles
  if (read === 'gone') return 'missing'
  // Not read for a reason the system did not give, as when a watch unlocked
  // the phone and the Keystore still holds the key back. Never a reason to
  // make one: asked again when the app is next in front.
  if (read === 'error') return madeHere ? 'locked' : 'unavailable'
  if (typeof storedKey === 'string' && HEX_KEY.test(storedKey)) {
    // Another key than the one the check was made from would open nothing.
    return check && storedKeyCheck !== check ? 'missing' : 'use'
  }
  return madeHere ? 'missing' : 'make'
}
