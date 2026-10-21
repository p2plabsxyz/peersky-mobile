import { findMentions, personName } from '../../backend/peerchat/mentions.mjs'

// What desktop linkifies, plus hs://, which is how a P2PMD note is shared and
// was the one address in this list that stayed plain text on both. peersky://
// and hyper:// matter most: they are how a room invite and a drive get passed
// around, and they were not tappable on the phone at all.
const MESSAGE_LINK = /(?:https?|hs|hyper|ipfs|ipns|peersky|bt|bittorrent):\/\/[^\s<>"']+|magnet:\?[^\s<>"']+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

// Trailing punctuation belongs to the sentence, not the address. A link at the
// end of "see hyper://key/index.html." keeps the dot out of what gets opened,
// and one in **bold** or ~struck out~ keeps the closing marks.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"*~]+$/

/** Splits a message into plain, mention and link runs, in reading order. */
export function splitPeerChatMessageParts (message, usernames) {
  const text = typeof message === 'string' ? message : ''
  if (!text) return [{ text, mention: false, link: null }]

  const parts = []
  let cursor = 0

  for (const match of text.matchAll(MESSAGE_LINK)) {
    const start = match.index
    let value = match[0]
    const trimmed = value.replace(TRAILING_PUNCTUATION, '')
    if (trimmed) value = trimmed

    if (start > cursor) {
      parts.push(...splitPeerChatMentions(text.slice(cursor, start), usernames)
        .map((part) => ({ ...part, link: null })))
    }

    parts.push({
      text: value,
      mention: false,
      link: value.includes('://') || value.startsWith('magnet:') ? value : `mailto:${value}`
    })
    cursor = start + value.length
  }

  if (cursor < text.length) {
    parts.push(...splitPeerChatMentions(text.slice(cursor), usernames)
      .map((part) => ({ ...part, link: null })))
  }

  return parts.length > 0 ? parts : [{ text, mention: false, link: null }]
}

// Known names only, the longest first, and a device's label is part of the
// name: "@ada@mobile" is the phone. The rules are shared with the backend and
// with desktop, in backend/peerchat/mentions.mjs.
export function splitPeerChatMentions (message, usernames) {
  const text = typeof message === 'string' ? message : ''
  const mentions = findMentions(text, usernames)
  if (mentions.length === 0) return [{ text, mention: false }]

  const parts = []
  let cursor = 0
  for (const { start, end } of mentions) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), mention: false })
    parts.push({ text: text.slice(start, end), mention: true })
    cursor = end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), mention: false })
  return parts
}

/**
 * The names a mention in a room is read against: this person, the member
 * list, and everyone who wrote there, as the @ suggestions offer. The member
 * list holds at most 100 people, so in a big room like P2P Republic someone
 * past them was plain text here while the desktop, which keeps every member,
 * made them a link.
 */
export function peerChatMentionNames (ownName, members = [], messages = []) {
  const names = [ownName || '']
  for (const member of members || []) names.push(member?.username || '')
  for (const message of messages || []) {
    if (!message?.self && message?.senderName) names.push(message.senderName)
  }
  return names
}

/**
 * The newest message from whoever a mention names, so a tap opens their
 * profile as a tap on their name does, when they are not in the member list.
 */
export function messageFromMentioned (messages, mention) {
  const name = String(mention || '').replace(/^@/, '').toLowerCase()
  if (!name) return null
  const written = (messages || []).filter((message) => !message?.self && message?.senderName).reverse()
  return written.find((message) => message.senderName.toLowerCase() === name) ||
    written.find((message) => personName(message.senderName).toLowerCase() === personName(name)) ||
    null
}

export function normalizePeerChatMentionSpacing (message, usernames) {
  return splitPeerChatMentions(message, usernames)
    .map((part, index, parts) => {
      if (!part.mention || index === parts.length - 1) return part.text
      const next = parts[index + 1].text
      return /^ [^ ]/.test(next) ? `${part.text} ` : part.text
    })
    .join('')
}
