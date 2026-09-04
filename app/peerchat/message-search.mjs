export const PEERCHAT_SEARCH_QUERY_MAX_CHARACTERS = 100

export function filterPeerChatMessages (messages, query) {
  if (!Array.isArray(messages)) return []
  const normalizedQuery = normalizeSearchQuery(query)
  if (!normalizedQuery) return messages

  return messages.filter((message) => [
    message?.message,
    message?.senderName,
    message?.replyTo?.text,
    message?.replyTo?.sn
  ].some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(normalizedQuery)))
}

export function filterPeerChatRooms (rooms, query) {
  if (!Array.isArray(rooms)) return []
  const normalizedQuery = normalizeSearchQuery(query)
  if (!normalizedQuery) return rooms

  return rooms.filter((room) => [
    room?.name,
    room?.roomKey,
    room?.lastMessage?.message,
    room?.lastMessage?.senderName
  ].some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(normalizedQuery)))
}

export function getFirstUnreadMessageIndex (messages, lastReadTs) {
  if (!Array.isArray(messages) || !Number.isSafeInteger(lastReadTs) || lastReadTs <= 0) return -1
  return messages.findIndex((message) => Number.isSafeInteger(message?.timestamp) && message.timestamp > lastReadTs)
}

export function formatPeerChatDateLabel (timestamp, now = Date.now()) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !Number.isSafeInteger(now) || now < 0) return ''
  const date = new Date(timestamp)
  const today = new Date(now)
  const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const daysAgo = Math.round((todayDay - dateDay) / 86_400_000)

  if (daysAgo === 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo > 1 && daysAgo < 7) return date.toLocaleDateString([], { weekday: 'long' })
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatPeerChatMessageDetails (timestamp) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) return 'Sent time unavailable'
  const date = new Date(timestamp)
  const day = date.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  return `Sent ${day} at ${date.toLocaleTimeString()}`
}

function normalizeSearchQuery (query) {
  if (typeof query !== 'string') return ''
  return Array.from(query.trim())
    .slice(0, PEERCHAT_SEARCH_QUERY_MAX_CHARACTERS)
    .join('')
    .toLocaleLowerCase()
}
