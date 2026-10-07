// A peer proves it holds a room's key without sending it. The room's topic is
// public (DHT nodes see it), so it opens nothing. For each room it is in, a
// peer sends an HMAC keyed with the room key over the connection's handshake
// hash and its own network key. Only a key holder can make one, it is good on
// this connection alone, and it cannot be bounced back because the other
// side's names the other key. Must match lib/room-proof.js in desktop PeerChat
// byte for byte.
import { createHash, createHmac } from 'node:crypto'
import b4a from 'b4a'

const ROOM_KEY_PATTERN = /^[0-9a-f]{64}$/
const KEY_PATTERN = /^[0-9a-f]{64}$/
const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/
const PROOF_KEY_CONTEXT = 'peersky-chat:proof:'
const PROOF_LABEL = 'peersky-chat/2 room'

function hex (value) {
  if (typeof value === 'string') return value.toLowerCase()
  if (ArrayBuffer.isView(value)) return b4a.toString(value, 'hex')
  return ''
}

export function roomProof (roomKey, handshakeHash, senderKey) {
  const room = typeof roomKey === 'string' ? roomKey.toLowerCase() : ''
  const handshake = hex(handshakeHash)
  const sender = hex(senderKey)
  if (!ROOM_KEY_PATTERN.test(room) || !HEX_PATTERN.test(handshake) || !KEY_PATTERN.test(sender)) return ''
  const key = createHash('sha256').update(PROOF_KEY_CONTEXT + room).digest()
  return createHmac('sha256', key).update(`${PROOF_LABEL}\n${handshake}\n${sender}`).digest('hex')
}

export function checkRoomProof (roomKey, handshakeHash, senderKey, proof) {
  if (typeof proof !== 'string' || !KEY_PATTERN.test(proof)) return false
  const expected = roomProof(roomKey, handshakeHash, senderKey)
  if (!expected) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ proof.charCodeAt(i)
  return diff === 0
}
