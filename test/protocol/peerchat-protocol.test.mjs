import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto'
import test from 'node:test'

import b4a from 'b4a'

import {
  decryptPeerChatMessage,
  derivePeerChatDirectRoomKey,
  derivePeerChatTopic,
  encryptPeerChatMessage,
  getSharedPeerChatRooms,
  MAX_PEERCHAT_MESSAGE_BYTES,
  normalizePeerChatAvatar,
  normalizePeerChatAttachment,
  normalizePeerChatBio,
  normalizePeerChatLink,
  normalizePeerChatMessage,
  normalizePeerChatProfileName,
  normalizePeerChatReaction,
  normalizePeerChatReply,
  normalizePeerChatRoomKey,
  normalizePeerChatRoomName,
  normalizePeerChatTimestamp,
  peerChatTopicHex,
  PEERCHAT_PROTOCOL
} from '../../backend/peerchat/protocol.mjs'

const ROOM_KEY = 'ab'.repeat(32)

test('PeerChat uses the desktop transport protocol and validates public inputs', () => {
  assert.equal(PEERCHAT_PROTOCOL, 'peersky-chat/1')
  assert.equal(normalizePeerChatRoomKey(ROOM_KEY.toUpperCase()), ROOM_KEY)
  assert.equal(normalizePeerChatRoomKey('not-a-room'), '')
  assert.equal(normalizePeerChatProfileName('  Alice   Mobile  '), 'Alice Mobile')
  assert.equal(normalizePeerChatProfileName('Alice_'), '')
  assert.equal(normalizePeerChatMessage('  hello  '), 'hello')
  assert.equal(normalizePeerChatMessage('a'.repeat(MAX_PEERCHAT_MESSAGE_BYTES)).length, MAX_PEERCHAT_MESSAGE_BYTES)
  assert.equal(normalizePeerChatMessage('😀'.repeat(MAX_PEERCHAT_MESSAGE_BYTES / 2)), '')
  assert.equal(normalizePeerChatRoomName('Safe\u0000\u202E Room'), 'Safe Room')
  assert.equal(normalizePeerChatTimestamp(Number.MAX_VALUE, 1000), 1000)
})

test('PeerChat bounds and sanitizes desktop-compatible reply metadata', () => {
  assert.deepEqual(normalizePeerChatReply({
    id: ` ${'a'.repeat(70)} `,
    sender: 'desktop\u202E-peer',
    sn: 'Alice Desktop',
    text: ` ${'😀'.repeat(205)} `
  }), {
    id: 'a'.repeat(64),
    sender: 'desktop-peer',
    sn: 'Alice Desktop',
    text: '😀'.repeat(200)
  })
  assert.equal(normalizePeerChatReply({ id: '', sender: 'desktop', text: 'hello' }), null)
  assert.equal(normalizePeerChatReply('not-an-object'), null)
})

test('PeerChat bounds desktop-compatible reaction events and preserves removals', () => {
  assert.deepEqual(normalizePeerChatReaction({
    id: 'reaction-id',
    msgId: ` ${'m'.repeat(70)} `,
    emoji: '🔥'.repeat(12),
    sender: 'desktop\u202E-peer',
    sn: 'Desktop',
    ts: 1000
  }), {
    type: 'reaction',
    id: 'reaction-id',
    msgId: 'm'.repeat(64),
    emoji: '🔥'.repeat(10),
    sender: 'desktop-peer',
    sn: 'Desktop',
    ts: 1000
  })
  assert.equal(normalizePeerChatReaction({
    id: 'remove-id',
    msgId: 'message-id',
    emoji: '',
    sender: 'desktop',
    ts: 1000
  })?.emoji, '')
  assert.equal(normalizePeerChatReaction({
    id: 'bad-id',
    msgId: '',
    emoji: '👍',
    sender: 'desktop'
  }), null)
})

