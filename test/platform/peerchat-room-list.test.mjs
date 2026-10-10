import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

// The pin sat left of the time, which is wider on some rows ("10:42 AM") than
// on others ("02 Oct"), so pins wandered across the list instead of lining up.
test('chat list rows put the pin last, on a line of its own under the time', () => {
  const meta = screen.slice(screen.indexOf('<View style={styles.roomMeta}>'), screen.indexOf('{formatRoomConnection(item, true)}'))
  const time = meta.indexOf('formatRoomTime(item)')
  const state = meta.indexOf('<View style={styles.roomStateRow}>')
  assert.ok(time !== -1 && state > time, 'the time comes first, on its own line')

  const row = meta.slice(state, meta.indexOf('styles.roomPeerCount'))
  const badge = row.indexOf('styles.unreadBadge')
  const mute = row.indexOf('<MuteIcon')
  const pin = row.indexOf('<PinIcon')
  assert.ok(badge !== -1 && badge < mute && mute < pin, 'unread count, then mute, then pin')
})

// One bubble read "@ 2" for a mention and two messages. They are two now, the
// mention first, and a muted chat greys its count but still shows a mention.
test('mentions and messages have bubbles of their own, and a muted chat greys its count', () => {
  const row = screen.slice(screen.indexOf('<View style={styles.roomStateRow}>'), screen.indexOf('<MuteIcon'))
  const mention = row.indexOf('{item.unreadMentions} @')
  const count = row.indexOf('>{item.unreadCount}<')
  assert.ok(mention !== -1 && count > mention, 'the mention bubble, then the count')
  assert.match(row, /backgroundColor: item\.isMuted \? colors\.muted : colors\.accent/)
  assert.doesNotMatch(row, /'@ ' : ''/)
})

test('a row keeps the same height with or without a pin or unread count', () => {
  assert.match(screen, /roomStateRow: \{[^}]*minHeight: 18/)
  assert.match(screen, /roomTime: \{[^}]*minHeight: ROOM_STATE_ICON_SIZE/)
})
