import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MAX_PEERCHAT_ROOM_BANS,
  acceptsPeerChatCreatorKey,
  addPeerChatRoomBan,
  isPeerChatPeerBanned,
  isPeerChatRoomCreator,
  normalizePeerChatCreatorKey,
  normalizePeerChatRoomBans,
  peerIdForCreatorKey,
  removePeerChatRoomBan,
  resolvePeerChatCreatorKey
} from '../../backend/peerchat/room-moderation.mjs'

const ROOM = 'ab'.repeat(32)
const CREATOR = 'c0ffee11' + 'a'.repeat(56)
const IMPOSTOR = 'c0ffee11' + 'b'.repeat(56)
const SOMEONE = 'd00dfeed' + 'c'.repeat(56)

test('a creator key is 64 hex characters or it is nothing', () => {
  assert.equal(normalizePeerChatCreatorKey(CREATOR.toUpperCase()), CREATOR)
  assert.equal(normalizePeerChatCreatorKey('c0ffee11'), '')
  assert.equal(normalizePeerChatCreatorKey('z'.repeat(64)), '')
  assert.equal(normalizePeerChatCreatorKey(null), '')
  assert.equal(peerIdForCreatorKey(CREATOR), 'c0ffee11')
})

// The short id in a room record is 32 bits. Someone can grind a key that starts
// the same way in minutes, so it is a label, never the thing a removal is
// checked against.
test('sharing the short id is not being the creator', () => {
  assert.equal(peerIdForCreatorKey(IMPOSTOR), peerIdForCreatorKey(CREATOR))
  assert.equal(
    isPeerChatRoomCreator({ roomKey: ROOM, storedKey: CREATOR, connectionKey: IMPOSTOR }),
    false
  )
  assert.equal(
    isPeerChatRoomCreator({ roomKey: ROOM, storedKey: CREATOR, connectionKey: CREATOR }),
    true
  )
})

test('a room with no creator key trusts nobody', () => {
  assert.equal(
    isPeerChatRoomCreator({ roomKey: ROOM, storedKey: '', connectionKey: CREATOR }),
    false
  )
})

// Anyone can claim to know who made a room. Only one peer can prove it, by
// being on the other end of the connection the claim arrived on.
test('a creator key is only taken from the creator', () => {
  const base = { roomKey: ROOM, storedKey: '', createdBy: 'c0ffee11' }

  assert.equal(
    acceptsPeerChatCreatorKey({ ...base, announcedKey: CREATOR, connectionKey: CREATOR }),
    true
  )
  // Someone else passing it along, however honestly.
  assert.equal(
    acceptsPeerChatCreatorKey({ ...base, announcedKey: CREATOR, connectionKey: SOMEONE }),
    false
  )
  // And it has to match the short id the room already remembers.
  assert.equal(
    acceptsPeerChatCreatorKey({ ...base, announcedKey: SOMEONE, connectionKey: SOMEONE }),
    false
  )
})

test('a creator key already settled is not replaced', () => {
  assert.equal(
    acceptsPeerChatCreatorKey({
      roomKey: ROOM,
      storedKey: CREATOR,
      createdBy: 'c0ffee11',
      announcedKey: IMPOSTOR,
      connectionKey: IMPOSTOR
    }),
    false
  )
})

test('a room that never knew who made it takes the first provable answer', () => {
  assert.equal(
    acceptsPeerChatCreatorKey({
      roomKey: ROOM,
      storedKey: '',
      createdBy: '',
      announcedKey: SOMEONE,
      connectionKey: SOMEONE
    }),
    true
  )
})

test('a pinned key cannot be talked out of', () => {
  // Nothing is pinned for an ordinary room, so the stored one stands.
  assert.equal(resolvePeerChatCreatorKey(ROOM, CREATOR), CREATOR)
  assert.equal(resolvePeerChatCreatorKey(ROOM, ''), '')
})

