import { File, Paths } from 'expo-file-system'

import { getLocalSealKey, isLocalSealKeyMissing, localRandomBytes } from '../privacy/local-seal-key'
import { openText, sealText } from '../privacy/sealed-text.mjs'
import {
  parseHyperdriveRecents,
  serializeHyperdriveRecents
} from './recents.mjs'

type RecentSource = 'fetched' | 'uploaded'
type StoredRecent = { source?: RecentSource }

function getRecentsFile () {
  return new File(Paths.document, 'hyperdrive-recents.json')
}

// The list names private uploads, so it is locked with the key the system
// keeps for this phone (app/privacy/local-seal-key.ts). Read before that key
// is known, a locked list comes back empty and is not written over; the
// Hyperdrive screen reads it again once the key is there.
let lockedUntilKey = false

export function loadHyperdriveRecents<T> (): T[] {
  try {
    const recentsFile = getRecentsFile()
    if (!recentsFile.exists) {
      lockedUntilKey = false
      return []
    }
    const key = getLocalSealKey()
    const opened = openText(recentsFile.textSync(), key)
    lockedUntilKey = false
    const recents = parseHyperdriveRecents(opened.text) as T[]
    // One written before locking came in is locked as soon as it is read.
    if (!opened.sealed && key) recentsFile.write(sealText(serializeHyperdriveRecents(recents), key, localRandomBytes))
    return recents
  } catch {
    lockedUntilKey = !getLocalSealKey()
    return []
  }
}

export function persistHyperdriveRecents (recents: unknown[]) {
  if (lockedUntilKey) return false
  try {
    const recentsFile = getRecentsFile()
    if (!recentsFile.exists) recentsFile.create({ intermediates: true })
    const text = serializeHyperdriveRecents(recents)
    const key = getLocalSealKey()
    // The key made here could not be read: the names stay off the disk
    // rather than going on it in the open.
    if (!key && isLocalSealKeyMissing()) return false
    recentsFile.write(key ? sealText(text, key, localRandomBytes) : text)
    return true
  } catch {
    return false
  }
}

// The Hyperdrive screen can stay open under Settings. It hears when Settings
// clears recents, rather than going on showing ones that are gone.
const clearedListeners = new Set<() => void>()

export function onHyperdriveRecentsCleared (listener: () => void) {
  clearedListeners.add(listener)
  return () => { clearedListeners.delete(listener) }
}

export function clearHyperdriveRecents (source?: RecentSource) {
  let cleared = false
  if (!source) {
    try {
      const recentsFile = getRecentsFile()
      if (recentsFile.exists) recentsFile.delete()
      cleared = true
    } catch {
      cleared = false
    }
  } else {
    const remaining = loadHyperdriveRecents<StoredRecent>()
      .filter((item) => item.source !== source)
    cleared = persistHyperdriveRecents(remaining)
  }
  if (cleared) for (const listener of clearedListeners) listener()
  return cleared
}
