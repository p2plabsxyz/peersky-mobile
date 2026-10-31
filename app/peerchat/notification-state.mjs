import { t } from '../i18n/i18n.mjs'

export const PEERCHAT_NOTIFICATION_PREFERENCES_VERSION = 1
export const PEERCHAT_NOTIFICATION_PREFERENCES_MAX_BYTES = 256
export const MAX_PEERCHAT_NOTIFICATIONS_PER_POLL = 3

export const DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES = Object.freeze({
  notifications: true,
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
      // A muted chat stays quiet, except for a new mention, as in most apps.
      const mentioned = Number.isSafeInteger(room?.unreadMentions) &&
        room.unreadMentions > Math.max(0, Number(previous?.unreadMentions) || 0)
      return previous &&
        (room?.isMuted !== true || mentioned) &&
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
      // In a direct message the room is named after the one person in it, so
      // prefixing the body with their name says it twice: "Akhilesh" over
      // "Akhilesh: Hi". A room needs the prefix, because anyone in it could
      // have sent the message.
      body: truncateText(
        room.isDM === true
          ? room.lastMessage.message
          : t('{name}: {message}', { name: room.lastMessage.senderName || t('Peer'), message: room.lastMessage.message }),
        180
      )
    }))
}

// A chat's notifications are taken away once nothing in it is unread, which is
// when it was opened, or when it was left. Only notifications that name a chat
// are touched; one for a chat still unread stays.
export function collectSeenPeerChatNotifications (presented, rooms) {
  if (!Array.isArray(presented) || presented.length === 0) return []
  const unread = new Set((Array.isArray(rooms) ? rooms : [])
    .filter((room) => Number.isSafeInteger(room?.unreadCount) && room.unreadCount > 0)
    .map((room) => String(room.roomKey).toLowerCase()))
  return presented
    .filter((item) => typeof item?.identifier === 'string' &&
      item.identifier !== '' &&
      typeof item.roomKey === 'string' &&
      /^[a-f0-9]{64}$/i.test(item.roomKey) &&
      !unread.has(item.roomKey.toLowerCase()))
    .map((item) => item.identifier)
}

// Worth a look at the notification list: the first check since PeerChat
// started, when one could be left from before, or a chat that had unread
// messages has none now.
export function shouldClearSeenPeerChatNotifications (previousRooms, nextRooms) {
  if (!Array.isArray(previousRooms)) return true
  const next = new Map((Array.isArray(nextRooms) ? nextRooms : []).map((room) => [room?.roomKey, room]))
  return previousRooms.some((room) => Number(room?.unreadCount) > 0 &&
    !(Number(next.get(room?.roomKey)?.unreadCount) > 0))
}

export function shouldHandlePeerChatNotificationInApp (isPeerChatVisible, appState) {
  return isPeerChatVisible === true && appState === 'active'
}

// A profile brought from another device, by Link Device or a restore, skips
// onboarding, which is where the system is asked about notifications. They
// showed as on while Android or iOS had never been asked, and nothing ever
// arrived. They are asked once, the first time PeerChat is open with chats.
export function shouldAskForPeerChatNotifications ({
  asked,
  isPeerChatVisible,
  isReady,
  isRuntimeReady,
  notificationsEnabled,
  roomCount
}) {
  return asked !== true &&
    isReady === true &&
    isRuntimeReady === true &&
    isPeerChatVisible === true &&
    notificationsEnabled === true &&
    Number.isSafeInteger(roomCount) &&
    roomCount > 0
}

export function shouldEnablePeerChatBackground ({ isRuntimeReady, notificationsEnabled, roomCount }) {
  return isRuntimeReady === true &&
    notificationsEnabled === true &&
    Number.isSafeInteger(roomCount) &&
    roomCount > 0
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
