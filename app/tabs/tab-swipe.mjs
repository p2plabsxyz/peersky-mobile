// Swiping a tab card away had to be tried two or three times. Two things were
// working against it: the card only claimed the gesture once the finger had
// travelled 10pt horizontally and strictly further across than down, which a
// thumb arc rarely satisfies, and the card let the FlatList take the gesture
// back part way through, so a swipe that had started would die as a scroll.

const MIN_HORIZONTAL_TRAVEL = 6
// How much further across than down the finger has to be moving. Below 1 a
// mostly vertical drag would start a swipe and fight the list.
const HORIZONTAL_DOMINANCE = 1.2

const CLOSE_DISTANCE = 56
const FLICK_DISTANCE = 20
const FLICK_VELOCITY = 0.35

/** Whether a finger movement is a sideways swipe rather than a list scroll. */
export function isHorizontalSwipe ({ dx, dy }) {
  const across = Math.abs(Number(dx) || 0)
  const down = Math.abs(Number(dy) || 0)
  return across > MIN_HORIZONTAL_TRAVEL && across > down * HORIZONTAL_DOMINANCE
}

/** Whether a released swipe should close the tab or spring back. */
export function shouldCloseOnRelease ({ dx, vx }) {
  const across = Math.abs(Number(dx) || 0)
  const speed = Math.abs(Number(vx) || 0)
  return across > CLOSE_DISTANCE || (across > FLICK_DISTANCE && speed > FLICK_VELOCITY)
}
