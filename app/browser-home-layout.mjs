// The home screen lays its app shortcuts out four to a row. Each label gets a
// quarter of the grid minus its own padding, which on a 13 mini leaves about
// 73pt, and "Hyperdrive" at a fixed 14pt needs more than that. It wrapped onto
// a second line and left the row uneven, so the type follows the width.

export const BROWSER_SHORTCUTS_PER_ROW = 4
export const BROWSER_HOME_HORIZONTAL_PADDING = 18
export const BROWSER_SHORTCUT_HORIZONTAL_PADDING = 4

// Bold system type runs about this fraction of its point size per character.
// Measured against the real thing rather than guessed: at 12pt in a 72.75pt
// column, "Hyperdriv" fitted and "Hyperdrive" did not, which puts the average
// for this word above 0.606. Rounded up so the estimate errs toward fitting.
export const AVERAGE_BOLD_GLYPH_RATIO = 0.68
const MIN_TITLE_FONT_SIZE = 11
const MAX_TITLE_FONT_SIZE = 14

/** Width a single shortcut label has to itself, in points. */
export function getBrowserShortcutLabelWidth (windowWidth) {
  const gridWidth = Math.max(0, Number(windowWidth) || 0) - BROWSER_HOME_HORIZONTAL_PADDING * 2
  const columnWidth = gridWidth / BROWSER_SHORTCUTS_PER_ROW
  return Math.max(0, columnWidth - BROWSER_SHORTCUT_HORIZONTAL_PADDING * 2)
}

/**
 * Largest size at which the longest shortcut name still fits on one line,
 * clamped so it stays legible on a small phone and does not balloon on a large
 * one.
 *
 * @param {number} windowWidth
 * @param {number} longestTitleLength Characters in the longest shortcut name.
 */
export function getBrowserShortcutTitleFontSize (windowWidth, longestTitleLength = 10) {
  const characters = Math.max(1, Math.round(longestTitleLength) || 1)
  const available = getBrowserShortcutLabelWidth(windowWidth)
  const fits = Math.floor(available / (characters * AVERAGE_BOLD_GLYPH_RATIO))
  return Math.min(MAX_TITLE_FONT_SIZE, Math.max(MIN_TITLE_FONT_SIZE, fits))
}
