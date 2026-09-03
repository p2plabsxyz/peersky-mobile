import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterPeerChatMessages,
  PEERCHAT_SEARCH_QUERY_MAX_CHARACTERS
} from '../../app/peerchat/message-search.mjs'

const messages = [
  { id: '1', senderName: 'Alice', message: 'Release notes', replyTo: null },
  { id: '2', senderName: 'Desktop User', message: 'Looks good', replyTo: { sn: 'Alice', text: 'Please review' } }
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
