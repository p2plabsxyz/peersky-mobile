// node:fs and node:path, not the bare modules: backend/bare-imports.json maps
// them at bundle time, and this way it runs under node tests on real folders.
import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import b4a from 'b4a'

// Clear all P2P data takes this device's identity with it, as Reset P2P data
// with identities does on the desktop. Everything it removes is first moved
// into this folder, and the folder being there means a clear was asked for:
// a start that finds it finishes the job before any store opens. Half an
// identity left behind, a desktop's key without the drives it opened, or the
// list of linked devices without the key that met them, is worse than either.
export const P2P_RESET_DIR = '.peersky-p2p-reset'
// Renamed to this once everything is in it. A start that finds one only
// deletes it, and never takes what has been made since.
export const P2P_RESET_TRASH_DIR = '.peersky-p2p-reset-trash'

// What goes from the identity folder, beside the stores.
export const P2P_IDENTITY_ENTRIES = Object.freeze([
  // This device's own keys for Link Device, and the code it last showed.
  'device-key.json',
  'pairing-nonce.json',
  // The identity a desktop linked this phone to: its record, the key private
  // files are encrypted with, and the private drives it sent.
  'peersky-identity.json',
  'private-drive-key.json',
  'privateHyperdrives.json',
  'hyper-private',
  // The other devices met under that key, and their drives this phone opens.
  'device-sync.json',
  'device-sync.json.tmp',
  'linked-private-drives.json',
  'linked-private-drives.json.tmp',
  // What another device sent and the apps have not taken yet, and a transfer
  // on its way out.
  'peerchat-incoming.json',
  'p2pmd-incoming.json',
  '.peersky-transfer',
  // What the apps keep about the data that goes: PeerChat's open chats and
  // drafts, the name P2PMD shows and its recent notes, and Hyperdrive's
  // recent files.
  'peerchat-ui-state.json',
  'p2pmd-profile.json',
  'p2pmd-room-history.json',
  'hyperdrive-recents.json',
  // The checks that say a seal key and a chat key were made here. Nothing
  // they locked is left, so a phone whose key was lost may make a new one
  // (app/privacy/local-seal-key-state.mjs).
  'local-seal-key-check.json',
  'chat-seal-key-check.json'
])

// Kept beside each store: what it has published and fetched, and the folders
// kept offline from it.
const STORE_SIDECARS = ['-archive.json', '-archive.json.temporary', '-offline.json', '-offline.json.temporary']

/**
 * Every path a clear removes: the stores, what is kept beside them, and the
 * identity. Only paths inside the identity folder, which on a phone holds the
 * stores too, so a path worked out wrong can never take anything else.
 */
export function listP2pResetTargets ({ identityPath, stores = [] }) {
  const root = trimSlashes(identityPath)
  if (!root) return []
  const targets = []
  for (const store of stores) {
    const path = trimSlashes(store)
    if (!path) continue
    targets.push(path, ...STORE_SIDECARS.map((suffix) => `${path}${suffix}`))
  }
  targets.push(...P2P_IDENTITY_ENTRIES.map((name) => join(root, name)))
  return [...new Set(targets)].filter((target) => isInside(root, target))
}

// A new id for each clear, kept apart from all it removes. A page that keeps
// data of its own sees the id (window.peerskyResetId) and can tell what it
// holds is from before a clear: PeerTunes' songs live in the page's own
// storage, which no clear here reaches.
export const P2P_RESET_ID_FILE = 'p2p-reset-id.json'

/** This device's reset id, made the first time it is asked for. */
export function readP2pResetId (identityPath) {
  const root = trimSlashes(identityPath)
  if (!root || !isAbsolute(root)) return ''
  try {
    const { id } = JSON.parse(readFileSync(join(root, P2P_RESET_ID_FILE), 'utf8'))
    if (typeof id === 'string' && /^[0-9a-f]{32}$/.test(id)) return id
  } catch {}
  return writeP2pResetId(root)
}

function writeP2pResetId (root) {
  const id = b4a.toString(randomBytes(16), 'hex')
  try {
    writeFileSync(join(root, P2P_RESET_ID_FILE), JSON.stringify({ version: 1, id }))
    return id
  } catch {
    return ''
  }
}

/** Marks a clear as asked for. Nothing is removed yet. */
export function beginP2pReset (identityPath) {
  mkdirSync(join(trimSlashes(identityPath), P2P_RESET_DIR), { recursive: true })
}

/**
 * Removes every target, once a clear has begun. Each is moved out of the way
 * first, so a clear the app is killed in leaves nothing half in place, then
 * the lot is deleted. Something that can be neither moved nor deleted is
 * left and named in `failed`, rather than tried again on every start: that
 * would take whatever was made since along with it each time.
 */
export function finishP2pReset ({ identityPath, targets }) {
  const root = trimSlashes(identityPath)
  const resetPath = join(root, P2P_RESET_DIR)
  if (!existsSync(resetPath)) return { ok: true, removed: [], failed: [] }

  const removed = []
  const failed = []
  targets.forEach((target, index) => {
    if (!isInside(root, target) || !exists(target)) return
    try {
      renameSync(target, join(resetPath, `${index}-${basename(target)}`))
      removed.push(target)
    } catch {
      try {
        rmSync(target, { recursive: true, force: true })
        removed.push(target)
      } catch {
        failed.push(target)
      }
    }
  })

  // Before the mark goes, so a clear the app is killed in still gets one.
  if (isAbsolute(root)) writeP2pResetId(root)

  // Under a name of its own, so the mark that a clear is waiting goes in the
  // same step as everything it moved.
  let trashPath = join(root, P2P_RESET_TRASH_DIR)
  for (let count = 1; exists(trashPath); count++) trashPath = join(root, `${P2P_RESET_TRASH_DIR}-${count}`)
  try {
    renameSync(resetPath, trashPath)
  } catch {
    trashPath = resetPath
  }
  try {
    rmSync(trashPath, { recursive: true, force: true })
  } catch {}
  return { ok: true, removed, failed }
}

/**
 * Run as the backend starts, before any store opens: deletes what a finished
 * clear left to delete, and finishes one the app was killed in.
 */
export function recoverP2pReset ({ identityPath, targets }) {
  const root = trimSlashes(identityPath)
  if (!root) return false
  let names = []
  try {
    names = readdirSync(root)
  } catch {}
  for (const name of names) {
    if (name !== P2P_RESET_TRASH_DIR && !name.startsWith(`${P2P_RESET_TRASH_DIR}-`)) continue
    try {
      rmSync(join(root, name), { recursive: true, force: true })
    } catch {}
  }
  if (!existsSync(join(root, P2P_RESET_DIR))) return false
  finishP2pReset({ identityPath: root, targets })
  return true
}

function exists (path) {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function isInside (root, target) {
  return target.startsWith(`${root}/`) && !target.slice(root.length + 1).split('/').includes('..')
}

function trimSlashes (path) {
  return typeof path === 'string' ? path.replace(/[/\\]+$/, '') : ''
}
