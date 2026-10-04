import { Animated, StyleSheet } from 'react-native'

import BackArrowIcon from '../assets/icons/bootstrap/arrow-left.svg'

const CHIP_SIZE = 44
// Starts just off the edge and slides to its resting place, the way the system
// gesture arrives rather than appearing in position.
const CHIP_TRAVEL = 28

/**
 * The chip that answers an edge swipe. Sliding the page instead left it a
 * quarter screen to the right after an interrupted swipe (the shifted page
 * after typing in the address bar). Nothing under this moves, so nothing can
 * get stuck, and an arrow from the edge is how the gesture looks elsewhere.
 */
export function BrowserBackSwipe ({
  background,
  color,
  progress
}: {
  background: string
  color: string
  progress: Animated.Value
}) {
  return (
    <Animated.View
      // Purely an indicator. Taking touches here would fight the gesture that
      // drives it, since it sits exactly where the finger is.
      pointerEvents='none'
      style={[
        styles.chip,
        {
          backgroundColor: background,
          opacity: progress,
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [-CHIP_TRAVEL, 0]
              })
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.72, 1]
              })
            }
          ]
        }
      ]}
    >
      <BackArrowIcon width={20} height={20} color={color} />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    borderRadius: CHIP_SIZE / 2,
    elevation: 6,
    height: CHIP_SIZE,
    justifyContent: 'center',
    left: 8,
    marginTop: -CHIP_SIZE / 2,
    position: 'absolute',
    shadowColor: '#10131a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    top: '50%',
    width: CHIP_SIZE,
    zIndex: 30
  }
})
