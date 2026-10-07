const VALID_USERNAME = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/

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

export function splitPeerChatMentions (message, usernames) {
  const text = typeof message === 'string' ? message : ''
  const names = [...new Set((Array.isArray(usernames) ? usernames : [])
    .filter((name) => typeof name === 'string' && VALID_USERNAME.test(name)))]
    .sort((left, right) => right.length - left.length)
  if (!text || names.length === 0) return [{ text, mention: false }]

  const lowerText = text.toLocaleLowerCase()
  const parts = []
  let cursor = 0
  for (let index = text.indexOf('@'); index !== -1; index = text.indexOf('@', cursor)) {
    if (index > 0 && /[A-Za-z0-9_]/.test(text[index - 1])) {
      cursor = index + 1
      continue
    }
    const name = names.find((candidate) => (
      lowerText.startsWith(`@${candidate.toLocaleLowerCase()}`, index)
    ))
    if (!name) {
      cursor = index + 1
      continue
    }
    if (index > (parts.at(-1)?.end || 0)) {
      const start = parts.at(-1)?.end || 0
      parts.push({ text: text.slice(start, index), mention: false, end: index })
    }
    const end = index + name.length + 1
    parts.push({ text: text.slice(index, end), mention: true, end })
    cursor = end
  }

  const consumed = parts.at(-1)?.end || 0
  if (consumed < text.length) parts.push({ text: text.slice(consumed), mention: false, end: text.length })
  return parts.map(({ text, mention }) => ({ text, mention }))
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
