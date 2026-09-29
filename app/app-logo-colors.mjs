/**
 * The six colours the bird comes in.
 *
 * Sampled from the icon set rather than guessed, so the badge drawn in the app
 * is the same colour as the icon on the home screen. The bird artwork itself
 * never changes; only what sits behind it does.
 */
export const APP_LOGO_COLORS = Object.freeze([
  Object.freeze({ id: 'cyan', title: 'Cyan', background: '#67fce7' }),
  Object.freeze({ id: 'green', title: 'Green', background: '#86efac' }),
  Object.freeze({ id: 'violet', title: 'Violet', background: '#c29de9' }),
  Object.freeze({ id: 'yellow', title: 'Yellow', background: '#fcd34d' }),
  Object.freeze({ id: 'light', title: 'Light', background: '#ffffff' }),
  Object.freeze({ id: 'dark', title: 'Dark', background: '#3f3f46' })
])

export const DEFAULT_APP_LOGO_COLOR = 'cyan'

const BY_ID = new Map(APP_LOGO_COLORS.map((color) => [color.id, color]))

export function normalizeAppLogoColor (value) {
  return BY_ID.has(value) ? value : DEFAULT_APP_LOGO_COLOR
}

export function getAppLogoColor (value) {
  // Never undefined: a missing colour would leave a hole where the logo goes.
  return BY_ID.get(normalizeAppLogoColor(value)) || APP_LOGO_COLORS[0]
}
