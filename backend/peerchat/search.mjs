// Searching the messages kept on this phone, every chat at once, for the chat
// list's search box. It reads only what is stored here, so nobody else learns
// what was searched for.

// As long as a search box takes.
export const MAX_PEERCHAT_SEARCH_QUERY_CHARACTERS = 100
// The newest this many matches, across every chat.
export const MAX_PEERCHAT_SEARCH_RESULTS = 50
// How far back each chat is searched, newest first: twice as far as a chat
// shows when it opens.
export const MAX_PEERCHAT_SEARCHED_ENTRIES = 2000
// Of a long message, the start is what is searched and kept between searches.
export const MAX_PEERCHAT_SEARCHED_CHARACTERS = 2000
// Decrypted text kept between searches, so typing one more letter does not
// open every message again. Past this, the next search starts over.
export const MAX_PEERCHAT_SEARCH_CACHE_CHARACTERS = 2_000_000

const SNIPPET_BEFORE = 30
const SNIPPET_AFTER = 70

export function normalizePeerChatSearchQuery (query) {
  if (typeof query !== 'string') return ''
  return Array.from(query.trim())
    .slice(0, MAX_PEERCHAT_SEARCH_QUERY_CHARACTERS)
    .join('')
    .toLocaleLowerCase()
}

// A message's words around the first place the search matched, on one line,
// with an ellipsis where it was cut.
export function peerChatSearchSnippet (text, query) {
  const line = String(text || '').replace(/\s+/g, ' ').trim()
  const needle = normalizePeerChatSearchQuery(query)
  const at = needle ? line.toLocaleLowerCase().indexOf(needle) : -1
  if (at < 0) return truncate(line, SNIPPET_BEFORE + SNIPPET_AFTER)

  let start = Math.max(0, at - SNIPPET_BEFORE)
  // From the start of a word, unless that loses the match.
  if (start > 0) {
    const space = line.indexOf(' ', start)
    if (space >= 0 && space < at) start = space + 1
  }
  let end = Math.min(line.length, at + needle.length + SNIPPET_AFTER)
  if (end < line.length) {
    const space = line.lastIndexOf(' ', end)
    if (space > at + needle.length) end = space
  }
  return `${start > 0 ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`
}

function truncate (line, length) {
  return line.length > length ? `${line.slice(0, length).trimEnd()}…` : line
}
