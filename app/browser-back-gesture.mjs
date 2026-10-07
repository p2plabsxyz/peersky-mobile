// peersky:// pages are React Native screens, not web pages, so the WebView's
// own edge swipe never reaches them and the only way back was the toolbar
// arrow. This is the same gesture, decided in JS: a drag that starts against
// the left edge and pulls right.

export const BACK_EDGE_WIDTH = 24
const MIN_TRAVEL = 12
// How much further right than up or down the finger has to be moving, so a
// list being scrolled never reads as a back swipe.
const HORIZONTAL_DOMINANCE = 1.5

/** Whether a touch began close enough to the left edge to start a back swipe. */
export function startsAtBackEdge (startX) {
  const x = Number(startX)
  return Number.isFinite(x) && x >= 0 && x <= BACK_EDGE_WIDTH
}

/**
 * Whether a movement from the edge is the back gesture.
 *
 * @param {{ startX: number, dx: number, dy: number }} gesture
 */
export function isBackEdgeSwipe ({ startX, dx, dy }) {
  if (!startsAtBackEdge(startX)) return false
  const across = Number(dx) || 0
  const down = Math.abs(Number(dy) || 0)
  return across > MIN_TRAVEL && across > down * HORIZONTAL_DOMINANCE
}

// How far the finger travels before letting go goes back.
const COMPLETE_TRAVEL = 64
const FLICK_TRAVEL = 24
const FLICK_VELOCITY = 0.3

/**
 * How far in the edge chip is, 0 to 1, for a finger that has travelled dx.
 * Sliding the page instead left it a quarter screen to the right after an
 * interrupted swipe, and only opened a gap, since nothing is drawn behind it.
 * The chip is full at COMPLETE_TRAVEL, so the screen and the release agree on
 * when the swipe has taken.
 */
export function backSwipeProgress (dx) {
  const across = Number(dx) || 0
  if (across <= 0) return 0
  return Math.min(1, across / COMPLETE_TRAVEL)
}

/** Whether a released back swipe should go back or spring home. */
export function shouldCompleteBackSwipe ({ dx, vx }) {
  const across = Number(dx) || 0
  const speed = Number(vx) || 0
  return across > COMPLETE_TRAVEL || (across > FLICK_TRAVEL && speed > FLICK_VELOCITY)
}

// Forward is the same gesture from the other side: a drag that starts against
// the right edge and pulls left. Only back had one, so a page you had come back
// from could only be reached again with the toolbar arrow.

/** Whether a touch began close enough to the right edge to start a forward swipe. */
export function startsAtForwardEdge (startX, width) {
  const x = Number(startX)
  const edge = Number(width)
  return Number.isFinite(x) && Number.isFinite(edge) && edge > 0 &&
    x <= edge && x >= edge - BACK_EDGE_WIDTH
}

/**
 * Whether a movement from the right edge is the forward gesture.
 *
 * @param {{ startX: number, width: number, dx: number, dy: number }} gesture
 */
export function isForwardEdgeSwipe ({ startX, width, dx, dy }) {
  if (!startsAtForwardEdge(startX, width)) return false
  return isBackEdgeSwipe({ startX: 0, dx: -(Number(dx) || 0), dy })
}

/** How far in the forward chip is, 0 to 1, for a finger that has travelled dx. */
export function forwardSwipeProgress (dx) {
  return backSwipeProgress(-(Number(dx) || 0))
}

/** Whether a released forward swipe should go forward or spring home. */
export function shouldCompleteForwardSwipe ({ dx, vx }) {
  return shouldCompleteBackSwipe({ dx: -(Number(dx) || 0), vx: -(Number(vx) || 0) })
}
