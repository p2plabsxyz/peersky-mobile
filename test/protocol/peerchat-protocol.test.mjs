import assert from 'node:assert/strict'
import { createDecipheriv, createHash } from 'node:crypto'
import test from 'node:test'

import b4a from 'b4a'

import {
  decryptPeerChatMessage,
  encryptPeerChatMessage,
  getSharedPeerChatRooms,
  normalizePeerChatMessage,
  normalizePeerChatProfileName,
  normalizePeerChatRoomKey,
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
})

test('PeerChat AES-GCM payloads use the desktop room-key derivation', () => {
  const encrypted = encryptPeerChatMessage('hello desktop', ROOM_KEY)
  const derivedKey = createHash('sha256').update(`peersky-chat:${ROOM_KEY}`).digest()
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

test('PeerChat routes connections only through locally joined room topics', () => {
  const otherRoom = 'cd'.repeat(32)
  const discoveryKeys = new Map([
    [ROOM_KEY, ROOM_KEY]
  ])

  assert.equal(peerChatTopicHex(b4a.from(ROOM_KEY, 'hex')), ROOM_KEY)
  assert.deepEqual(
    getSharedPeerChatRooms([
      b4a.from(ROOM_KEY, 'hex'),
      b4a.from(otherRoom, 'hex'),
      b4a.from(ROOM_KEY, 'hex')
    ], discoveryKeys),
    [ROOM_KEY]
  )
})
