const VALID_USERNAME = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/

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
