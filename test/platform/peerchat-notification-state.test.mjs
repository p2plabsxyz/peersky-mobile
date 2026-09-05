import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectPeerChatNotificationCandidates,
  DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES,
  MAX_PEERCHAT_NOTIFICATIONS_PER_POLL,
  parsePeerChatNotificationPreferences,
  serializePeerChatNotificationPreferences
} from '../../app/peerchat/notification-state.mjs'

test('PeerChat notification preferences round-trip and fail safely', () => {
  assert.deepEqual(
    parsePeerChatNotificationPreferences(serializePeerChatNotificationPreferences({ notifications: false, sounds: false })),
    { notifications: false, sounds: false }
  )
  assert.deepEqual(parsePeerChatNotificationPreferences('{broken'), DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES)
  assert.deepEqual(parsePeerChatNotificationPreferences('x'.repeat(300)), DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES)
  assert.deepEqual(parsePeerChatNotificationPreferences('{"version":1}'), {
    notifications: false,
    sounds: true
  })
})

test('PeerChat emits bounded notifications only for new unread unmuted messages', () => {
  const previous = Array.from({ length: 5 }, (_, index) => ({ roomKey: `room-${index}`, unreadCount: 0 }))
  const next = previous.map((room, index) => ({
    ...room,
    name: `Room ${index}`,
    unreadCount: 1,
    isMuted: index === 0,
    lastMessage: { sender: 'peer', senderName: 'Alice', message: `Message ${index}`, timestamp: index }
  }))
  const candidates = collectPeerChatNotificationCandidates(previous, next)

  assert.equal(candidates.length, MAX_PEERCHAT_NOTIFICATIONS_PER_POLL)
  assert.deepEqual(candidates.map((candidate) => candidate.roomKey), ['room-2', 'room-3', 'room-4'])
  assert.equal(collectPeerChatNotificationCandidates([], next).length, 0)
  assert.equal(collectPeerChatNotificationCandidates(previous, previous).length, 0)
})

test('PeerChat notification text is sanitized and bounded', () => {
  const [candidate] = collectPeerChatNotificationCandidates(
    [{ roomKey: 'room', unreadCount: 0 }],
    [{
      roomKey: 'room',
      name: `Room\u0000${'x'.repeat(100)}`,
      unreadCount: 1,
      lastMessage: { sender: 'peer', senderName: 'Alice', message: 'y'.repeat(300), timestamp: 1 }
    }]
  )

  assert.equal(Array.from(candidate.title).length, 80)
  assert.equal(Array.from(candidate.body).length, 180)
  assert.equal(candidate.title.includes('\u0000'), false)
})
