import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parsePeerChatUiState,
  PEERCHAT_RECENT_EMOJI_MAX,
  recordRecentEmoji,
  PEERCHAT_DRAFT_MAX_CHARACTERS,
  PEERCHAT_UI_STATE_MAX_BYTES,
  serializePeerChatUiState
} from '../../app/peerchat/ui-state.mjs'

const ROOM_A = 'ab'.repeat(32)
const ROOM_B = 'cd'.repeat(32)

test('PeerChat UI state restores an active room and its draft', () => {
  const restored = parsePeerChatUiState(serializePeerChatUiState({
    activeRoomKey: ROOM_A,
    draftRoomKey: ROOM_A,
    draft: 'Unsent message'
  }))

  assert.deepEqual(restored, {
    activeRoomKey: ROOM_A,
    draftRoomKey: ROOM_A,
    draft: 'Unsent message',
    recentEmojis: []
  })
})

test('PeerChat UI state rejects malformed room keys and stale draft metadata', () => {
  assert.deepEqual(parsePeerChatUiState(JSON.stringify({
    version: 1,
    activeRoomKey: 'invalid',
    draftRoomKey: ROOM_B,
    draft: ''
  })), {
    activeRoomKey: null,
    draftRoomKey: null,
    draft: '',
    recentEmojis: []
  })
  assert.equal(parsePeerChatUiState('{invalid').activeRoomKey, null)
  assert.equal(parsePeerChatUiState('x'.repeat(PEERCHAT_UI_STATE_MAX_BYTES + 1)).draft, '')
})

test('PeerChat UI state bounds persisted Unicode drafts without splitting characters', () => {
  const oversized = '😀'.repeat(PEERCHAT_DRAFT_MAX_CHARACTERS + 1)
  const restored = parsePeerChatUiState(serializePeerChatUiState({
    activeRoomKey: ROOM_A,
    draftRoomKey: ROOM_A,
    draft: oversized
  }))

  assert.equal(Array.from(restored.draft).length, PEERCHAT_DRAFT_MAX_CHARACTERS)
  assert.equal(restored.draft.endsWith('😀'), true)
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
    draftRoomKey: null,
    draft: '',
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
  assert.match(screen, /function reportMember \(member: PeerChatMember, from: PeerChatRoom \| null = activeRoom\)/)
  assert.match(screen, /reportMember\(peer, from\)/)
})
