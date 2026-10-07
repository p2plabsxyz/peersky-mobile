import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPeerChatReport, PEERCHAT_REPORT_EMAIL } from '../../app/peerchat/report.mjs'

const ROOM_KEY = 'ab'.repeat(32)
const member = { id: '1a2b3c4d', username: 'Mallory' }
const now = new Date('2026-10-01T12:00:00Z')

// A room key lets whoever holds it into the room and its whole history, so a
// report names the room by a hash of the key instead.
test('a report names the room without its key', () => {
  const report = buildPeerChatReport({ member, roomName: 'Book club', roomId: 'c0ffee00c0ffee00', now })
  assert.match(report.body, /Room: Book club/)
  assert.match(report.body, /Room ID: c0ffee00c0ffee00/)
  assert.match(report.body, /Peer ID: 1a2b3c4d/)
  assert.ok(!report.body.includes(ROOM_KEY))
  assert.ok(!decodeURIComponent(report.url).includes(ROOM_KEY))
  assert.ok(report.url.startsWith(`mailto:${PEERCHAT_REPORT_EMAIL}?subject=`))
  assert.equal(report.subject, 'PeerChat report: Mallory')
})

test('a reported message is quoted, and a long one is cut short', () => {
  const report = buildPeerChatReport({
    member,
    roomName: 'Book club',
    roomId: 'c0ffee00c0ffee00',
    message: { text: 'x'.repeat(1500), ts: Date.parse('2026-10-01T11:59:00Z') },
    now
  })
  assert.match(report.body, /Message sent at: 2026-10-01T11:59:00.000Z/)
  assert.match(report.body, /Message:\nx{1000}…\n/)
  assert.doesNotMatch(report.body, /x{1001}/)
})
