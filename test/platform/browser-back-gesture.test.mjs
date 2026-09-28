import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BACK_EDGE_WIDTH,
  backSwipeProgress,
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

// The page used to slide with the finger, and a swipe cut short left it slid:
// the browser sat a quarter of a screen to the right until something re-rendered
// it. An edge chip answers the gesture instead, so nothing underneath moves.

test('the chip comes in as the finger travels', () => {
  assert.ok(backSwipeProgress(20) > 0)
  assert.ok(backSwipeProgress(40) > backSwipeProgress(20))
})

test('the chip is full by the point where letting go goes back', () => {
  const committed = { dx: 64.1, vx: 0 }
  assert.equal(shouldCompleteBackSwipe(committed), true)
  assert.equal(backSwipeProgress(committed.dx), 1)
  assert.equal(backSwipeProgress(2000), 1)
})

test('pulling the wrong way shows nothing', () => {
  assert.equal(backSwipeProgress(-120), 0)
  assert.equal(backSwipeProgress(0), 0)
  assert.equal(backSwipeProgress(undefined), 0)
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
