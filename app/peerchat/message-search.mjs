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

function normalizeSearchQuery (query) {
  if (typeof query !== 'string') return ''
  return Array.from(query.trim())
    .slice(0, PEERCHAT_SEARCH_QUERY_MAX_CHARACTERS)
    .join('')
    .toLocaleLowerCase()
}
