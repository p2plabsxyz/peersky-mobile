import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PEER_PRESENCE_GRACE_MS,
  createPeerPresence
} from '../../backend/peerchat/presence.mjs'

const ROOM = 'ab'.repeat(32)
const OTHER_ROOM = 'cd'.repeat(32)

// Hyperswarm redials all the time, and so does a phone waking or a laptop
// opening its lid. Counting live connections alone made the peer count and the
// online dots blink every time, which in a busy room never stops.

test('a peer who redials never appears to have left', () => {
  const presence = createPeerPresence()
  presence.markAbsent(ROOM, 'peer-1', 1000)
  assert.equal(presence.isPresent(ROOM, 'peer-1', 1200), true)

  presence.markPresent(ROOM, 'peer-1')
  assert.equal(presence.isPresent(ROOM, 'peer-1', 1200), false)
  assert.deepEqual([...presence.presentIds(ROOM, ['peer-1'], 1200)], ['peer-1'])
})

test('a peer who really goes drops off once the grace runs out', () => {
  const presence = createPeerPresence()
  presence.markAbsent(ROOM, 'peer-1', 1000)

  assert.equal(presence.isPresent(ROOM, 'peer-1', 1000 + PEER_PRESENCE_GRACE_MS - 1), true)
  assert.equal(presence.isPresent(ROOM, 'peer-1', 1000 + PEER_PRESENCE_GRACE_MS), false)
  assert.deepEqual([...presence.presentIds(ROOM, [], 1000 + PEER_PRESENCE_GRACE_MS)], [])
})

test('the count holds steady across a redial', () => {
  const presence = createPeerPresence()
  const live = ['a', 'b', 'c']

  assert.equal(presence.presentIds(ROOM, live, 0).size, 3)
  // "c" drops its connection.
  presence.markAbsent(ROOM, 'c', 0)
  assert.equal(presence.presentIds(ROOM, ['a', 'b'], 500).size, 3)
  // And comes straight back.
  presence.markPresent(ROOM, 'c')
  assert.equal(presence.presentIds(ROOM, live, 600).size, 3)
})

test('a held peer is not counted twice once they are back', () => {
  const presence = createPeerPresence()
  presence.markAbsent(ROOM, 'a', 0)
  assert.equal(presence.presentIds(ROOM, ['a'], 100).size, 1)
})

test('rooms are held apart', () => {
  const presence = createPeerPresence()
  presence.markAbsent(ROOM, 'a', 0)
  assert.equal(presence.isPresent(OTHER_ROOM, 'a', 100), false)
  assert.equal(presence.presentIds(OTHER_ROOM, [], 100).size, 0)
})

// Nothing else fires when a held peer expires, so a caller has to know when to
// look again or the count sits stale.
test('it says when the next peer stops counting', () => {
  const presence = createPeerPresence({ graceMs: 1000 })
  assert.equal(presence.nextExpiryAt(0), null)

  presence.markAbsent(ROOM, 'a', 0)
  presence.markAbsent(ROOM, 'b', 400)
  assert.equal(presence.nextExpiryAt(0), 1000)

  assert.equal(presence.prune(999), false)
  assert.equal(presence.prune(1000), true)
  assert.equal(presence.nextExpiryAt(1000), 1400)
})

test('pruning an empty hold changes nothing', () => {
  const presence = createPeerPresence()
  assert.equal(presence.prune(0), false)
})

test('leaving a room forgets who was in it', () => {
  const presence = createPeerPresence()
  presence.markAbsent(ROOM, 'a', 0)
  presence.forgetRoom(ROOM)
  assert.equal(presence.isPresent(ROOM, 'a', 100), false)
  assert.equal(presence.nextExpiryAt(100), null)
})

test('nothing is held for a peer with no id yet', () => {
  const presence = createPeerPresence()
  presence.markAbsent(ROOM, '', 0)
  presence.markAbsent('', 'a', 0)
  assert.equal(presence.nextExpiryAt(0), null)
})
