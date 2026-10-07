// Thirty notes, with a search box once there are more than ten. The text of
// every note this phone hosts is kept beside the list (snapshots.mjs keeps
// thirty-five copies), so any note on it reopens with what was in it.
export const MAX_P2PMD_RECENT_ROOMS = 30
export const P2PMD_RECENT_SEARCH_AFTER = 10
export const MAX_P2PMD_ROOM_HISTORY_FILE_BYTES = 32 * 1024

const MAX_P2PMD_ROOM_KEY_LENGTH = 256
const MIN_P2PMD_ROOM_KEY_LENGTH = 32
// A label is only ever shown, never matched on, but it is still text from a
// document that may have come from someone else. Bound it and keep it on one
// line so it cannot push the history file past its own size limit.
const MAX_P2PMD_ROOM_LABEL_LENGTH = 64

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

/** A private note's key is a secret its host's keys are made from: `hs://s...`. */
export function isPrivateP2pmdNoteKey (key) {
  return /^hs:\/\/s/i.test(String(key || ''))
}

export function filterP2pmdRoomHistory (rooms, query) {
  const needle = String(query || '').trim().toLocaleLowerCase()
  if (!needle) return rooms
  return rooms.filter((room) => [room.label, room.key]
    .some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle)))
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
  role = 'client',
  label = '',
  lastOpenedAt = Date.now()
}) {
  const room = normalizeP2pmdRoomHistoryEntry({ key, role, label, lastOpenedAt })
  if (!room) return rooms

  const known = rooms.find((item) => item.key === room.key)
  // Reopening a note says nothing about its contents, so a name already
  // worked out is kept rather than blanked.
  if (!room.label && known?.label) room.label = known.label
  // Nor does it stop the note being on another device: joined or hosted this
  // time, it is still looked for there first next time.
  if (known?.shared) {
    room.role = 'host'
    room.shared = true
  }

  return parseP2pmdRoomHistory({
    items: [room, ...rooms.filter((item) => item.key !== room.key)]
  })
}

/**
 * Notes another of this person's devices sent, as the backend took them: a
 * hosted one only when this phone now has a copy of it. A note already in the
 * list keeps its name; it becomes shared when it now has a copy here.
 */
export function mergeP2pmdRoomsFromDevice (rooms, incoming) {
  const merged = [...rooms]
  for (const value of Array.isArray(incoming) ? incoming : []) {
    const note = normalizeP2pmdRoomHistoryEntry(value)
    if (!note) continue
    const index = merged.findIndex((item) => item.key === note.key)
    if (index === -1) {
      merged.push(note)
      continue
    }
    const known = merged[index]
    merged[index] = {
      ...known,
      label: known.label || note.label,
      lastOpenedAt: Math.max(known.lastOpenedAt, note.lastOpenedAt),
      ...(note.shared && { role: 'host', shared: true })
    }
  }
  return parseP2pmdRoomHistory({ items: merged })
}

/**
 * Hosted notes that just went to another device with their text. This phone
 * looks for them there before hosting them itself from now on.
 */
export function markP2pmdRoomsShared (rooms, keys) {
  const shared = new Set(Array.isArray(keys) ? keys.map(normalizeP2pmdRoomKey).filter(Boolean) : [])
  if (shared.size === 0) return rooms
  let changed = false
  const next = rooms.map((room) => {
    if (room.role !== 'host' || room.shared || !shared.has(room.key)) return room
    changed = true
    return { ...room, shared: true }
  })
  return changed ? next : rooms
}

export function formatP2pmdRoomHistoryKey (key) {
  const normalized = normalizeP2pmdRoomKey(key)
  if (!normalized) return ''

  const value = normalized.slice('hs://'.length)
  return value.length > 20 ? `${value.slice(0, 20)}...` : value
}

/**
 * A tapped or pasted hs:// address, as a note key.
 *
 * normalizeP2pmdRoomKey also takes a bare key, which is what a field someone
 * types into wants but is wrong for an address bar: "peersky" would read as a
 * note. This only answers for something that said hs:// itself.
 */
export function parseP2pmdNoteLink (value) {
  const text = String(value || '').trim()
  return text.toLowerCase().startsWith('hs://') ? normalizeP2pmdRoomKey(text) : null
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

export function normalizeP2pmdRoomLabel (value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_P2PMD_ROOM_LABEL_LENGTH)
}

// shared: a note this phone hosts that is on another of the person's devices
// too. It is joined there first when that device has it open, and hosted here
// from this phone's copy only when nobody does.
function normalizeP2pmdRoomHistoryEntry (value) {
  const key = normalizeP2pmdRoomKey(value?.key)
  const role = value?.role === 'host' ? 'host' : 'client'
  const label = normalizeP2pmdRoomLabel(value?.label)
  const lastOpenedAt = Number(value?.lastOpenedAt)
  const shared = role === 'host' && value?.shared === true

  if (!key || !Number.isSafeInteger(lastOpenedAt) || lastOpenedAt < 0) {
    return null
  }

  return { key, role, label, lastOpenedAt, ...(shared && { shared: true }) }
}
