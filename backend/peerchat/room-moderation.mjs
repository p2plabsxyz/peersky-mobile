import { PRE_JOINED_PEERCHAT_ROOM_KEY } from './rooms.mjs'

/**
 * Who may remove people from a room, and who has been removed.
 *
 * With no server, "removed" is what every honest client agrees to do. The
 * hyperswarm handshake gives each side the other's public key, so a removal is
 * checked against the connection it arrived on, with no signing needed. The
 * room records only the first 8 characters of the creator's key, and a match
 * for 32 bits can be ground in minutes, so that is only for display. Removals
 * check the full key.
 */

const CREATOR_KEY_PATTERN = /^[a-f0-9]{64}$/
const PEER_ID_PATTERN = /^[a-f0-9]{8}$/
// A room holds its own removals. Well past what a real room needs, and small
// enough that a peer cannot grow one unboundedly by relaying.
export const MAX_PEERCHAT_ROOM_BANS = 512
const BAN_NAME_MAX_LENGTH = 50
const BAN_NAME_PATTERN = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/

/**
 * Creator keys that ship with the app. P2P Republic predates creator keys, so
 * its record has only the short id. Nothing announced over the network can be
 * trusted to fill in the rest, so the key is pinned here rather than taken from
 * whoever announces first. A public key is safe in the source: peers hand it
 * to each other on every connection.
 */
export const PINNED_PEERCHAT_CREATOR_KEYS = Object.freeze({
  // Read off the device that runs P2P Republic with scripts/creator-key.mjs in
  // the peerchat repo. It does not match the room's recorded createdBy, which
  // is from a storage the device no longer has: the pin is what decides, and it
  // overrides anything stored or announced.
  [PRE_JOINED_PEERCHAT_ROOM_KEY]: '42430624a528ba7d4951b351e6615b8513646f0fe1ab76372024fa4ab7e23d60'
})

export function normalizePeerChatCreatorKey (value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return CREATOR_KEY_PATTERN.test(key) ? key : ''
}

/** The short id that key would appear as in a room record or a member list. */
export function peerIdForCreatorKey (creatorKey) {
  return normalizePeerChatCreatorKey(creatorKey).slice(0, 8)
}

/**
 * The creator key a room should be judged by.
 *
 * A pinned key always wins. Nothing announced over the network can replace it,
 * which is the point of pinning.
 */
export function resolvePeerChatCreatorKey (roomKey, storedKey) {
  const pinned = normalizePeerChatCreatorKey(PINNED_PEERCHAT_CREATOR_KEYS[roomKey])
  return pinned || normalizePeerChatCreatorKey(storedKey)
}

/**
 * Whether a room may take this as its creator key.
 *
 * Only from the creator themselves: the announcement has to arrive on a
 * connection whose own public key is the key being announced. Anyone can claim
 * to know who made a room; only one peer can prove it. And when the room
 * already remembers a short creator id, the key has to match that too.
 */
export function acceptsPeerChatCreatorKey ({
  roomKey,
  storedKey,
  createdBy,
  announcedKey,
  connectionKey
}) {
  if (resolvePeerChatCreatorKey(roomKey, storedKey)) return false

  const announced = normalizePeerChatCreatorKey(announcedKey)
  if (!announced) return false
  if (announced !== normalizePeerChatCreatorKey(connectionKey)) return false

  const shortId = typeof createdBy === 'string' ? createdBy.trim().toLowerCase() : ''
  if (PEER_ID_PATTERN.test(shortId) && shortId !== peerIdForCreatorKey(announced)) return false

  return true
}

/** Whether a removal that arrived on this connection is the creator's. */
export function isPeerChatRoomCreator ({ roomKey, storedKey, connectionKey }) {
  const creatorKey = resolvePeerChatCreatorKey(roomKey, storedKey)
  return creatorKey !== '' && creatorKey === normalizePeerChatCreatorKey(connectionKey)
}

/**
 * The removals for one room.
 *
 * Kept by full key where the creator had a connection to take it from, and by
 * short id otherwise, because somebody can be removed while they are offline
 * and the room only remembers the short one for them.
 */
export function normalizePeerChatRoomBans (value) {
  if (!Array.isArray(value)) return []

  const byId = new Map()
  for (const entry of value) {
    const key = normalizePeerChatCreatorKey(entry?.key)
    const id = key
      ? peerIdForCreatorKey(key)
      : (typeof entry?.id === 'string' ? entry.id.trim().toLowerCase() : '')
    if (!PEER_ID_PATTERN.test(id)) continue

    const at = Number.isSafeInteger(entry?.at) && entry.at > 0 ? entry.at : 0
    const name = normalizeBanName(entry?.name)
    const existing = byId.get(id)
    // A full key is worth more than a short id, so it wins the slot.
    if (existing && (!key || existing.key)) {
      if (!existing.name && name) existing.name = name
      continue
    }
    byId.set(id, { id, key, at, name: name || existing?.name || '' })

    if (byId.size >= MAX_PEERCHAT_ROOM_BANS) break
  }

  return [...byId.values()]
}

// The name the creator knew them by, so a device that never met them says who
// was removed instead of eight letters of their key. The same rule as a
// profile name, so nothing else can ride in on it.
function normalizeBanName (value) {
  if (typeof value !== 'string') return ''
  const name = value.trim().replace(/\s+/g, ' ')
  return name.length <= BAN_NAME_MAX_LENGTH && BAN_NAME_PATTERN.test(name) ? name : ''
}

export function addPeerChatRoomBan (bans, { id, key, at = Date.now(), name = '' }) {
  const normalizedKey = normalizePeerChatCreatorKey(key)
  const normalizedId = normalizedKey
    ? peerIdForCreatorKey(normalizedKey)
    : (typeof id === 'string' ? id.trim().toLowerCase() : '')
  if (!PEER_ID_PATTERN.test(normalizedId)) return normalizePeerChatRoomBans(bans)

  return normalizePeerChatRoomBans([
    { id: normalizedId, key: normalizedKey, at, name },
    ...(Array.isArray(bans) ? bans : [])
  ])
}

export function removePeerChatRoomBan (bans, id) {
  const normalizedId = typeof id === 'string' ? id.trim().toLowerCase() : ''
  return normalizePeerChatRoomBans(bans).filter((ban) => ban.id !== normalizedId)
}

/**
 * Whether this peer has been removed from the room.
 *
 * Asked about a connection, the full key decides and cannot be faked. Asked
 * about a bare peer id, which is all a member list has, the short id decides:
 * eight characters can be ground for, so that answer is a best effort, but it
 * only ever hides a row rather than deciding what anybody may send.
 */
export function isPeerChatPeerBanned (bans, { peerId, connectionKey }) {
  const key = normalizePeerChatCreatorKey(connectionKey)
  const id = key
    ? peerIdForCreatorKey(key)
    : (typeof peerId === 'string' ? peerId.trim().toLowerCase() : '')
  if (!PEER_ID_PATTERN.test(id)) return false

  for (const ban of normalizePeerChatRoomBans(bans)) {
    if (ban.id !== id) continue
    // With a key on both sides, only that exact person is out, so somebody who
    // happens to share the first eight characters is not caught by it. Asking
    // about a bare id is a different question: a member list holds nothing but
    // short ids, and answering "no" there left everybody removed still sitting
    // in it.
    if (ban.key && key) return ban.key === key
    return true
  }

  return false
}
