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

// How far the page slides while the finger is down. Damped and capped: the
// page underneath is not rendered, so a full-width drag would pull the screen
// off and leave a gap. This is feedback that the gesture took, not a reveal.
export const BACK_SWIPE_MAX_OFFSET = 96
const BACK_SWIPE_DAMPING = 0.45

/** Where the page sits, in points, for a finger that has travelled dx. */
export function backSwipeOffset (dx) {
  const across = Number(dx) || 0
  if (across <= 0) return 0
  return Math.min(BACK_SWIPE_MAX_OFFSET, across * BACK_SWIPE_DAMPING)
}

const COMPLETE_TRAVEL = 64
const FLICK_TRAVEL = 24
const FLICK_VELOCITY = 0.3

/** Whether a released back swipe should go back or spring home. */
export function shouldCompleteBackSwipe ({ dx, vx }) {
  const across = Number(dx) || 0
  const speed = Number(vx) || 0
  return across > COMPLETE_TRAVEL || (across > FLICK_TRAVEL && speed > FLICK_VELOCITY)
}
