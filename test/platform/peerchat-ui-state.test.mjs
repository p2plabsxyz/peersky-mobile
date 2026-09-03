import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parsePeerChatUiState,
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
    draft: 'Unsent message'
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
    draft: ''
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
