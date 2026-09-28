// Invite links for PeerChat, matching the desktop format so a link shared from
// either side opens on the other.
//
//   peersky://p2p/peerchat/#room=<64 hex room key>   a room
//   peersky://p2p/peerchat/#dm=<8 hex peer id>       one person
//
// A room key is the capability for that room, so anyone holding the link is in.
// A peer id is not a capability: it only says who to ask, and the person on the
// other end still has to accept the request. That is why one is 64 characters
// of secret and the other is the same short id the member list already shows.
//
// The key rides in the fragment rather than the path, so the browser shell
// treats it as a launch suffix on the built-in app instead of a new route.
export const PEERCHAT_INVITE_BASE = 'peersky://p2p/peerchat/'

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
