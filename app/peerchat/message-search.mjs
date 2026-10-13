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

// The chats a search names: by name, or by key for whoever pastes one. What
// was said in them is searched on its own, every message and not only the
// last, and listed after them. See searchMessages in the backend.
export function filterPeerChatRooms (rooms, query) {
  if (!Array.isArray(rooms)) return []
  const normalizedQuery = normalizeSearchQuery(query)
  if (!normalizedQuery) return rooms

  // A key is 64 hex characters, so a letter or two matched nearly every
  // room. It counts once enough of one is typed, as on the desktop.
  const byKey = /^[0-9a-f]{8,}$/.test(normalizedQuery)
  return rooms.filter((room) => (
    (typeof room?.name === 'string' && room.name.toLocaleLowerCase().includes(normalizedQuery)) ||
    (byKey && typeof room?.roomKey === 'string' && room.roomKey.toLowerCase().includes(normalizedQuery))
  ))
}

// A search result's words split where they match, so the match can be shown
// in bold.
export function splitPeerChatSearchMatch (text, query) {
  const value = typeof text === 'string' ? text : ''
  const normalizedQuery = normalizeSearchQuery(query)
  if (!normalizedQuery || !value) return value ? [{ text: value, match: false }] : []
  const lower = value.toLocaleLowerCase()
  // Only where lower-casing kept the length, so the positions line up.
  if (lower.length !== value.length) return [{ text: value, match: false }]
  const parts = []
  let from = 0
  for (let at = lower.indexOf(normalizedQuery); at >= 0; at = lower.indexOf(normalizedQuery, from)) {
    if (at > from) parts.push({ text: value.slice(from, at), match: false })
    parts.push({ text: value.slice(at, at + normalizedQuery.length), match: true })
    from = at + normalizedQuery.length
  }
  if (from < value.length) parts.push({ text: value.slice(from), match: false })
  return parts
}

export function filterPeerChatMembers (members, query) {
  if (!Array.isArray(members)) return []
  const normalizedQuery = normalizeSearchQuery(query)
  if (!normalizedQuery) return members

  return members.filter((member) => [
    member?.username,
    member?.bio,
    member?.id
  ].some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(normalizedQuery)))
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

export function isPeerChatNearBottom (metrics, threshold = 80) {
  const { contentHeight, viewportHeight, offsetY } = metrics || {}
  if (![contentHeight, viewportHeight, offsetY, threshold].every(Number.isFinite)) return true
  if (contentHeight < 0 || viewportHeight < 0 || threshold < 0) return true
  return contentHeight - viewportHeight - Math.max(0, offsetY) <= threshold
}

function normalizeSearchQuery (query) {
  if (typeof query !== 'string') return ''
  return Array.from(query.trim())
    .slice(0, PEERCHAT_SEARCH_QUERY_MAX_CHARACTERS)
    .join('')
    .toLocaleLowerCase()
}
