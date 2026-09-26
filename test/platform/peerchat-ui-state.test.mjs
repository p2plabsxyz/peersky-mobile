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
