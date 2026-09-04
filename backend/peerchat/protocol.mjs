import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from 'node:crypto'
import b4a from 'b4a'

export const PEERCHAT_PROTOCOL = 'peersky-chat/1'
export const MAX_PEERCHAT_MESSAGE_BYTES = 64 * 1024
export const MAX_PEERCHAT_FRAME_BYTES = 256 * 1024
export const MAX_PEERCHAT_PROFILE_NAME_LENGTH = 50
export const MAX_PEERCHAT_ROOM_NAME_LENGTH = 80
export const MAX_PEERCHAT_REPLY_ID_LENGTH = 64
export const MAX_PEERCHAT_REPLY_SENDER_LENGTH = 200
export const MAX_PEERCHAT_REPLY_TEXT_LENGTH = 200
export const MAX_PEERCHAT_REACTION_EMOJI_LENGTH = 10
export const MAX_PEERCHAT_FILE_NAME_LENGTH = 200
export const MAX_PEERCHAT_BIO_LENGTH = 300
export const MAX_PEERCHAT_LINK_LENGTH = 512
export const MAX_PEERCHAT_AVATAR_LENGTH = 256 * 1024

const ROOM_KEY_PATTERN = /^[a-f0-9]{64}$/i
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const TOPIC_CONTEXT = 'peersky-chat:topic:'
const MESSAGE_KEY_CONTEXT = 'peersky-chat:key:'
const LEGACY_MESSAGE_KEY_CONTEXT = 'peersky-chat:'

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
  const name = stripMetadataControls(value)
    .trim()
    .replace(/\s+/g, ' ')
  return Array.from(name).slice(0, MAX_PEERCHAT_ROOM_NAME_LENGTH).join('') || fallback
}

export function normalizePeerChatBio (value) {
  if (typeof value !== 'string') return ''
  return Array.from(stripMetadataControls(value).trim())
    .slice(0, MAX_PEERCHAT_BIO_LENGTH)
    .join('')
}

export function normalizePeerChatLink (value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  const candidate = Array.from(stripMetadataControls(value).trim())
    .slice(0, MAX_PEERCHAT_LINK_LENGTH)
    .join('')
  try {
    const url = new URL(candidate)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}

export function normalizePeerChatAvatar (value) {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || value.length > MAX_PEERCHAT_AVATAR_LENGTH) return null
  return /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(value)
    ? value
    : null
}

export function normalizePeerChatMessage (value) {
  if (typeof value !== 'string') return ''
  const message = value.trim()
  return getPeerChatMessageByteLength(message) <= MAX_PEERCHAT_MESSAGE_BYTES ? message : ''
}

export function normalizePeerChatReply (value) {
  if (!value || typeof value !== 'object') return null

  const id = normalizeReplyField(value.id, MAX_PEERCHAT_REPLY_ID_LENGTH)
  const sender = normalizeReplyField(value.sender, MAX_PEERCHAT_REPLY_SENDER_LENGTH)
  const sn = normalizeReplyField(value.sn, MAX_PEERCHAT_PROFILE_NAME_LENGTH)
  const text = normalizeReplyField(value.text, MAX_PEERCHAT_REPLY_TEXT_LENGTH)
  if (!id || !sender || !text) return null

  return { id, sender, sn: sn || sender, text }
}

export function normalizePeerChatReaction (value) {
  if (!value || typeof value !== 'object') return null

  const id = normalizeReplyField(value.id, MAX_PEERCHAT_REPLY_ID_LENGTH)
  const msgId = normalizeReplyField(value.msgId, MAX_PEERCHAT_REPLY_ID_LENGTH)
  const sender = normalizeReplyField(value.sender, MAX_PEERCHAT_REPLY_SENDER_LENGTH)
  const sn = normalizeReplyField(value.sn, MAX_PEERCHAT_PROFILE_NAME_LENGTH)
  const emoji = normalizeReplyField(value.emoji, MAX_PEERCHAT_REACTION_EMOJI_LENGTH)
  if (!id || !msgId || !sender || typeof value.emoji !== 'string') return null

  return {
    type: 'reaction',
    id,
    msgId,
    emoji,
    sender,
    sn: sn || sender,
    ts: normalizePeerChatTimestamp(value.ts)
  }
}

