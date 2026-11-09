// node:fs and node:path, which backend/bare-imports.json maps to the bare
// modules at bundle time, so this also runs under node tests on real folders.
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { P2P_IDENTITY_ENTRIES } from './p2p-reset.mjs'

// How much space P2P data takes on this phone, by part, for Settings, P2P
// Data. The parts are the desktop's, as far as a phone has them, and every
// path is one Clear all P2P data removes, so the total is what it frees.

// Kept beside each store: what it published and fetched, and the folders
// kept offline from it.
const STORE_SIDECARS = ['-archive.json', '-archive.json.temporary', '-offline.json', '-offline.json.temporary']

// File system calls in flight at once. A store can hold thousands of files,
// and the worklet that reads them also runs every Hyper connection.
const MAX_PENDING = 8

/**
 * The paths of each part. The public store holds the public drives, the
 * drives and sites opened here, the folders kept offline, PeerChat's rooms
 * and their files, and P2PMD's notes.
 */
export function listP2pStorageParts ({ identityPath, publicStore, syncedPrivateStore, adoptedStore, deviceOnlyStore }) {
  const root = trimSlashes(identityPath)
  const stores = [publicStore, syncedPrivateStore, adoptedStore, deviceOnlyStore].map(trimSlashes).filter(Boolean)
  const parts = [
    { id: 'hyper', paths: [trimSlashes(publicStore)] },
    // Private uploads, the drives a desktop sent, and the private files of
    // the person's other devices opened here.
    { id: 'hyperPrivate', paths: [trimSlashes(syncedPrivateStore), trimSlashes(adoptedStore), root && join(root, 'hyper-private')] },
    // Files kept on this phone only, never synced.
    { id: 'deviceOnly', paths: [trimSlashes(deviceOnlyStore)] },
    // The lists beside the stores, the apps' records of what they keep, and
    // the keys for Link Device and private files.
    {
      id: 'other',
      paths: [
        ...stores.flatMap((store) => STORE_SIDECARS.map((suffix) => `${store}${suffix}`)),
        ...(root ? P2P_IDENTITY_ENTRIES.filter((name) => name !== 'hyper-private').map((name) => join(root, name)) : [])
      ]
    }
  ]
  return parts.map((part) => ({ id: part.id, paths: [...new Set(part.paths.filter(Boolean))] }))
}

/** Adds up each part, and all of them. Something unreadable counts as nothing. */
export async function measureP2pStorage (parts, { maxPending = MAX_PENDING } = {}) {
  const run = limit(maxPending)
  // A file with several names is counted once, wherever it is met.
  const seen = new Set()
  const sizes = {}
  let total = 0
  for (const part of parts) {
    let bytes = 0
    for (const target of part.paths) bytes += await sizeOf(target, seen, run)
    sizes[part.id] = bytes
    total += bytes
  }
  return { total, parts: sizes }
}

function limit (max) {
  let active = 0
  const waiting = []
  return async function run (task) {
    if (active >= max) await new Promise((resolve) => waiting.push(resolve))
    active++
    try {
      return await task()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}

// The space a file takes on disk, counted the way du counts it: the blocks it
// has, so a sparse file is not counted as full.
function usedBytes (info, seen) {
  if (!info.isDirectory() && info.nlink > 1) {
    const id = `${info.dev}:${info.ino}`
    if (seen.has(id)) return 0
    seen.add(id)
  }
  return typeof info.blocks === 'number' && info.blocks >= 0 ? info.blocks * 512 : info.size
}

// A link is counted as a link, never followed.
async function sizeOf (target, seen, run) {
  let info
  try {
    info = await run(() => fs.lstat(target))
  } catch {
    // Not there, as before anything was saved, or gone since its folder was
    // read, as during a clear.
    return 0
  }
  let bytes = usedBytes(info, seen)
  if (!info.isDirectory()) return bytes
  let names
  try {
    names = await run(() => fs.readdir(target))
  } catch {
    return bytes
  }
  const sizes = await Promise.all(names.map((name) => sizeOf(join(target, String(name)), seen, run)))
  for (const size of sizes) bytes += size
  return bytes
}

function trimSlashes (value) {
  return typeof value === 'string' ? value.replace(/[/\\]+$/, '') : ''
}
