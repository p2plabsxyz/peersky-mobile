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

export function clearHyperdriveRecents (source?: RecentSource) {
  if (!source) {
    try {
      const recentsFile = getRecentsFile()
      if (recentsFile.exists) recentsFile.delete()
      return true
    } catch {
      return false
    }
  }

  const remaining = loadHyperdriveRecents<StoredRecent>()
    .filter((item) => item.source !== source)
  return persistHyperdriveRecents(remaining)
}
