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
 *
 * The page itself used to slide instead, which had two problems. A swipe that
 * was interrupted part way left the page slid, so the browser sat a quarter of
 * a screen to the right until something else re-rendered it. And what is behind
 * the page is not drawn, so the movement revealed nothing and only opened a
 * gap. An indicator answers the gesture without moving anything that can get
 * stuck, and it is full by COMPLETE_TRAVEL, so the screen and the release
 * agree about when the swipe has taken.
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
