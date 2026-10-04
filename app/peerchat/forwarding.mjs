// What a message forwards as: its words, the same as on the desktop. A file
// or picture is sealed with the key of the room it was sent to, so it would
// not open anywhere else, and a notice from the app is nobody's to pass on.
export function forwardableText (message) {
  if (!message || message.system || message.fileName || message.fileEnc) return null
  return typeof message.message === 'string' && message.message.trim() ? message.message : null
}

// The picked messages as they will arrive: in the order they were sent, words
// only. One that is gone, or cannot be forwarded, is left out.
export function forwardTexts (messages, pickedIds) {
  return (messages || [])
    .filter((message) => message && pickedIds.has(message.id))
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    .map(forwardableText)
    .filter(Boolean)
}
