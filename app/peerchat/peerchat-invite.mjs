import { t } from '../i18n/i18n.mjs'

// PeerChat invite links, in the desktop's format so either side opens them:
//
//   peersky://p2p/peerchat/#room=<64 hex room key>   a room
//   peersky://p2p/peerchat/#room=<room key>&creator=<creator key>&proof=<secret>
//                                                    a room, and who made it
//   peersky://p2p/peerchat/#dm=<64 hex public key>   one person
//
// A room key is the room's capability: anyone with the link is in. A person's
// key only says who to ask, and that person still has to accept. Links made
// before carried the 8 hex short id the member list shows, and still open.
// Both ride in the fragment, so the browser shell treats them as a launch
// suffix on the built-in app.
//
// A room invite also says who made the room, when the device making it knows:
// the creator's key, and with it the secret that made the room's key out of
// the creator's, when that device holds one that checks out. Whoever joins
// from the link knows the creator from the start, rather than taking the
// first member who claims to have made it. All lowercase hex, 64 characters
// each, in that order. The secret is as private as the room key. A direct
// message and P2P Republic, whose creator key ships with the app, carry room
// alone, and an older build reads room alone and ignores the rest.
export const PEERCHAT_INVITE_BASE = 'peersky://p2p/peerchat/'

// "Invite friends to PeerChat" in Find: a message to send through any app on
// the phone, for someone who does not have PeerSky yet. Your own link goes
// after it: opened once they have set PeerChat up, it sends you a message
// request, so the two of you find each other without scanning anything.
export const PEERCHAT_APP_INVITE_URL = 'https://peersky.p2plabs.xyz/mobile'

export function buildPeerChatAppInviteMessage (directInviteUrl = '') {
  const message = `${t("I'm inviting you to install PeerSky! Here is the link:")}\n${PEERCHAT_APP_INVITE_URL}`
  // No name yet means no link of your own yet.
  if (!parsePeerChatDirectInvite(directInviteUrl)) return message
  return `${message}\n\n${t('Then open this PeerChat link to message me:')}\n${directInviteUrl}`
}

const ROOM_KEY_RE = /^[a-f0-9]{64}$/i

// creatorKey and creatorProof are what the room says about who made it, as
// PeerChat hands them to the screen: none for a direct message or P2P
// Republic, and the secret only with the key.
export function buildPeerChatInviteUrl (roomKey, creatorKey = '', creatorProof = '') {
  const key = String(roomKey || '')
  if (!ROOM_KEY_RE.test(key)) return ''
  const link = `${PEERCHAT_INVITE_BASE}#room=${key.toLowerCase()}`
  const creator = String(creatorKey || '')
  if (!ROOM_KEY_RE.test(creator)) return link
  const proof = String(creatorProof || '')
  const withCreator = `${link}&creator=${creator.toLowerCase()}`
  return ROOM_KEY_RE.test(proof) ? `${withCreator}&proof=${proof.toLowerCase()}` : withCreator
}

/**
 * A room invite: the room key, and who made the room when the link says so.
 * Accepts a full invite link, a bare fragment, or a plain room key, so the
 * same function handles a pasted link and a scanned QR code. Null when it
 * names no room.
 *
 * The creator key is taken only whole, and the secret only with it. Whether
 * the two make the room's key is checked where the room is joined
 * (PeerChatService.joinRoom), where PeerChat's hashing lives and which every
 * way in goes through: a secret that does not check out drops the creator key
 * too, as if the link had neither.
 */
