import { File, Paths } from 'expo-file-system'

import {
  parseHyperdriveRecents,
  serializeHyperdriveRecents
} from './recents.mjs'

type RecentSource = 'fetched' | 'uploaded'
type StoredRecent = { source?: RecentSource }

const RECENTS_FILE = new File(Paths.document, 'hyperdrive-recents.json')

export function loadHyperdriveRecents<T> (): T[] {
  try {
    return RECENTS_FILE.exists
      ? parseHyperdriveRecents(RECENTS_FILE.textSync()) as T[]
      : []
  } catch {
    return []
  }
}

export function persistHyperdriveRecents (recents: unknown[]) {
  try {
    if (!RECENTS_FILE.exists) RECENTS_FILE.create({ intermediates: true })
    RECENTS_FILE.write(serializeHyperdriveRecents(recents))
    return true
  } catch {
    return false
  }
}

export function clearHyperdriveRecents (source?: RecentSource) {
  if (!source) {
    try {
      if (RECENTS_FILE.exists) RECENTS_FILE.delete()
      return true
    } catch {
      return false
    }
  }

  const remaining = loadHyperdriveRecents<StoredRecent>()
    .filter((item) => item.source !== source)
  return persistHyperdriveRecents(remaining)
}
