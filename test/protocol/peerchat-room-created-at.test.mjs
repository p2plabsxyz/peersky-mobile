import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { earliestPeerChatRoomCreatedAt } from '../../backend/peerchat/protocol.mjs'

const APRIL = Date.UTC(2026, 3, 19)
const SEPTEMBER = Date.UTC(2026, 8, 26)
const NOW = Date.UTC(2026, 8, 27)

// A room whose messages start in April read as created in September on a phone
// that joined then, because nothing shared the date and each device stamped
// its own join.
test('the earliest date anybody reports wins', () => {
  assert.equal(earliestPeerChatRoomCreatedAt(SEPTEMBER, APRIL, NOW), APRIL)
  assert.equal(earliestPeerChatRoomCreatedAt(APRIL, SEPTEMBER, NOW), APRIL)
})

test('a device with no date yet takes whatever it is told', () => {
  assert.equal(earliestPeerChatRoomCreatedAt(0, APRIL, NOW), APRIL)
})

test('a date in the future is nonsense and is ignored', () => {
  assert.equal(earliestPeerChatRoomCreatedAt(SEPTEMBER, NOW + 86400000, NOW), SEPTEMBER)
  // Which is also what stops a peer with a wrong clock dragging it forward.
  assert.equal(earliestPeerChatRoomCreatedAt(0, NOW + 86400000, NOW), 0)
})

test('nothing sensible leaves what we had alone', () => {
  assert.equal(earliestPeerChatRoomCreatedAt(APRIL, undefined, NOW), APRIL)
  assert.equal(earliestPeerChatRoomCreatedAt(APRIL, 0, NOW), APRIL)
  assert.equal(earliestPeerChatRoomCreatedAt(APRIL, -5, NOW), APRIL)
  assert.equal(earliestPeerChatRoomCreatedAt(APRIL, 'April', NOW), APRIL)
})

test('both sides send the date and keep the earliest', async () => {
  const service = await readFile(new URL('../../backend/peerchat/service.mjs', import.meta.url), 'utf8')
  const meta = service.slice(service.indexOf("type: 'room-meta'"), service.indexOf('sanitizeModeratedPreview ('))

  assert.match(meta, /createdAt: normalizePeerChatReadTimestamp\(room\.createdAt\)/)
  assert.match(service, /earliestPeerChatRoomCreatedAt\(room\.createdAt, message\.createdAt\)/)
})
