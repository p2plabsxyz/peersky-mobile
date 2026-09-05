import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizePeerChatMentionSpacing,
  splitPeerChatMentions
} from '../../app/peerchat/message-text.mjs'

test('PeerChat styles only a known mention when text follows immediately', () => {
  assert.deepEqual(splitPeerChatMentions('@Harshalhello there', ['Harshal']), [
    { text: '@Harshal', mention: true },
    { text: 'hello there', mention: false }
  ])
})

test('PeerChat prefers the longest matching room-member name', () => {
  assert.deepEqual(splitPeerChatMentions('Hi @Harshal Atre welcome', ['Harshal', 'Harshal Atre']), [
    { text: 'Hi ', mention: false },
    { text: '@Harshal Atre', mention: true },
    { text: ' welcome', mention: false }
  ])
})

test('PeerChat does not style email-like text or unknown names', () => {
  assert.deepEqual(splitPeerChatMentions('mail a@Harshal and @Unknown', ['Harshal']), [
    { text: 'mail a@Harshal and @Unknown', mention: false }
  ])
})

test('PeerChat separates known mentions for the desktop renderer', () => {
  assert.equal(
    normalizePeerChatMentionSpacing('@Harshal2 hi hello', ['Harshal2']),
    '@Harshal2  hi hello'
  )
  assert.equal(
    normalizePeerChatMentionSpacing('@Harshal2  hi hello', ['Harshal2']),
    '@Harshal2  hi hello'
  )
})
