import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BACK_EDGE_WIDTH,
  BACK_SWIPE_MAX_OFFSET,
  backSwipeOffset,
  isBackEdgeSwipe,
  shouldCompleteBackSwipe,
  startsAtBackEdge
} from '../../app/browser-back-gesture.mjs'

// Swiping back worked on web pages, where WKWebView handles it, and nowhere
// else. peersky://home and the p2p apps are React Native screens with no web
// history to swipe through, so the gesture is decided here instead.

test('a drag from the left edge pulling right goes back', () => {
  assert.equal(isBackEdgeSwipe({ startX: 6, dx: 40, dy: 5 }), true)
})

test('a thumb that drifts while pulling right still goes back', () => {
  assert.equal(isBackEdgeSwipe({ startX: 2, dx: 60, dy: 25 }), true)
})

test('a drag that starts away from the edge is left alone', () => {
  assert.equal(isBackEdgeSwipe({ startX: 200, dx: 60, dy: 0 }), false)
  assert.equal(startsAtBackEdge(BACK_EDGE_WIDTH + 1), false)
})

test('scrolling a page from the edge does not go back', () => {
  assert.equal(isBackEdgeSwipe({ startX: 4, dx: 8, dy: 70 }), false)
  assert.equal(isBackEdgeSwipe({ startX: 4, dx: 30, dy: 40 }), false)
})

test('pulling left from the edge does not go back', () => {
  assert.equal(isBackEdgeSwipe({ startX: 4, dx: -60, dy: 0 }), false)
})

test('a tap on the edge does not go back', () => {
  assert.equal(isBackEdgeSwipe({ startX: 4, dx: 0, dy: 0 }), false)
  assert.equal(isBackEdgeSwipe({ startX: 4, dx: 5, dy: 1 }), false)
})

test('a missing or nonsense start is not an edge', () => {
  assert.equal(startsAtBackEdge(undefined), false)
  assert.equal(startsAtBackEdge(-1), false)
  assert.equal(startsAtBackEdge(Number.NaN), false)
})

// The gesture used to jump straight to the previous page on release with no
// sign it had been recognised. The page follows the finger now, damped and
// capped, because what is behind it is not drawn and a full drag would open a
// gap.

test('the page follows the finger', () => {
  assert.ok(backSwipeOffset(40) > 0)
  assert.ok(backSwipeOffset(80) > backSwipeOffset(40))
})

test('the page never slides far enough to open a gap', () => {
  assert.equal(backSwipeOffset(2000), BACK_SWIPE_MAX_OFFSET)
  assert.ok(backSwipeOffset(300) <= BACK_SWIPE_MAX_OFFSET)
})

test('pulling the wrong way moves nothing', () => {
  assert.equal(backSwipeOffset(-120), 0)
  assert.equal(backSwipeOffset(0), 0)
  assert.equal(backSwipeOffset(undefined), 0)
})

test('a long pull goes back', () => {
  assert.equal(shouldCompleteBackSwipe({ dx: 90, vx: 0 }), true)
})

test('a quick flick goes back without crossing the whole distance', () => {
  assert.equal(shouldCompleteBackSwipe({ dx: 30, vx: 0.8 }), true)
})

test('a small hesitant drag springs home instead', () => {
  assert.equal(shouldCompleteBackSwipe({ dx: 20, vx: 0.05 }), false)
  assert.equal(shouldCompleteBackSwipe({ dx: 60, vx: 0 }), false)
})

test('a drag that reverses does not go back', () => {
  assert.equal(shouldCompleteBackSwipe({ dx: -80, vx: -1 }), false)
})
