import assert from 'node:assert/strict'
import test from 'node:test'

import { PEERCHAT_ADULT_DOMAINS } from '../../backend/peerchat/moderation-data.mjs'
import {
  checkPeerChatContent,
  createPeerChatModerator,
  normalizePeerChatModeration,
  PEERCHAT_MODERATION_KICK_MS,
  PEERCHAT_MODERATION_WINDOW_MS
} from '../../backend/peerchat/moderation.mjs'

const ROOM_KEY = 'ab'.repeat(32)

test('PeerChat sanitizes room moderation settings', () => {
  assert.deepEqual(normalizePeerChatModeration(), {
    abuseFilter: true,
    nsfwFilter: true,
    spamRateLimit: 10
  })
  assert.deepEqual(normalizePeerChatModeration({
    abuseFilter: false,
    nsfwFilter: false,
    spamRateLimit: 999
  }), {
    abuseFilter: false,
    nsfwFilter: false,
    spamRateLimit: 50
  })
})

test('PeerChat applies configurable content filters and always blocks adult domains', () => {
  assert.equal(checkPeerChatContent('please kys', {}).flagged, true)
  assert.equal(checkPeerChatContent('please kys', { abuseFilter: false }).flagged, false)
  assert.equal(checkPeerChatContent('what the fuck', {}).flagged, true)
  assert.equal(checkPeerChatContent('what the fuck', { nsfwFilter: false }).flagged, false)

  const domain = PEERCHAT_ADULT_DOMAINS[0]
  const result = checkPeerChatContent(`open https://sub.${domain}/page`, {
    abuseFilter: false,
    nsfwFilter: false
  })
  assert.equal(result.flagged, true)
  assert.match(result.reason, /adult domain/)
})

test('PeerChat warns twice, then temporarily blocks a violating live peer', () => {
  const moderator = createPeerChatModerator()
  const options = { now: 1_000, settings: {} }

  assert.equal(moderator.checkMessage('peer', ROOM_KEY, 'stfu', options).action, 'warn')
  assert.equal(moderator.checkMessage('peer', ROOM_KEY, 'stfu', options).action, 'final-warn')
  const kicked = moderator.checkMessage('peer', ROOM_KEY, 'stfu', options)
  assert.equal(kicked.action, 'kick')
  assert.equal(kicked.blockedUntil, 1_000 + PEERCHAT_MODERATION_KICK_MS)
  assert.equal(moderator.isKicked('peer', ROOM_KEY, 1_001), true)
  assert.equal(moderator.isKicked('peer', ROOM_KEY, kicked.blockedUntil), false)
})

test('PeerChat enforces the selected rolling spam limit', () => {
  const moderator = createPeerChatModerator()
  const settings = { abuseFilter: false, nsfwFilter: false, spamRateLimit: 5 }
  for (let index = 0; index < 4; index += 1) {
    assert.equal(moderator.checkMessage('peer', ROOM_KEY, 'hello', { now: index, settings }).allowed, true)
  }
  assert.match(moderator.checkMessage('peer', ROOM_KEY, 'hello', { now: 4, settings }).reason, /spam/)
  assert.equal(moderator.checkMessage('other', ROOM_KEY, 'hello', { now: 4, settings }).allowed, true)
  assert.equal(moderator.checkMessage('peer', ROOM_KEY, 'hello', {
    now: PEERCHAT_MODERATION_WINDOW_MS + 5,
    settings
  }).allowed, true)
})

test('PeerChat moderation state can be cleared by room and service lifecycle', () => {
  const moderator = createPeerChatModerator()
  moderator.checkMessage('peer', ROOM_KEY, 'stfu', { now: 1 })
  moderator.clearRoom(ROOM_KEY)
  assert.equal(moderator.checkMessage('peer', ROOM_KEY, 'stfu', { now: 2 }).action, 'warn')
  moderator.clear()
  assert.equal(moderator.checkMessage('peer', ROOM_KEY, 'stfu', { now: 3 }).action, 'warn')
})

test('PeerChat bounds hostile peer-room moderation bookkeeping', () => {
  const moderator = createPeerChatModerator({ maxTrackedPeerRooms: 2 })
  moderator.checkMessage('old-peer', ROOM_KEY, 'stfu', { now: 1 })
  moderator.checkMessage('second-peer', ROOM_KEY, 'stfu', { now: 2 })
  moderator.checkMessage('third-peer', ROOM_KEY, 'stfu', { now: 3 })

  assert.equal(moderator.checkMessage('old-peer', ROOM_KEY, 'stfu', { now: 4 }).action, 'warn')
})
