export const PEERCHAT_INTRO_MAX_BYTES = 1024

export const PEERCHAT_INTRO_POINTS = [
  'Messages go straight from your phone to theirs. No server in the middle, no account to create, nobody else holding your chats.',
  'You both need to be online at the same time. Nothing is stored for you while you are away, so messages only arrive when both phones are connected.',
  'Keep PeerSky running in the background so friends can reach you.',
  'Works with no internet at all. Any local network will do, even a phone hotspot. When the internet is cut off, or never reached you in the first place, PeerChat keeps working.'
]

export function parsePeerChatIntroState (serialized) {
  if (typeof serialized !== 'string' || serialized.length > PEERCHAT_INTRO_MAX_BYTES) return false

  try {
    const stored = JSON.parse(serialized)
    return stored?.version === 1 && stored?.completed === true
  } catch {
    return false
  }
}

export function serializePeerChatIntroState () {
  return JSON.stringify({ version: 1, completed: true })
}
