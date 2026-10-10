import { Platform, type PressableAndroidRippleConfig } from 'react-native'

// A press on Android shows as a ripple from the finger, which is what people
// there take to mean the tap was heard. Without one, a button looked dead
// until whatever it opened arrived, and the app felt slow for it. iOS dims the
// pressed control instead.
const RIPPLE_COLOR = 'rgba(120, 132, 156, 0.26)'

// An icon button's ripple is bounded and clipped to the button's round
// shape. A borderless one draws onto a background further up, which these
// views never offer it, so it never showed.
export const ICON_RIPPLE: PressableAndroidRippleConfig | undefined = Platform.OS === 'android'
  ? { color: RIPPLE_COLOR, foreground: true }
  : undefined

export const SMALL_ICON_RIPPLE = ICON_RIPPLE

export const ROUND_PRESS = Platform.OS === 'android'
  ? { borderRadius: 999, overflow: 'hidden' as const }
  : null

export const ROW_RIPPLE: PressableAndroidRippleConfig | undefined = Platform.OS === 'android'
  ? { color: RIPPLE_COLOR, foreground: true }
  : undefined

const DIMMED = { opacity: 0.5 }

/** iOS's dim for a pressed control. Android has its ripple. */
export function dimWhenPressed (pressed: boolean) {
  return pressed && Platform.OS !== 'android' ? DIMMED : null
}
