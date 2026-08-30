import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from 'node:crypto'
import b4a from 'b4a'

export const PEERCHAT_PROTOCOL = 'peersky-chat/1'
export const MAX_PEERCHAT_MESSAGE_LENGTH = 64 * 1024
export const MAX_PEERCHAT_PROFILE_NAME_LENGTH = 50
export const MAX_PEERCHAT_ROOM_NAME_LENGTH = 80

const ROOM_KEY_PATTERN = /^[a-f0-9]{64}$/i
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/

export function normalizePeerChatRoomKey (value) {
  const roomKey = typeof value === 'string' ? value.trim() : ''
  return ROOM_KEY_PATTERN.test(roomKey) ? roomKey.toLowerCase() : ''
}

export function normalizePeerChatProfileName (value) {
  if (typeof value !== 'string') return ''

  const name = value.trim().replace(/\s+/g, ' ')
  if (
    !name ||
    name.length > MAX_PEERCHAT_PROFILE_NAME_LENGTH ||
    !PROFILE_NAME_PATTERN.test(name)
  ) {
    return ''
  }

  return name
}

export function normalizePeerChatRoomName (value, fallback = 'New Room') {
  if (typeof value !== 'string') return fallback
  const name = value.trim().replace(/\s+/g, ' ').slice(0, MAX_PEERCHAT_ROOM_NAME_LENGTH)
  return name || fallback
}

export function normalizePeerChatMessage (value) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, MAX_PEERCHAT_MESSAGE_LENGTH)
}

export function createPeerChatRoomKey () {
  return b4a.toString(randomBytes(32), 'hex')
}

export function createPeerChatMessageId () {
  return b4a.toString(randomBytes(16), 'hex')
}

export function encryptPeerChatMessage (message, roomKey) {
  const key = deriveRoomEncryptionKey(roomKey)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  let ciphertext = cipher.update(message, 'utf8', 'hex')
  ciphertext += cipher.final('hex')

  return {
    ct: ciphertext,
    iv: b4a.toString(iv, 'hex'),
    tag: b4a.toString(cipher.getAuthTag(), 'hex')
  }
}

export function decryptPeerChatMessage (payload, roomKey) {
  if (
    typeof payload?.ct !== 'string' ||
    typeof payload?.iv !== 'string' ||
    typeof payload?.tag !== 'string' ||
    payload.ct.length > MAX_PEERCHAT_MESSAGE_LENGTH * 2 + 64 ||
    !/^[a-f0-9]*$/i.test(payload.ct) ||
    !/^[a-f0-9]{24}$/i.test(payload.iv) ||
    !/^[a-f0-9]{32}$/i.test(payload.tag)
  ) {
    throw new Error('Invalid encrypted PeerChat payload')
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveRoomEncryptionKey(roomKey),
    b4a.from(payload.iv, 'hex')
  )
  decipher.setAuthTag(b4a.from(payload.tag, 'hex'))
  let plaintext = decipher.update(payload.ct, 'hex', 'utf8')
  plaintext += decipher.final('utf8')

  if (plaintext.length > MAX_PEERCHAT_MESSAGE_LENGTH) {
    throw new Error('PeerChat message is too large')
  }

  return plaintext
}

export function peerChatTopicHex (topic) {
  if (typeof topic === 'string') return normalizePeerChatRoomKey(topic)
  if (!topic) return ''

  if (typeof topic.toString === 'function') {
    const encoded = topic.toString('hex')
    const normalized = normalizePeerChatRoomKey(encoded)
    if (normalized) return normalized
  }

  if (ArrayBuffer.isView(topic)) {
    return normalizePeerChatRoomKey(bytesToHex(
      new Uint8Array(topic.buffer, topic.byteOffset, topic.byteLength)
    ))
  }

  if (topic instanceof ArrayBuffer) {
    return normalizePeerChatRoomKey(bytesToHex(new Uint8Array(topic)))
  }

  return ''
}

export function getSharedPeerChatRooms (topics, discoveryKeys) {
  const sharedRooms = []
  const seen = new Set()

  for (const topic of topics || []) {
    const roomKey = normalizePeerChatRoomKey(
      discoveryKeys.get(peerChatTopicHex(topic))
    )
    if (!roomKey || seen.has(roomKey)) continue
    seen.add(roomKey)
    sharedRooms.push(roomKey)
  }

  return sharedRooms
}

function deriveRoomEncryptionKey (roomKey) {
  const normalized = normalizePeerChatRoomKey(roomKey)
  if (!normalized) throw new Error('Invalid PeerChat room key')
  return createHash('sha256').update(`peersky-chat:${normalized}`).digest()
}

function bytesToHex (bytes) {
  let encoded = ''
  for (const byte of bytes) encoded += byte.toString(16).padStart(2, '0')
  return encoded
}
