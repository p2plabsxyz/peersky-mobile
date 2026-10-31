import { createHash, randomBytes } from 'node:crypto'
import b4a from 'b4a'
import storageKeys from 'hypercore-storage/lib/keys.js'
import { openBytes, sealBytes } from '../hyper/sealed-file.mjs'

// A room's messages are in one log that only this phone writes and nobody
// replicates. Its name used to be the room key itself, which the store keeps
// in its list of names, so anyone with the phone's files had the key to every
// room it was ever in, and every entry was plain JSON: who said it, when, the
// reactions and the join and leave lines. The name is a hash of the key now,
// and each entry is locked with a key kept in PeerChat's own file (logKey),
// which the chat key locks in turn (hyper/sealed-file.mjs). The logs travel
// with that file to a phone a backup or Link Device fills, so they open there.

const LOG_NAME_CONTEXT = 'peersky-peerchat-log:'
const LOG_KEY = /^[0-9a-f]{64}$/
// Entries copied at a time from an old log into its new one.
const MOVE_BATCH = 256
// For the store's rewrite of a removed log's keys (rocksdb-native's
// constants): bottommostLevelCompaction.FORCE, so its entries go from the files
// at the bottom of the store too, and garbageCollectionPolicy.FORCE at any age,
// since hypercore-storage keeps an entry of 4 KiB or more in a blob file of its
// own, which the rewrite otherwise leaves.
const REWRITE = {
  bottommostLevelCompaction: 2,
  blobGarbageCollectionPolicy: 1,
  blobGarbageCollectionAgeCutoff: 1
}

export const ROOM_LOG_NAME = /^chat2-[0-9a-f]{32}$/
export const LEGACY_ROOM_LOG_NAME = /^chat-([0-9a-f]{64})$/

export function roomLogName (roomKey) {
  return `chat2-${createHash('sha256').update(LOG_NAME_CONTEXT + roomKey).digest('hex').slice(0, 32)}`
}

/** The name builds before this gave a room's log. */
export function legacyRoomLogName (roomKey) {
  return `chat-${roomKey}`
}

export function createLogKey () {
  return b4a.toString(randomBytes(32), 'hex')
}

export function normalizeLogKey (value) {
  return typeof value === 'string' && LOG_KEY.test(value) ? value : ''
}

/** JSON entries locked with the log key, for the log's valueEncoding. */
export function sealedEntryEncoding (logKey) {
  const key = b4a.from(logKey, 'hex')
  return {
    encode (value) {
      return sealBytes(b4a.from(JSON.stringify(value)), key)
    },
    decode (bytes) {
      return JSON.parse(b4a.toString(openBytes(bytes, key), 'utf8'))
    }
  }
}

/**
 * Every room log the store has, by name: { name, discoveryKey, roomKey },
 * roomKey only for one named after it.
 */
export async function listStoredRoomLogs (store) {
  const logs = []
  if (!store?.storage?.createAliasStream) return logs
  for await (const { alias, discoveryKey } of store.storage.createAliasStream(store.ns)) {
    const name = alias?.name || ''
    const legacy = LEGACY_ROOM_LOG_NAME.exec(name)
    if (legacy) logs.push({ name, discoveryKey, roomKey: legacy[1] })
    else if (ROOM_LOG_NAME.test(name)) logs.push({ name, discoveryKey, roomKey: '' })
  }
  return logs
}

/**
 * Moves a room's messages from the log named after its key into its new log,
 * then removes the old one: its entries, its name, and the bytes the store
 * still held of them. Returns false when there was no old log.
 *
 * Safe to stop anywhere. The new log is only a copy of the old one's start
 * until PeerChat opens it, so a move cut short starts that copy over. Once
 * the copy is whole the old log goes, and a new log at least as long as an
 * old one still there is already a whole copy, with newer messages after.
 */
export async function moveLegacyRoomLog (store, roomKey, logKey) {
  if (!store?.storage?.getAlias) return false
  const legacyName = legacyRoomLogName(roomKey)
  if (!await store.storage.getAlias({ name: legacyName, namespace: store.ns })) return false

  const legacy = store.get({ name: legacyName, valueEncoding: 'json' })
  let discoveryKey = null
  try {
    await legacy.ready()
    discoveryKey = b4a.from(legacy.discoveryKey)
    const log = store.get({ name: roomLogName(roomKey), valueEncoding: sealedEntryEncoding(logKey) })
    try {
      await log.ready()
      if (log.length < legacy.length) {
        if (log.length > 0) await log.truncate(0)
        for (let index = 0; index < legacy.length; index += MOVE_BATCH) {
          const entries = []
          for (let next = index; next < Math.min(legacy.length, index + MOVE_BATCH); next += 1) {
            // A missing entry keeps its place, so the copy stays in step.
            entries.push(await legacy.get(next, { wait: false }) || {})
          }
          await log.append(entries)
        }
      }
    } finally {
      await log.close()
    }
  } finally {
    await legacy.close()
  }
  // The copy is whole, so from here on only the new log is opened, even when
  // the old one fails to go: it goes at the next start instead. Opened again
  // after part of it went, it would take writes the next start no longer had.
  try {
    await removeStoredLog(store, legacyName, discoveryKey)
  } catch (error) {
    console.warn('[peerchat] Could not remove a moved room log:', error?.message || error)
  }
  return true
}

/**
 * Removes a log the store has: its entries, its name, and the bytes the store
 * still held of them. Nothing may have the log open.
 */
export async function removeStoredLog (store, name, discoveryKey) {
  const storage = store?.storage
  if (!storage) return
  const ranges = []
  const stored = discoveryKey ? await storage.resumeCore(discoveryKey) : null
  if (stored) {
    try {
      const pointer = stored.core
      if (Number.isSafeInteger(pointer?.corePointer)) {
        ranges.push(keyRange(storageKeys.core.core, pointer.corePointer))
      }
      if (Number.isSafeInteger(pointer?.dataPointer)) {
        ranges.push(keyRange(storageKeys.core.data, pointer.dataPointer))
      }
      await storage.deleteCore(pointer)
    } finally {
      await stored.close()
    }
  }
  const tx = storage.db.write({ autoDestroy: true })
  // deleteCore removes the core's own record and the data of its named
  // sessions, not the entries themselves: those stayed in the store with
  // nothing pointing at them. They go here.
  for (const [start, end] of ranges) tx.tryDeleteRange(start, end)
  tx.tryDelete(storageKeys.store.coreByAlias({ name, namespace: store.ns }))
  await tx.flush()
  // A delete only marks the entries gone, and the store's files keep their
  // bytes until it rewrites them. Rewritten now, for this log's keys alone.
  for (const [start, end] of ranges) {
    try {
      await storage.db.compactRange(start, end, REWRITE)
    } catch (error) {
      console.warn('[peerchat] Could not rewrite the store after removing a log:', error?.message || error)
    }
  }
}

// The keys hypercore-storage keeps one core's records under, copied out of
// the buffer it makes them in.
function keyRange (keyOf, pointer) {
  return [b4a.from(keyOf(pointer)), b4a.from(keyOf(pointer + 1))]
}
