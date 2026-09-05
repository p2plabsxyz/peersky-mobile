import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parsePeerChatIntroState,
  PEERCHAT_INTRO_MAX_BYTES,
  PEERCHAT_INTRO_POINTS,
  serializePeerChatIntroState
} from '../../app/peerchat/intro-state.mjs'

test('PeerChat intro uses the mentor-approved four-point explanation', () => {
  assert.equal(PEERCHAT_INTRO_POINTS.length, 4)
  assert.match(PEERCHAT_INTRO_POINTS[0], /No server in the middle/)
  assert.match(PEERCHAT_INTRO_POINTS[1], /both phones are connected/)
  assert.match(PEERCHAT_INTRO_POINTS[2], /running in the background/)
  assert.match(PEERCHAT_INTRO_POINTS[3], /no internet at all/)
})

test('PeerChat intro completion accepts only its current versioned marker', () => {
  assert.equal(parsePeerChatIntroState(serializePeerChatIntroState()), true)
  assert.equal(parsePeerChatIntroState('{"version":2,"completed":true}'), false)
  assert.equal(parsePeerChatIntroState('{"version":1,"completed":false}'), false)
  assert.equal(parsePeerChatIntroState('{invalid'), false)
  assert.equal(parsePeerChatIntroState('x'.repeat(PEERCHAT_INTRO_MAX_BYTES + 1)), false)
})
