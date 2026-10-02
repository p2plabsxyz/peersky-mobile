import * as Haptics from 'expo-haptics'

/**
 * A short tap you can feel, so a long press answers at once, as it does
 * elsewhere on iOS and Android, not only when its sheet arrives. Nothing here
 * is awaited or throws: a failed buzz must not interrupt the press.
 */
export type HapticWeight = 'light' | 'medium' | 'heavy'

const STYLES: Record<HapticWeight, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy
}

/** A press landed: a long press, or a drag passing a step. */
export function tapFeedback (weight: HapticWeight = 'light') {
  void Haptics.impactAsync(STYLES[weight] ?? STYLES.light).catch(() => {})
}
