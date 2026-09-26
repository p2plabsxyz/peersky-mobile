import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BACK_EDGE_WIDTH,
  isBackEdgeSwipe,
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
