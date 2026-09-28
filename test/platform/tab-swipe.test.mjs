import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isHorizontalSwipe, shouldCloseOnRelease } from '../../app/tabs/tab-swipe.mjs'

// Closing a tab by swiping took two or three attempts on a 13 mini: the card
// wanted 10pt of travel and strictly more across than down before it would
// claim the gesture, and a thumb arc is never that straight.

test('a thumb arc that drifts downward still starts a swipe', () => {
  assert.equal(isHorizontalSwipe({ dx: -18, dy: 12 }), true)
})

test('a short deliberate sideways move starts a swipe', () => {
  assert.equal(isHorizontalSwipe({ dx: 8, dy: 1 }), true)
})

test('scrolling the list does not start a swipe', () => {
  assert.equal(isHorizontalSwipe({ dx: 4, dy: 40 }), false)
  assert.equal(isHorizontalSwipe({ dx: 14, dy: 30 }), false)
})

test('a tap does not start a swipe', () => {
  assert.equal(isHorizontalSwipe({ dx: 0, dy: 0 }), false)
  assert.equal(isHorizontalSwipe({ dx: 2, dy: 1 }), false)
})

test('a swipe past the card edge closes it', () => {
  assert.equal(shouldCloseOnRelease({ dx: -80, vx: 0.1 }), true)
})

test('a quick flick closes it without crossing the whole card', () => {
  assert.equal(shouldCloseOnRelease({ dx: -26, vx: -0.6 }), true)
})

test('a slow nudge springs back instead of closing', () => {
  assert.equal(shouldCloseOnRelease({ dx: -18, vx: 0.05 }), false)
})

test('both directions close', () => {
  assert.equal(shouldCloseOnRelease({ dx: 80, vx: 0 }), true)
  assert.equal(shouldCloseOnRelease({ dx: -80, vx: 0 }), true)
})
