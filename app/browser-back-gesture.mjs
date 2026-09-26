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
