import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterPeerChatMembers,
  filterPeerChatMessages,
  filterPeerChatRooms,
  formatPeerChatDateLabel,
  formatPeerChatMessageDetails,
  getFirstUnreadMessageIndex,
  isPeerChatNearBottom,
  PEERCHAT_SEARCH_QUERY_MAX_CHARACTERS
} from '../../app/peerchat/message-search.mjs'

const messages = [
  { id: '1', senderName: 'Alice', message: 'Release notes', replyTo: null },
  { id: '2', senderName: 'Desktop User', message: 'Looks good', replyTo: { sn: 'Alice', text: 'Please review' } }
]

const rooms = [
  { roomKey: 'ab'.repeat(32), name: 'Release Room', lastMessage: { senderName: 'Alice', message: 'Ship it' } },
  { roomKey: 'cd'.repeat(32), name: 'Design', lastMessage: { senderName: 'Desktop User', message: 'New mockup' } }
]

test('PeerChat message search matches text, sender, and reply metadata', () => {
  assert.deepEqual(filterPeerChatMessages(messages, 'RELEASE').map((item) => item.id), ['1'])
  assert.deepEqual(filterPeerChatMessages(messages, 'desktop').map((item) => item.id), ['2'])
  assert.deepEqual(filterPeerChatMessages(messages, 'please review').map((item) => item.id), ['2'])
  assert.equal(filterPeerChatMessages(messages, 'missing').length, 0)
})

test('PeerChat message search handles invalid and bounded Unicode queries', () => {
  assert.equal(filterPeerChatMessages(messages, null).length, 2)
  assert.equal(filterPeerChatMessages(null, 'release').length, 0)
  const oversized = `${'x'.repeat(PEERCHAT_SEARCH_QUERY_MAX_CHARACTERS)}release`
  assert.equal(filterPeerChatMessages(messages, oversized).length, 0)
})

test('PeerChat room search matches names, keys, senders, and previews', () => {
  assert.deepEqual(filterPeerChatRooms(rooms, 'release').map((item) => item.name), ['Release Room'])
  assert.deepEqual(filterPeerChatRooms(rooms, 'desktop').map((item) => item.name), ['Design'])
  assert.deepEqual(filterPeerChatRooms(rooms, 'new mockup').map((item) => item.name), ['Design'])
  assert.deepEqual(filterPeerChatRooms(rooms, 'ab'.repeat(4)).map((item) => item.name), ['Release Room'])
  assert.equal(filterPeerChatRooms(rooms, 'missing').length, 0)
})

test('PeerChat member search matches names, bios, and peer IDs', () => {
  const members = [
    { id: 'peer-a', username: 'Alice', bio: 'Release lead' },
    { id: 'peer-b', username: 'Bob', bio: 'Mobile developer' }
  ]

  assert.deepEqual(filterPeerChatMembers(members, 'alice').map((item) => item.id), ['peer-a'])
  assert.deepEqual(filterPeerChatMembers(members, 'mobile').map((item) => item.id), ['peer-b'])
  assert.deepEqual(filterPeerChatMembers(members, 'peer-b').map((item) => item.id), ['peer-b'])
  assert.equal(filterPeerChatMembers(members, 'missing').length, 0)
  assert.deepEqual(filterPeerChatMembers(null, 'alice'), [])
})

test('PeerChat finds the first message after a valid read timestamp', () => {
  const timeline = [
    { id: '1', timestamp: 100 },
    { id: '2', timestamp: 200 },
    { id: '3', timestamp: 300 }
  ]

  assert.equal(getFirstUnreadMessageIndex(timeline, 200), 2)
  assert.equal(getFirstUnreadMessageIndex(timeline, 300), -1)
  assert.equal(getFirstUnreadMessageIndex(timeline, 0), -1)
  assert.equal(getFirstUnreadMessageIndex(timeline, Number.MAX_SAFE_INTEGER + 1), -1)
  assert.equal(getFirstUnreadMessageIndex(null, 200), -1)
})

test('PeerChat formats desktop-compatible message date separators', () => {
  const now = new Date(2026, 8, 4, 12).getTime()
  const yesterday = new Date(2026, 8, 3, 23, 59).getTime()
  const earlierThisWeek = new Date(2026, 8, 1, 12).getTime()
  const older = new Date(2026, 7, 20, 12).getTime()

  assert.equal(formatPeerChatDateLabel(now, now), 'Today')
  assert.equal(formatPeerChatDateLabel(yesterday, now), 'Yesterday')
  assert.equal(
    formatPeerChatDateLabel(earlierThisWeek, now),
    new Date(earlierThisWeek).toLocaleDateString([], { weekday: 'long' })
  )
  assert.equal(
    formatPeerChatDateLabel(older, now),
    new Date(older).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
  )
  assert.equal(formatPeerChatDateLabel(Number.NaN, now), '')
})

test('PeerChat formats bounded message details', () => {
  const timestamp = new Date(2026, 8, 4, 12, 30).getTime()
  const date = new Date(timestamp)
  const day = date.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  assert.equal(formatPeerChatMessageDetails(timestamp), `Sent ${day} at ${date.toLocaleTimeString()}`)
  assert.equal(formatPeerChatMessageDetails(-1), 'Sent time unavailable')
  assert.equal(formatPeerChatMessageDetails(Number.NaN), 'Sent time unavailable')
})

test('PeerChat detects whether the message list is near its latest item', () => {
  assert.equal(isPeerChatNearBottom({ contentHeight: 1000, viewportHeight: 400, offsetY: 530 }), true)
  assert.equal(isPeerChatNearBottom({ contentHeight: 1000, viewportHeight: 400, offsetY: 400 }), false)
  assert.equal(isPeerChatNearBottom({ contentHeight: 300, viewportHeight: 400, offsetY: 0 }), true)
  assert.equal(isPeerChatNearBottom({ contentHeight: 1000, viewportHeight: 400, offsetY: -20 }), false)
  assert.equal(isPeerChatNearBottom({ contentHeight: Number.NaN, viewportHeight: 400, offsetY: 0 }), true)
  assert.equal(isPeerChatNearBottom(null), true)
})