export function parsePeerChatRoomInvite (input) {
  const value = String(input || '').trim()
  if (!value) return null
  if (ROOM_KEY_RE.test(value)) return { roomKey: value.toLowerCase(), creatorKey: '', creatorProof: '' }

  const tail = value.match(/[#?](.*)$/)?.[1] ?? ''
  if (!tail) return null

  let params
  try {
    params = new URLSearchParams(tail)
  } catch {
    return null
  }

  const roomKey = params.get('room') || ''
  if (!ROOM_KEY_RE.test(roomKey)) return null
  const creator = params.get('creator') || ''
  const proof = params.get('proof') || ''
  // A secret that is there but cannot be one says the same as one that does
  // not check out.
  const proofFits = ROOM_KEY_RE.test(proof)
  const creatorKey = ROOM_KEY_RE.test(creator) && (proofFits || !params.has('proof')) ? creator.toLowerCase() : ''
  const creatorProof = creatorKey && proofFits ? proof.toLowerCase() : ''
  return { roomKey: roomKey.toLowerCase(), creatorKey, creatorProof }
}

// The room key alone, for everything that only needs to know which room.
export function parsePeerChatInvite (input) {
  return parsePeerChatRoomInvite(input)?.roomKey || ''
}

/**
 * What joining from a room key or an invite asks PeerChat for: the room, and
 * who made it when the invite says. Anything else goes as it was typed, for
 * PeerChat to refuse in its own words.
 */
export function peerChatJoinRequest (input) {
  const invite = parsePeerChatRoomInvite(input)
  if (!invite) return { roomKey: String(input || '').trim() }
  return {
    roomKey: invite.roomKey,
    ...(invite.creatorKey && { creatorKey: invite.creatorKey }),
    ...(invite.creatorProof && { creatorProof: invite.creatorProof })
  }
}

const PEER_ID_RE = /^[a-f0-9]{8}$/i
const PEER_KEY_RE = /^[a-f0-9]{64}$/i

/**
 * A link that asks one person for a direct message.
 *
 * It carries their whole public key. The 8 character id everything shows is
 * only the start of it: among millions of people some keys start the same
 * way, and one can be made to on purpose. The whole key names one person.
 *
 * Handing this out is not handing out access: it starts a request, which they
 * can accept, decline or block. That is what makes it safe to put on a screen
 * as a QR code for somebody across the room to scan.
 */
export function buildPeerChatDirectInviteUrl (peerKey) {
  const key = String(peerKey || '')
  if (!PEER_KEY_RE.test(key)) return ''
  return `${PEERCHAT_INVITE_BASE}#dm=${key.toLowerCase()}`
}

/**
 * Accepts the link, a bare fragment, or a plain short id, and gives the whole
 * key, or the short id an older link carries. A plain 64 hex value is a room
 * key, so a person's key has to come as dm=.
 */
export function parsePeerChatDirectInvite (input) {
  const value = String(input || '').trim()
  if (!value) return ''
  if (PEER_ID_RE.test(value)) return value.toLowerCase()

  const tail = value.match(/[#?](.*)$/)?.[1] ?? ''
  if (!tail) return ''

  let peer = ''
  try {
    peer = new URLSearchParams(tail).get('dm') || ''
  } catch {
    return ''
  }

  return PEER_KEY_RE.test(peer) || PEER_ID_RE.test(peer) ? peer.toLowerCase() : ''
}

/**
 * Who a direct link names: the short id everything shows them by, and their
 * whole key when the link has it. An older link gives only the short id.
 */
export function splitPeerChatDirectPeer (peer) {
  const value = String(peer || '').toLowerCase()
  if (PEER_KEY_RE.test(value)) return { id: value.slice(0, 8), key: value }
  if (PEER_ID_RE.test(value)) return { id: value, key: '' }
  return { id: '', key: '' }
}

/**
 * Whether a direct room is the conversation with the person a link names.
 *
 * A room bound to another key is with someone else whose key starts the same
 * way. A request not yet bound to any key is not either: asking again sends it
 * to the key in the link. Nothing can be written in a request until it is
 * accepted, so nothing meant for one person goes to another.
 */
export function isPeerChatDirectRoomFor (room, peer) {
  const { id, key } = splitPeerChatDirectPeer(peer)
  if (!id || !room?.isDM || room.dmWith !== id) return false
  if (!key) return true
  return room.dmWithKey ? room.dmWithKey === key : !room.pendingAcceptance
}
