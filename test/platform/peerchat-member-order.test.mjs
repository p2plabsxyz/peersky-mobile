import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { holdPeerChatMemberOrder, peerChatMemberKey } from '../../app/peerchat/member-order.mjs'

const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

const member = (username, online = true, idle = false, extra = {}) => ({ id: `${username}-id`, username, online, idle, ...extra })
const names = (list) => list.map((entry) => entry.username)

test('with no order held, the list is shown as it came', () => {
  const list = [member('Alex', true, false, { self: true }), member('Ada'), member('Ben', true, true), member('Cara', false)]
  const shown = holdPeerChatMemberOrder(null, list)
  assert.deepEqual(names(shown.members), ['Alex', 'Ada', 'Ben', 'Cara'])
  assert.deepEqual(shown.keys, ['alex', 'ada', 'ben', 'cara'])
})

// The bug: every check re-sorted the list, so someone going idle, coming back
// or reconnecting moved rows while Room info was open.
test('someone going idle, coming back or dropping off keeps their row', () => {
  const first = holdPeerChatMemberOrder(null, [member('Alex', true, false, { self: true }), member('Ada'), member('Ben'), member('Cara', true, true), member('Dev', false)])
  // As the next check sorts it: Ada away now, Cara back, Ben gone offline.
  const next = holdPeerChatMemberOrder(first.keys, [member('Alex', true, false, { self: true }), member('Cara'), member('Ada', true, true), member('Ben', false), member('Dev', false)])
  assert.deepEqual(names(next.members), ['Alex', 'Ada', 'Ben', 'Cara', 'Dev'])
  // Each row shows what it is now, where it was.
  assert.equal(next.members[1].idle, true)
  assert.equal(next.members[2].online, false)
  assert.equal(next.members[3].idle, false)
})

test('someone new goes at the end and someone gone is gone', () => {
  const first = holdPeerChatMemberOrder(null, [member('Alex', true, false, { self: true }), member('Ada'), member('Ben', false)])
  const next = holdPeerChatMemberOrder(first.keys, [member('Alex', true, false, { self: true }), member('Eli'), member('Ada'), member('Fay', false)])
  assert.deepEqual(names(next.members), ['Alex', 'Ada', 'Eli', 'Fay'])
  assert.deepEqual(next.keys, ['alex', 'ada', 'eli', 'fay'])
  // And they stay where they went.
  const after = holdPeerChatMemberOrder(next.keys, [member('Alex', true, false, { self: true }), member('Fay'), member('Eli', true, true), member('Ada')])
  assert.deepEqual(names(after.members), ['Alex', 'Ada', 'Eli', 'Fay'])
})

// The list is one row per name, and which device it shows changes when one
// goes idle. The row is the person's, so it stays put and is not drawn anew.
test('a person on two devices keeps one row when the device it shows changes', () => {
  assert.equal(peerChatMemberKey({ id: 'a1', username: 'Ivy' }), peerChatMemberKey({ id: 'b2', username: 'ivy' }))
  assert.equal(peerChatMemberKey({ id: 'abc' }), 'abc')
  assert.equal(peerChatMemberKey(null), '')
  const first = holdPeerChatMemberOrder(null, [member('Ivy', true, false, { id: 'phone' }), member('Jo')])
  const next = holdPeerChatMemberOrder(first.keys, [member('Jo'), member('Ivy', true, false, { id: 'desktop' })])
  assert.deepEqual(names(next.members), ['Ivy', 'Jo'])
  assert.equal(next.members[0].id, 'desktop')
})

test('anything but a list shows nothing', () => {
  assert.deepEqual(holdPeerChatMemberOrder(['ada'], undefined), { members: [], keys: [] })
  assert.deepEqual(holdPeerChatMemberOrder(null, 'nope'), { members: [], keys: [] })
})

test('Room info holds its order while open, sorts afresh each time it opens, and keys rows by person', () => {
  assert.match(screen, /holdPeerChatMemberOrder\(heldOrder, activeRoom\?\.members \|\| \[\]\)/)
  assert.match(screen, /filterPeerChatMembers\(\s*roomInfoMembers\.members,/)
  // Every way in goes through openRoomInfo, which lets go of the old order.
  assert.equal(screen.match(/setShowRoomInfo\(true\)/g).length, 1)
  assert.match(screen, /function openRoomInfo \(\) \{\n\s*roomInfoOrderRef\.current = null\n\s*setShowRoomInfo\(true\)/)
  const rows = screen.slice(screen.indexOf('{visibleMembers.map((member) => ('), screen.indexOf('{visibleMembers.length === 0 &&'))
  assert.match(rows, /key=\{peerChatMemberKey\(member\)\}/)
})
