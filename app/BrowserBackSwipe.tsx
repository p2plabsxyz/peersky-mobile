import { Animated, StyleSheet } from 'react-native'

import BackArrowIcon from '../assets/icons/bootstrap/arrow-left.svg'

const CHIP_SIZE = 44
// Starts just off the edge and slides to its resting place, the way the system
// gesture arrives rather than appearing in position.
const CHIP_TRAVEL = 28

/**
 * The chip that answers an edge swipe.
 *
 * The page used to slide with the finger. A swipe interrupted before it landed
 * never got the offset back, so the browser sat a quarter of a screen to the
 * right afterwards, which is what showed up as a shifted page after typing in
 * the address bar. Nothing underneath this moves, so there is no offset left to
 * get stuck, and an arrow coming in from the edge is what the gesture looks
 * like everywhere else on the phone.
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
