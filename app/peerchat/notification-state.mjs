export const PEERCHAT_NOTIFICATION_PREFERENCES_VERSION = 1
export const PEERCHAT_NOTIFICATION_PREFERENCES_MAX_BYTES = 256
export const MAX_PEERCHAT_NOTIFICATIONS_PER_POLL = 3

export const DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES = Object.freeze({
  notifications: false,
  sounds: true
})

export function parsePeerChatNotificationPreferences (value) {
  if (typeof value !== 'string' || value.length > PEERCHAT_NOTIFICATION_PREFERENCES_MAX_BYTES) {
    return { ...DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES }
  }
  try {
    const parsed = JSON.parse(value)
    if (parsed?.version !== PEERCHAT_NOTIFICATION_PREFERENCES_VERSION) {
      return { ...DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES }
    }
    return {
      notifications: parsed.notifications === true,
      sounds: parsed.sounds !== false
    }
  } catch {
    return { ...DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES }
  }
}

export function serializePeerChatNotificationPreferences (preferences) {
  return JSON.stringify({
    version: PEERCHAT_NOTIFICATION_PREFERENCES_VERSION,
    notifications: preferences?.notifications === true,
    sounds: preferences?.sounds !== false
  })
}

export function collectPeerChatNotificationCandidates (previousRooms, nextRooms) {
  if (!Array.isArray(previousRooms) || !Array.isArray(nextRooms)) return []
  const previousByKey = new Map(previousRooms.map((room) => [room?.roomKey, room]))

  return nextRooms
    .filter((room) => {
      const previous = previousByKey.get(room?.roomKey)
      return previous &&
        room?.isMuted !== true &&
        Number.isSafeInteger(room?.unreadCount) &&
        room.unreadCount > Math.max(0, Number(previous.unreadCount) || 0) &&
        room?.lastMessage &&
        room.lastMessage.sender &&
        room.lastMessage.message
    })
    .sort((left, right) => Number(left.lastMessage.timestamp) - Number(right.lastMessage.timestamp))
    .slice(-MAX_PEERCHAT_NOTIFICATIONS_PER_POLL)
    .map((room) => ({
      roomKey: room.roomKey,
      title: truncateText(room.name || 'PeerChat', 80),
      body: truncateText(`${room.lastMessage.senderName || 'Peer'}: ${room.lastMessage.message}`, 180)
    }))
}

function truncateText (value, maximum) {
  return Array.from(String(value || ''))
    .map((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || (code >= 127 && code <= 159) ? ' ' : character
    })
    .slice(0, maximum)
    .join('')
    .trim()
}
