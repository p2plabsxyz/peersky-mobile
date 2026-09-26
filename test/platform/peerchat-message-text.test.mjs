import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizePeerChatMentionSpacing,
  splitPeerChatMessageParts,
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

// Desktop turns these into links in a message; the phone rendered them as
// plain text, so a room invite or a drive address could only be copied by hand.
const link = (parts) => parts.filter((part) => part.link).map((part) => part.link)

test('a peersky room invite is a link', () => {
  const invite = 'peersky://p2p/peerchat/#room=' + 'a'.repeat(64)
  assert.deepEqual(link(splitPeerChatMessageParts(invite, [])), [invite])
})

test('a hyper drive address is a link', () => {
  const drive = 'hyper://odo9ihfrexo7pxhajwgyqsiugxatqyfsxrd6r7t7u91u3mgbzn8o/hyperdrive/index.html'
  assert.deepEqual(link(splitPeerChatMessageParts(drive, [])), [drive])
})

test('every scheme desktop links is linked here too', () => {
  const schemes = ['https', 'http', 'hyper', 'ipfs', 'ipns', 'peersky', 'bt', 'bittorrent']
  for (const scheme of schemes) {
    const url = scheme + '://example/thing'
    assert.deepEqual(link(splitPeerChatMessageParts(url, [])), [url], scheme)
  }
  assert.deepEqual(link(splitPeerChatMessageParts('magnet:?xt=urn:btih:abc', [])), ['magnet:?xt=urn:btih:abc'])
  assert.deepEqual(link(splitPeerChatMessageParts('mail me at a.b@c.io', [])), ['mailto:a.b@c.io'])
})

test('a full stop after a link stays in the sentence', () => {
  const parts = splitPeerChatMessageParts('open hyper://key/index.html.', [])
  assert.deepEqual(link(parts), ['hyper://key/index.html'])
  assert.equal(parts.map((part) => part.text).join(''), 'open hyper://key/index.html.')
})

test('mentions still work alongside links', () => {
  const parts = splitPeerChatMessageParts('hi @Akhilesh see https://a.io ok', ['Akhilesh'])
  assert.deepEqual(parts.filter((part) => part.mention).map((part) => part.text), ['@Akhilesh'])
  assert.deepEqual(link(parts), ['https://a.io'])
  assert.equal(parts.map((part) => part.text).join(''), 'hi @Akhilesh see https://a.io ok')
})

test('a message with no link is left whole', () => {
  const parts = splitPeerChatMessageParts('just talking', [])
  assert.deepEqual(parts, [{ text: 'just talking', mention: false, link: null }])
})
