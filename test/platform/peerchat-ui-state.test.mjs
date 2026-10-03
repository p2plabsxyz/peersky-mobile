import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parsePeerChatUiState,
  PEERCHAT_MAX_DRAFTS,
  PEERCHAT_RECENT_EMOJI_MAX,
  recordRecentEmoji,
  PEERCHAT_DRAFT_MAX_CHARACTERS,
  PEERCHAT_UI_STATE_MAX_BYTES,
  serializePeerChatUiState,
  setPeerChatDraft
} from '../../app/peerchat/ui-state.mjs'

const ROOM_A = 'ab'.repeat(32)
const ROOM_B = 'cd'.repeat(32)

test('PeerChat UI state restores an active room and its draft', () => {
  const restored = parsePeerChatUiState(serializePeerChatUiState({
    activeRoomKey: ROOM_A,
    drafts: { [ROOM_A]: 'Unsent message' }
  }))

  assert.deepEqual(restored, {
    activeRoomKey: ROOM_A,
    drafts: { [ROOM_A]: 'Unsent message' },
    recentEmojis: []
  })
})

// There was one draft for the whole app, so opening another chat threw away
// what you had typed in the last one.
test('every chat keeps its own draft until it is sent', () => {
  let drafts = setPeerChatDraft({}, ROOM_A, 'for A')
  drafts = setPeerChatDraft(drafts, ROOM_B, 'for B')
  assert.deepEqual(drafts, { [ROOM_B]: 'for B', [ROOM_A]: 'for A' })
  // Newest first, so a full file drops the oldest.
  assert.deepEqual(Object.keys(setPeerChatDraft(drafts, ROOM_A, 'for A again')), [ROOM_A, ROOM_B])
  // Sending empties the composer, and that removes the draft.
  assert.deepEqual(setPeerChatDraft(drafts, ROOM_B, ''), { [ROOM_A]: 'for A' })
  assert.deepEqual(setPeerChatDraft(drafts, 'not a room', 'x'), drafts)

  const restored = parsePeerChatUiState(serializePeerChatUiState({ activeRoomKey: null, drafts }))
  assert.deepEqual(restored.drafts, drafts)
})

test('the drafts are bounded in number and in size', () => {
  let drafts = {}
  for (let index = 0; index < PEERCHAT_MAX_DRAFTS + 5; index += 1) {
    drafts = setPeerChatDraft(drafts, index.toString(16).padStart(64, '0'), `draft ${index}`)
  }
  assert.equal(Object.keys(drafts).length, PEERCHAT_MAX_DRAFTS)
  assert.equal(drafts[(PEERCHAT_MAX_DRAFTS + 4).toString(16).padStart(64, '0')], `draft ${PEERCHAT_MAX_DRAFTS + 4}`)

  const big = 'x'.repeat(PEERCHAT_DRAFT_MAX_CHARACTERS)
  const many = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [index.toString(16).padStart(64, 'a'), big]))
  const serialized = serializePeerChatUiState({ activeRoomKey: null, drafts: many })
  assert.ok(serialized.length <= PEERCHAT_UI_STATE_MAX_BYTES)
  // The newest are the ones kept.
  assert.ok(Object.keys(JSON.parse(serialized).drafts)[0] === Object.keys(many)[0])
})

test('a file from before drafts were per chat keeps its one draft', () => {
  assert.deepEqual(parsePeerChatUiState(JSON.stringify({
    version: 1,
    activeRoomKey: ROOM_A,
    draftRoomKey: ROOM_B,
    draft: 'Unsent'
  })), {
    activeRoomKey: ROOM_A,
    drafts: { [ROOM_B]: 'Unsent' },
    recentEmojis: []
  })
})

test('PeerChat UI state rejects malformed room keys and stale draft metadata', () => {
  assert.deepEqual(parsePeerChatUiState(JSON.stringify({
    version: 2,
    activeRoomKey: 'invalid',
    drafts: { [ROOM_B]: '', invalid: 'x' }
  })), {
    activeRoomKey: null,
    drafts: {},
    recentEmojis: []
  })
  assert.equal(parsePeerChatUiState('{invalid').activeRoomKey, null)
  assert.deepEqual(parsePeerChatUiState('x'.repeat(PEERCHAT_UI_STATE_MAX_BYTES + 1)).drafts, {})
})

test('PeerChat UI state bounds persisted Unicode drafts without splitting characters', () => {
  const oversized = '😀'.repeat(PEERCHAT_DRAFT_MAX_CHARACTERS + 1)
  const restored = parsePeerChatUiState(serializePeerChatUiState({
    activeRoomKey: ROOM_A,
    drafts: { [ROOM_A]: oversized }
  }))

  assert.equal(Array.from(restored.drafts[ROOM_A]).length, PEERCHAT_DRAFT_MAX_CHARACTERS)
  assert.equal(restored.drafts[ROOM_A].endsWith('😀'), true)
})

test('the screen puts back a chat\'s draft when it opens', async () => {
  const { readFile } = await import('node:fs/promises')
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /if \(composerRoomKeyRef\.current !== room\.roomKey\) setComposer\(draftsRef\.current\[room\.roomKey\] \|\| ''\)/)
  assert.match(screen, /draftsRef\.current = setPeerChatDraft\(draftsRef\.current, composerRoomKeyRef\.current, composer\)/)
  // Leaving a chat for good takes its draft with it.
  assert.match(screen, /draftsRef\.current = setPeerChatDraft\(draftsRef\.current, room\.roomKey, ''\)/)
})

