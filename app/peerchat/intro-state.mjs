export const PEERCHAT_INTRO_MAX_BYTES = 1024

export const PEERCHAT_INTRO_POINTS = [
  'Messages go straight from your phone to theirs, end to end encrypted. No server in the middle, no account to create, nobody else holding your chats.',
  'You both need to be online at the same time. Nothing is stored for you while you are away, so messages only arrive when both phones are connected.',
  'Keep PeerSky running in the background so friends can reach you.',
  'Works with no internet at all. Any local network will do, even a phone hotspot. When the internet is cut off, or never reached you in the first place, PeerChat keeps working.'
]

// Agreed to before anything else, so everyone has seen them. The full text is
// TERMS.md, and App Review asks that people agree to it in the app.
export const PEERCHAT_RULES = [
  'No sexual content involving anyone under 18, ever. We report it to the authorities.',
  'No threats, harassment, bullying or hate.',
  'No nudity, spam, scams, or other people’s private details.',
  'Block anyone who bothers you and report them. We read every report within 24 hours.',
  'You start in P2P Republic, a public room anyone can join. You can leave it from the chat list.'
]

export const PEERCHAT_TERMS_URL = 'https://github.com/p2plabsxyz/peersky-mobile/blob/main/TERMS.md'

// Version 2 added the rules, so everyone who agreed before sees them once.
const PEERCHAT_INTRO_VERSION = 2

export function parsePeerChatIntroState (serialized) {
  if (typeof serialized !== 'string' || serialized.length > PEERCHAT_INTRO_MAX_BYTES) return false

  try {
    const stored = JSON.parse(serialized)
    return stored?.version === PEERCHAT_INTRO_VERSION && stored?.completed === true
  } catch {
    return false
  }
}

export function serializePeerChatIntroState () {
  return JSON.stringify({ version: PEERCHAT_INTRO_VERSION, completed: true })
}
