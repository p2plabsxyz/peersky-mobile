import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterPeerChatMessages,
  filterPeerChatRooms,
  getFirstUnreadMessageIndex,
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