// Desktop keeps a Recent row at the top of its emoji panel. The phone had no
// memory of what you had picked, so every choice started from the full list.
test('PeerChat recent emojis keep the newest first without repeats', () => {
  let recents = []
  for (const emoji of ['\u{1F600}', '\u2764\uFE0F', '\u{1F600}', '\u{1F389}']) {
    recents = recordRecentEmoji(recents, emoji)
  }

  assert.deepEqual(recents, ['\u{1F389}', '\u{1F600}', '\u2764\uFE0F'])
})

test('PeerChat recent emojis stop at the cap', () => {
  let recents = []
  for (let index = 0; index < PEERCHAT_RECENT_EMOJI_MAX + 8; index += 1) {
    recents = recordRecentEmoji(recents, String.fromCodePoint(0x1f600 + index))
  }

  assert.equal(recents.length, PEERCHAT_RECENT_EMOJI_MAX)
  assert.equal(recents[0], String.fromCodePoint(0x1f600 + PEERCHAT_RECENT_EMOJI_MAX + 7))
})

test('PeerChat recent emojis refuse anything that is not one', () => {
  assert.deepEqual(recordRecentEmoji([], ''), [])
  assert.deepEqual(recordRecentEmoji([], '   '), [])
  assert.deepEqual(recordRecentEmoji([], 'not an emoji'), [])
  assert.deepEqual(recordRecentEmoji([], 'x'.repeat(40)), [])
  assert.deepEqual(recordRecentEmoji([], null), [])
})

test('PeerChat recent emojis survive a round trip', () => {
  const recents = recordRecentEmoji([], '\u{1F389}')
  const restored = parsePeerChatUiState(serializePeerChatUiState({
    activeRoomKey: null,
    drafts: {},
    recentEmojis: recents
  }))

  assert.deepEqual(restored.recentEmojis, recents)
})

test('PeerChat recent emojis survive a file written before they existed', () => {
  const restored = parsePeerChatUiState(JSON.stringify({
    version: 1,
    activeRoomKey: null,
    draftRoomKey: null,
    draft: ''
  }))

  assert.deepEqual(restored.recentEmojis, [])
})

// A long press on a chat offers what that chat can actually do. A room key is
// the way into a room, so it belongs to rooms; a direct message has no way in
// to hand out, and what it needs instead are the two answers to somebody
// behaving badly.
test('a long press offers a room its key and a direct message its answers', async () => {
  const { readFile } = await import('node:fs/promises')
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

  const sheet = screen.slice(
    screen.indexOf('visible={roomActionTarget !== null}'),
    screen.indexOf('// The preview, plus a plain warning')
  )
  assert.ok(sheet.length > 0)

  // The two arms of the same branch: direct message first, room second.
  const dm = sheet.slice(sheet.indexOf('roomActionTarget.isDM'), sheet.indexOf('Copy room key'))
  assert.match(dm, /Report</)
  assert.match(dm, /confirmBlockPeer\(peer\)/)
  assert.match(dm, /isMemberBlocked\(directMessagePeer\(roomActionTarget\)\) \? 'Unblock' : 'Block'/)
  // Neither of these means anything for a conversation with one person.
  assert.doesNotMatch(dm, /Copy room key/)
  assert.doesNotMatch(dm, /Copy invite link/)

  const room = sheet.slice(sheet.indexOf('Copy room key'))
  assert.match(room, /Copy room key/)
  assert.match(room, /Copy invite link/)

  // The report names the conversation it came from, which is the direct
  // message itself when there is no room open behind it.
  assert.match(screen, /function reportMember \(\s+member: PeerChatMember,\s+from: PeerChatRoom \| null = activeRoom,/)
  assert.match(screen, /reportMember\(peer, from\)/)
})

// The message list is inverted, and an inverted list lays each row's children
// out bottom to top. Handed over as a fragment, the date divider and the
// message were two children, so the divider landed under the first message of
// its day. One View keeps them in reading order.
test('the date divider sits above the first message of its day', async () => {
  const { readFile } = await import('node:fs/promises')
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

  const start = screen.indexOf('data={displayedMessages}')
  const list = screen.slice(start, screen.indexOf('ListEmptyComponent=', start))
  assert.ok(start > -1 && list.length > 0)
  assert.match(list, /\n\s*inverted\n/)

  const row = list.slice(list.indexOf('renderItem='))
  assert.match(row, /return \(\s*<View>\s*\{!!dateLabel && dateLabel !== previousDateLabel && \(/)
  assert.doesNotMatch(row, /return \(\s*<>/)
})

// Only the host's editor showed the room's picture, so everyone else opened
// the details and never saw it. Desktop shows it to everyone.
test('room details show the room picture to everyone, not only the host', async () => {
  const { readFile } = await import('node:fs/promises')
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  const details = screen.slice(screen.indexOf('visible={showRoomInfo}'), screen.indexOf('{!activeRoom.isDM && (\n              <View style={styles.roomProvenance}>'))
  const member = details.slice(details.indexOf(': ('))
  assert.match(member, /<Image\s+accessibilityLabel=\{`Picture of \$\{activeRoom\.name\}`\}\s+source=\{\{ uri: activeRoom\.avatar \}\}/)
  assert.match(member, /getRoomInitials\(activeRoom\.name\)/)
})
