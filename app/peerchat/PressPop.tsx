import { useRef } from 'react'
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle
} from 'react-native'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

// Read once and kept current: every message on screen would ask, so one
// listener for the app rather than one each.
let reduceMotion = false
void AccessibilityInfo.isReduceMotionEnabled()
  .then((enabled) => { reduceMotion = enabled })
  .catch(() => {})
AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => { reduceMotion = enabled })

type PressPopProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>
}

/**
 * A message bubble that swells a little when it is held, the way chat apps
 * show that a long press took, and settles back as its menu opens. The bubble
 * itself scales, so its layout is what it always was. Still with Reduce Motion
 * on.
 */
export function PressPop ({ onLongPress, style, ...props }: PressPopProps) {
  const scale = useRef(new Animated.Value(1)).current

  function pop (event: GestureResponderEvent) {
    if (!reduceMotion) {
      scale.stopAnimation()
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.05, speed: 40, bounciness: 10, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, speed: 24, bounciness: 8, useNativeDriver: true })
      ]).start()
    }
    onLongPress?.(event)
  }

  return (
    <AnimatedPressable
      {...props}
      onLongPress={onLongPress ? pop : undefined}
      style={[style, { transform: [{ scale }] }]}
    />
  )
}
