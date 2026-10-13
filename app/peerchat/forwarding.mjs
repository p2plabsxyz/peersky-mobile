// What a message forwards as: its words, or its file. A file or picture is
// opened here and sealed again for the chat it goes to, as one picked on this
// phone would be, the same as on the desktop. A notice from the app is not
// anyone's message to pass on.
export function forwardableText (message) {
  if (!message || message.system || message.fileName || message.fileEnc) return null
  return typeof message.message === 'string' && message.message.trim() ? message.message : null
}

// A file or picture to forward: where it is and the key it was sealed with,
// its own in a room whose keys rotate, or else its room's. roomKey is set on a
// message from a room this one moved from, whose key opens its files.
export function forwardableFile (message) {
  if (!message || message.system || !message.fileName || message.fileEnc !== true) return null
  if (typeof message.message !== 'string' || !/^hyper:\/\//i.test(message.message)) return null
  return {
    url: message.message,
    fileName: message.fileName,
    fileSize: Number.isSafeInteger(message.fileSize) ? message.fileSize : 0,
    fileKey: message.fileKey || '',
    roomKey: message.roomKey || ''
  }
}

export function isForwardable (message) {
  return Boolean(forwardableText(message) || forwardableFile(message))
}

// The picked messages as they will arrive: in the order they were sent, each
// as its words or its file. One that is gone, or cannot be forwarded, is left
// out.
export function forwardItems (messages, pickedIds) {
  return (messages || [])
    .filter((message) => message && pickedIds.has(message.id))
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    .map((message) => {
      const file = forwardableFile(message)
      if (file) return { file }
      const text = forwardableText(message)
      return text ? { text } : null
    })
    .filter(Boolean)
}

// How long to wait between forwarded messages so the chat's spam limit,
// counted over ten seconds, is never reached: two short of it, which leaves
// room to type. Thirty forwarded at once got the sender kicked. The same rule
// as the desktop's lib/forwarding.js.
export function forwardGapMs (spamRateLimit) {
  const limit = Number.isSafeInteger(spamRateLimit) && spamRateLimit > 0 ? spamRateLimit : 10
  return Math.ceil(10_000 / Math.max(1, limit - 2))
}

// Said in the chat while more than two go out, as the desktop says it.
export function describeForwarding (count) {
  return count > 2
    ? `Forwarding ${count} messages, a moment apart so the chat's spam limit is not reached.`
    : ''
}