export function normalizePeerChatAttachment ({ message, fileName, fileSize } = {}) {
  if (!isHyperUrl(message) || typeof fileName !== 'string') return null

  const name = Array.from(stripMetadataControls(fileName).trim())
    .slice(0, MAX_PEERCHAT_FILE_NAME_LENGTH)
    .join('')
  if (!name) return null

  const size = Number.isSafeInteger(fileSize) && fileSize >= 0 ? fileSize : null
  return {
    fileName: name,
    ...(size !== null && { fileSize: size })
  }
}

export function getPeerChatMessageByteLength (value) {
  return typeof value === 'string' ? b4a.byteLength(value, 'utf8') : 0
}

export function normalizePeerChatTimestamp (value, now = Date.now()) {
  if (!Number.isSafeInteger(value) || value < 0 || value > now + MAX_CLOCK_SKEW_MS) return now
  return value
}

export function createPeerChatRoomKey () {
  return b4a.toString(randomBytes(32), 'hex')
}

export function createPeerChatMessageId () {
  return b4a.toString(randomBytes(16), 'hex')
}

export function derivePeerChatTopic (roomKey) {
  return derivePeerChatKey(roomKey, TOPIC_CONTEXT)
}

export function encryptPeerChatMessage (message, roomKey) {
  const key = derivePeerChatKey(roomKey, MESSAGE_KEY_CONTEXT)
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
    payload.ct.length > MAX_PEERCHAT_MESSAGE_BYTES * 2 ||
    !/^[a-f0-9]*$/i.test(payload.ct) ||
    !/^[a-f0-9]{24}$/i.test(payload.iv) ||
    !/^[a-f0-9]{32}$/i.test(payload.tag)
  ) {
    throw new Error('Invalid encrypted PeerChat payload')
  }

  let plaintext
  try {
    plaintext = decryptPeerChatPayload(
      payload,
      derivePeerChatKey(roomKey, MESSAGE_KEY_CONTEXT)
    )
  } catch (error) {
    try {
      plaintext = decryptPeerChatPayload(
        payload,
        derivePeerChatKey(roomKey, LEGACY_MESSAGE_KEY_CONTEXT)
      )
    } catch {
      throw error
    }
  }

  if (getPeerChatMessageByteLength(plaintext) > MAX_PEERCHAT_MESSAGE_BYTES) {
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

function derivePeerChatKey (roomKey, context) {
  const normalized = normalizePeerChatRoomKey(roomKey)
  if (!normalized) throw new Error('Invalid PeerChat room key')
  return createHash('sha256').update(`${context}${normalized}`).digest()
}

function decryptPeerChatPayload (payload, key) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    b4a.from(payload.iv, 'hex')
  )
  decipher.setAuthTag(b4a.from(payload.tag, 'hex'))
  let plaintext = decipher.update(payload.ct, 'hex', 'utf8')
  plaintext += decipher.final('utf8')
  return plaintext
}

function bytesToHex (bytes) {
  let encoded = ''
  for (const byte of bytes) encoded += byte.toString(16).padStart(2, '0')
  return encoded
}

function stripMetadataControls (value) {
  return Array.from(value).filter((character) => {
    const codePoint = character.codePointAt(0)
    return !(
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    )
  }).join('')
}

function normalizeReplyField (value, maxLength) {
  if (typeof value !== 'string') return ''
  return Array.from(stripMetadataControls(value).trim()).slice(0, maxLength).join('')
}

function isHyperUrl (value) {
  if (typeof value !== 'string' || value.length > MAX_PEERCHAT_MESSAGE_BYTES) return false
  try {
    const url = new URL(value)
    return url.protocol === 'hyper:' &&
      /^[a-z0-9]{52,64}$/i.test(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
  } catch {
    return false
  }
}
