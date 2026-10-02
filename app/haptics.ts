import * as Haptics from 'expo-haptics'

/**
 * A short tap you can feel.
 *
 * Holding something is a decision the phone should answer to, the way it does
 * everywhere else on iOS and Android. A press that only opens a sheet leaves
 * you unsure whether it registered until the sheet arrives.
 *
 * Nothing here is awaited and nothing throws: a buzz that fails is not worth
 * interrupting what the press was actually for.
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
