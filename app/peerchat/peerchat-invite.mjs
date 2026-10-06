// PeerChat invite links, in the desktop's format so either side opens them:
//
//   peersky://p2p/peerchat/#room=<64 hex room key>   a room
//   peersky://p2p/peerchat/#dm=<8 hex peer id>       one person
//
// A room key is the room's capability: anyone with the link is in. A peer id
// only says who to ask, and that person still has to accept, so it can be the
// short id the member list already shows. Both ride in the fragment, so the
// browser shell treats them as a launch suffix on the built-in app.
export const PEERCHAT_INVITE_BASE = 'peersky://p2p/peerchat/'

// "Invite friends to PeerChat" in Find: a message to send through any app on
// the phone, for someone who does not have PeerSky yet. Your own link goes
// after it: opened once they have set PeerChat up, it sends you a message
// request, so the two of you find each other without scanning anything.
export const PEERCHAT_APP_INVITE_URL = 'https://peersky.p2plabs.xyz/mobile'

export function buildPeerChatAppInviteMessage (directInviteUrl = '') {
  const message = `I'm inviting you to install PeerChat! Here is the link:\n${PEERCHAT_APP_INVITE_URL}`
  // No name yet means no link of your own yet.
  if (!parsePeerChatDirectInvite(directInviteUrl)) return message
  return `${message}\n\nThen open this link to message me:\n${directInviteUrl}`
}

const ROOM_KEY_RE = /^[a-f0-9]{64}$/i

export function buildPeerChatInviteUrl (roomKey) {
  const key = String(roomKey || '')
  if (!ROOM_KEY_RE.test(key)) return ''
  return `${PEERCHAT_INVITE_BASE}#room=${key.toLowerCase()}`
}

// Accepts a full invite link, a bare fragment, or a plain room key, so the same
// function handles a pasted link and a scanned QR code.
export function parsePeerChatInvite (input) {
  const value = String(input || '').trim()
  if (!value) return ''
  if (ROOM_KEY_RE.test(value)) return value.toLowerCase()

  const tail = value.match(/[#?](.*)$/)?.[1] ?? ''
  if (!tail) return ''

  let key = ''
  try {
    key = new URLSearchParams(tail).get('room') || ''
  } catch {
    return ''
  }

  return ROOM_KEY_RE.test(key) ? key.toLowerCase() : ''
}

const PEER_ID_RE = /^[a-f0-9]{8}$/i

/**
 * A link that asks one person for a direct message.
 *
 * Handing this out is not handing out access: it starts a request, which they
 * can accept, decline or block. That is what makes it safe to put on a screen
 * as a QR code for somebody across the room to scan.
 */
export function buildPeerChatDirectInviteUrl (peerId) {
  const id = String(peerId || '')
  if (!PEER_ID_RE.test(id)) return ''
  return `${PEERCHAT_INVITE_BASE}#dm=${id.toLowerCase()}`
}

/** Accepts the link, a bare fragment, or a plain peer id. */
export function parsePeerChatDirectInvite (input) {
  const value = String(input || '').trim()
  if (!value) return ''
  if (PEER_ID_RE.test(value)) return value.toLowerCase()

  const tail = value.match(/[#?](.*)$/)?.[1] ?? ''
  if (!tail) return ''

  let id = ''
  try {
    id = new URLSearchParams(tail).get('dm') || ''
  } catch {
    return ''
  }

  return PEER_ID_RE.test(id) ? id.toLowerCase() : ''
}
