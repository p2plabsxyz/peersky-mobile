export const MAX_P2PMD_RECENT_ROOMS = 5
export const MAX_P2PMD_ROOM_HISTORY_FILE_BYTES = 8 * 1024

const MAX_P2PMD_ROOM_KEY_LENGTH = 256
const MIN_P2PMD_ROOM_KEY_LENGTH = 32

export function parseP2pmdRoomHistory (serialized) {
  let value

  try {
    value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized
  } catch {
    return []
  }

  if (!value || !Array.isArray(value.items)) return []

  const roomsByKey = new Map()
  const candidates = value.items.slice(0, MAX_P2PMD_RECENT_ROOMS * 4)

  for (const item of candidates) {
    const room = normalizeP2pmdRoomHistoryEntry(item)
    if (!room) continue

    const existing = roomsByKey.get(room.key)
    if (!existing || room.lastOpenedAt > existing.lastOpenedAt) {
      roomsByKey.set(room.key, room)
    }
  }

  return Array.from(roomsByKey.values())
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
    .slice(0, MAX_P2PMD_RECENT_ROOMS)
}

export function serializeP2pmdRoomHistory (rooms) {
  return JSON.stringify({
    items: parseP2pmdRoomHistory({ items: rooms })
  })
}

export function readP2pmdRoomHistoryFile (file) {
  if (!file.exists) return []

  const size = Number(file.size)
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > MAX_P2PMD_ROOM_HISTORY_FILE_BYTES
  ) {
    return []
  }

  return parseP2pmdRoomHistory(file.textSync())
}

export function writeP2pmdRoomHistoryFile (file, rooms) {
  const serialized = serializeP2pmdRoomHistory(rooms)
  if (serialized.length > MAX_P2PMD_ROOM_HISTORY_FILE_BYTES) {
    throw new Error('P2PMD room history is too large.')
  }

  if (!file.exists) file.create({ intermediates: true })
  file.write(serialized)
}

export function recordP2pmdRoom (rooms, {
  key,
  lastOpenedAt = Date.now()
}) {
  const room = normalizeP2pmdRoomHistoryEntry({ key, lastOpenedAt })
  if (!room) return rooms

  return parseP2pmdRoomHistory({
    items: [room, ...rooms.filter((item) => item.key !== room.key)]
  })
}

export function formatP2pmdRoomHistoryKey (key) {
  const normalized = normalizeP2pmdRoomKey(key)
  if (!normalized) return ''

  const value = normalized.slice('hs://'.length)
  return value.length > 20 ? `${value.slice(0, 20)}...` : value
}

export function normalizeP2pmdRoomKey (key) {
  const value = String(key || '').trim()
  const baseKey = value.toLowerCase().startsWith('hs://')
    ? value.slice('hs://'.length)
    : value

  if (
    baseKey.length < MIN_P2PMD_ROOM_KEY_LENGTH ||
    baseKey.length > MAX_P2PMD_ROOM_KEY_LENGTH ||
    !/^[a-z0-9]+$/i.test(baseKey)
  ) {
    return null
  }

  return `hs://${baseKey}`
}

function normalizeP2pmdRoomHistoryEntry (value) {
  const key = normalizeP2pmdRoomKey(value?.key)
  const lastOpenedAt = Number(value?.lastOpenedAt)

  if (!key || !Number.isSafeInteger(lastOpenedAt) || lastOpenedAt < 0) {
    return null
  }

  return { key, lastOpenedAt }
}
