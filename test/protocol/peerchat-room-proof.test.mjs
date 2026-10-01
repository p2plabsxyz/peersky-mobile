// A room opens on a connection only to a peer that proves it holds the key.
// PeerChat on the desktop makes and checks the same proofs, so both pin the
// same vector.
import assert from 'node:assert/strict'
import test from 'node:test'

import { checkRoomProof, roomProof } from '../../backend/peerchat/room-proof.mjs'

const ROOM = 'aa'.repeat(32)
const OTHER = 'bb'.repeat(32)
const HANDSHAKE = '0e'.repeat(64)
const SENDER = '0d'.repeat(32)

test('room proofs match the vector PeerChat on the desktop pins', () => {
  assert.equal(
    roomProof('0f'.repeat(32), HANDSHAKE, SENDER),
    '08ad4e5c5831d8c8edb20824f5e8b1a06ebef6d751b3a8642c2a766cc2ad22ce'
  )
  // Keys and hashes as bytes give the same proof as hex.
  assert.equal(
    roomProof('0f'.repeat(32), Buffer.from(HANDSHAKE, 'hex'), Buffer.from(SENDER, 'hex')),
    roomProof('0f'.repeat(32), HANDSHAKE, SENDER)
  )
})

test('a room proof is only good for its key, its connection and its sender', () => {
  const proof = roomProof(ROOM, HANDSHAKE, SENDER)
  assert.equal(checkRoomProof(ROOM, HANDSHAKE, SENDER, proof), true)
  assert.equal(checkRoomProof(OTHER, HANDSHAKE, SENDER, proof), false)
  assert.equal(checkRoomProof(ROOM, '0c'.repeat(64), SENDER, proof), false)
  assert.equal(checkRoomProof(ROOM, HANDSHAKE, '0b'.repeat(32), proof), false)
  assert.equal(checkRoomProof(ROOM, HANDSHAKE, SENDER, ''), false)
  assert.equal(checkRoomProof(ROOM, HANDSHAKE, SENDER, proof.toUpperCase()), false)
  assert.equal(roomProof(ROOM, '', SENDER), '')
  assert.equal(roomProof(ROOM, undefined, SENDER), '')
  assert.equal(roomProof('not a key', HANDSHAKE, SENDER), '')
})
