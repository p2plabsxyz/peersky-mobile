import { File, Paths } from 'expo-file-system'

import {
  parseHyperdriveRecents,
  serializeHyperdriveRecents
} from './recents.mjs'

type RecentSource = 'fetched' | 'uploaded'
type StoredRecent = { source?: RecentSource }

function getRecentsFile () {
  return new File(Paths.document, 'hyperdrive-recents.json')
}

export function loadHyperdriveRecents<T> (): T[] {
  try {
    const recentsFile = getRecentsFile()
    return recentsFile.exists
      ? parseHyperdriveRecents(recentsFile.textSync()) as T[]
      : []
  } catch {
    return []
  }
}

export function persistHyperdriveRecents (recents: unknown[]) {
  try {
    const recentsFile = getRecentsFile()
    if (!recentsFile.exists) recentsFile.create({ intermediates: true })
    recentsFile.write(serializeHyperdriveRecents(recents))
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