test('removals are kept once each, by key where there is one', () => {
  const bans = normalizePeerChatRoomBans([
    { id: 'c0ffee11', at: 1 },
    { key: CREATOR, at: 2 },
    { id: 'nothex!!', at: 3 },
    { id: 'd00dfeed', at: 0 }
  ])

  assert.equal(bans.length, 2)
  assert.equal(bans.find((ban) => ban.id === 'c0ffee11').key, CREATOR)
  assert.equal(bans.find((ban) => ban.id === 'd00dfeed').key, '')
})

// A device that joins after somebody was removed never met them, and said
// "c0ffee11 was removed" with only eight letters of their key to go on.
test('a removal carries the name the creator knew them by', () => {
  const bans = addPeerChatRoomBan([], { id: 'c0ffee11', at: 5, name: '  Bob   Smith ' })
  assert.equal(bans[0].name, 'Bob Smith')

  // It survives being sent and read back, and a full key arriving later keeps it.
  const relayed = normalizePeerChatRoomBans(JSON.parse(JSON.stringify(bans)))
  assert.equal(relayed[0].name, 'Bob Smith')
  assert.equal(normalizePeerChatRoomBans([...relayed, { key: CREATOR, at: 6 }]).find((ban) => ban.id === 'c0ffee11').name, 'Bob Smith')

  // Only what a profile name may be: nothing else rides in on it.
  for (const name of ['<b>Bob</b>', 'Bob\u202e', 'x'.repeat(51), 42, null]) {
    assert.equal(normalizePeerChatRoomBans([{ id: 'c0ffee11', at: 1, name }])[0].name, '')
  }
})

test('a removal list cannot grow without bound', () => {
  const many = Array.from({ length: MAX_PEERCHAT_ROOM_BANS + 50 }, (_, index) => ({
    id: index.toString(16).padStart(8, '0'),
    at: index + 1
  }))
  assert.equal(normalizePeerChatRoomBans(many).length, MAX_PEERCHAT_ROOM_BANS)
})

test('removing by key catches that key and nobody else', () => {
  const bans = addPeerChatRoomBan([], { key: CREATOR, at: 5 })

  assert.equal(isPeerChatPeerBanned(bans, { connectionKey: CREATOR }), true)
  // Same short id, different person.
  assert.equal(isPeerChatPeerBanned(bans, { connectionKey: IMPOSTOR }), false)
  assert.equal(isPeerChatPeerBanned(bans, { connectionKey: SOMEONE }), false)
})

// Someone can be removed while they are offline, and all the room remembers of
// them then is the short id.
test('removing by short id catches whoever turns up with it', () => {
  const bans = addPeerChatRoomBan([], { id: 'c0ffee11', at: 5 })

  assert.equal(isPeerChatPeerBanned(bans, { connectionKey: CREATOR }), true)
  assert.equal(isPeerChatPeerBanned(bans, { connectionKey: IMPOSTOR }), true)
  assert.equal(isPeerChatPeerBanned(bans, { peerId: 'c0ffee11' }), true)
  assert.equal(isPeerChatPeerBanned(bans, { peerId: 'd00dfeed' }), false)
})

test('nobody is removed from an empty list', () => {
  assert.equal(isPeerChatPeerBanned([], { connectionKey: CREATOR }), false)
  assert.equal(isPeerChatPeerBanned(null, { connectionKey: CREATOR }), false)
  assert.equal(isPeerChatPeerBanned([], { peerId: '' }), false)
})

test('a removal can be taken back', () => {
  const bans = addPeerChatRoomBan([], { key: CREATOR, at: 5 })
  assert.deepEqual(removePeerChatRoomBan(bans, 'c0ffee11'), [])
  assert.equal(removePeerChatRoomBan(bans, 'd00dfeed').length, 1)
})

test('garbage in the list is dropped, not stored', () => {
  assert.deepEqual(normalizePeerChatRoomBans('not a list'), [])
  assert.deepEqual(normalizePeerChatRoomBans([null, 3, { id: 12 }]), [])
  assert.deepEqual(addPeerChatRoomBan([], { id: 'nope' }), [])
})
