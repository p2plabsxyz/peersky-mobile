// What to do with what the system's secure storage gives back for the local
// seal key (local-seal-key.ts), kept apart so it can be tested.
//
// A key once made on this phone is never made again. Android's secure
// storage gives back nothing, and deletes what it held, when its Keystore key
// is gone or cannot open the value, and a new key in its place would leave
// every file the old one locked shut for good. So the phone keeps a check
// made from the key beside its files. With that check, or a file that is
// locked, nothing from the system means the key is missing, not that there
// never was one. A clear of all P2P data removes the check with everything
// the key locked (backend/hyper/p2p-reset.mjs).

export const LOCAL_SEAL_KEY_CHECK_FILE = 'local-seal-key-check.json'

// Files the key locks, in the documents folder. One of them locked means a
// key was made here before the check was kept.
export const LOCAL_SEALED_FILES = Object.freeze([
  'private-drive-key.json',
  'privateHyperdrives.json',
  'device-sync.json',
  'hyperdrive-recents.json',
  'hyper-sdk-synced-private/private-drive-key.json'
])

const HEX_KEY = /^[0-9a-f]{64}$/
const HEX_CHECK = /^[0-9a-f]{32}$/

/** The text hashed for the check: never the key itself on disk. */
export function localSealKeyCheckInput (key) {
  return `peersky-local-seal-key-check:${key}`
}

/** The check from a SHA-256 digest of localSealKeyCheckInput, as hex. */
export function localSealKeyCheckFromDigest (digestHex) {
  return String(digestHex || '').toLowerCase().slice(0, 32)
}

export function parseLocalSealKeyCheck (text) {
  try {
    const parsed = JSON.parse(String(text || ''))
    return parsed?.version === 1 && HEX_CHECK.test(parsed.check || '') ? parsed.check : null
  } catch {
    return null
  }
}

export function serializeLocalSealKeyCheck (check) {
  return JSON.stringify({ version: 1, check })
}

/**
 * 'use' the key the system gave back, 'make' the first one, or 'missing':
 * one was made here and is not what came back, so nothing is made over it.
 * @param {{ storedKey: unknown, storedKeyCheck: string, check: string | null, lockedFiles: boolean }} state
 */
export function decideLocalSealKey ({ storedKey, storedKeyCheck, check, lockedFiles }) {
  if (typeof storedKey === 'string' && HEX_KEY.test(storedKey)) {
    // Another key than the one the check was made from would open nothing.
    return check && storedKeyCheck !== check ? 'missing' : 'use'
  }
  return check || lockedFiles ? 'missing' : 'make'
}