test('PeerChat accepts only bounded Hyperdrive attachment metadata', () => {
  const url = `hyper://${'a'.repeat(52)}/shared/report.pdf`
  assert.deepEqual(normalizePeerChatAttachment({
    message: url,
    fileName: 'report.pdf',
    fileSize: 1024
  }), {
    fileName: 'report.pdf',
    fileSize: 1024
  })
  assert.equal(normalizePeerChatAttachment({
    message: 'https://example.com/report.pdf',
    fileName: 'report.pdf',
    fileSize: 1024
  }), null)
  assert.equal(normalizePeerChatAttachment({
    message: url,
    fileName: '',
    fileSize: 1024
  }), null)
  assert.deepEqual(normalizePeerChatAttachment({
    message: url,
    fileName: `safe\u202E${'x'.repeat(220)}`,
    fileSize: -1
  }), {
    fileName: `safe${'x'.repeat(196)}`
  })
})

test('PeerChat sanitizes bounded profile and room metadata', () => {
  assert.equal(normalizePeerChatBio(` About\u202E me ${'x'.repeat(400)}`).length, 300)
  assert.equal(normalizePeerChatLink(' https://example.com/about '), 'https://example.com/about')
  assert.equal(normalizePeerChatLink('javascript:alert(1)'), '')
  assert.equal(normalizePeerChatLink('https://user:secret@example.com/'), '')
  assert.equal(normalizePeerChatAvatar('data:image/png;base64,YQ=='), 'data:image/png;base64,YQ==')
  assert.equal(normalizePeerChatAvatar('data:text/html;base64,YQ=='), null)
})

test('PeerChat derives desktop-compatible direct-message room keys', () => {
  const first = '1234abcd'
  const second = '9876fedc'
  const expected = createHash('sha256').update(`${first}:dm:${second}`).digest('hex')
  assert.equal(derivePeerChatDirectRoomKey(second, first), expected)
  assert.throws(() => derivePeerChatDirectRoomKey(first, first), /Invalid PeerChat direct-message peers/)
})

test('PeerChat AES-GCM payloads use the separated desktop message-key derivation', () => {
  const encrypted = encryptPeerChatMessage('hello desktop', ROOM_KEY)
  const derivedKey = createHash('sha256').update(`peersky-chat:key:${ROOM_KEY}`).digest()
  const decipher = createDecipheriv(
    'aes-256-gcm',
    derivedKey,
    b4a.from(encrypted.iv, 'hex')
  )
  decipher.setAuthTag(b4a.from(encrypted.tag, 'hex'))
  const independentlyDecrypted = decipher.update(encrypted.ct, 'hex', 'utf8') + decipher.final('utf8')

  assert.equal(independentlyDecrypted, 'hello desktop')
  assert.equal(decryptPeerChatMessage(encrypted, ROOM_KEY), 'hello desktop')
  assert.throws(
    () => decryptPeerChatMessage(encrypted, 'cd'.repeat(32)),
    /authenticate data/
  )
})

test('PeerChat decrypts history written with the legacy message key', () => {
  const legacyKey = createHash('sha256').update(`peersky-chat:${ROOM_KEY}`).digest()
  const iv = Buffer.alloc(12, 7)
  const cipher = createCipheriv('aes-256-gcm', legacyKey, iv)
  const ct = cipher.update('legacy history', 'utf8', 'hex') + cipher.final('hex')

  assert.equal(decryptPeerChatMessage({
    ct,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex')
  }, ROOM_KEY), 'legacy history')
})

test('PeerChat routes connections only through locally joined room topics', () => {
  const otherRoom = 'cd'.repeat(32)
  const roomTopic = derivePeerChatTopic(ROOM_KEY)
  const otherTopic = derivePeerChatTopic(otherRoom)
  const roomTopicHex = peerChatTopicHex(roomTopic)
  const discoveryKeys = new Map([
    [roomTopicHex, ROOM_KEY]
  ])

  assert.equal(
    roomTopicHex,
    createHash('sha256').update(`peersky-chat:topic:${ROOM_KEY}`).digest('hex')
  )
  assert.notEqual(roomTopicHex, ROOM_KEY)
  assert.deepEqual(
    getSharedPeerChatRooms([
      roomTopic,
      otherTopic,
      roomTopic
    ], discoveryKeys),
    [ROOM_KEY]
  )
})
