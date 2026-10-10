import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getTabDropIndex, isHorizontalSwipe, shouldCloseOnRelease, TAB_CARD_GAP } from '../../app/tabs/tab-swipe.mjs'

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

test('a dragged tab card lands where it was let go, in the grid and in the list', () => {
  const card = { width: 170, height: 190, count: 7 }
  const across = card.width + TAB_CARD_GAP
  const down = card.height + TAB_CARD_GAP
  // Grid: one row down and one across from the first card is the fourth.
  assert.equal(getTabDropIndex({ ...card, from: 0, dx: across, dy: down, columns: 2 }), 3)
  // Less than half a card is no move at all.
  assert.equal(getTabDropIndex({ ...card, from: 2, dx: across * 0.4, dy: -down * 0.4, columns: 2 }), 2)
  // Kept inside the list both ways.
  assert.equal(getTabDropIndex({ ...card, from: 1, dx: 0, dy: -down * 5, columns: 2 }), 0)
  assert.equal(getTabDropIndex({ ...card, from: 5, dx: 0, dy: down * 5, columns: 2 }), 6)
  // List: only rows count.
  assert.equal(getTabDropIndex({ width: 360, height: 112, count: 4, from: 3, dx: 300, dy: -2 * (112 + TAB_CARD_GAP), columns: 1 }), 1)
})
