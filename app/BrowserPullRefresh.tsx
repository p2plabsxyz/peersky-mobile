import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native'

import { PULL_REFRESH_MAX, PULL_REFRESH_TRIGGER, pullRefreshOffset } from './browser-pull-refresh.mjs'
import ReloadIcon from '../assets/icons/bootstrap/arrow-clockwise.svg'

const SIZE = 40
// Where the arrow turns solid: letting go from here reloads.
const ARMED = pullRefreshOffset(PULL_REFRESH_TRIGGER)

/**
 * Android's pull to refresh, drawn over the top of the page: a round card that
 * comes down with the finger, its arrow turning as it goes, and the system
 * spinner in it while the page reloads. iOS has its own in the WebView.
 */
export function BrowserPullRefresh ({
  background,
  color,
  offset,
  refreshing
}: {
  background: string
  color: string
  // How far down the card is, 0 (out of sight) to PULL_REFRESH_MAX.
  offset: Animated.Value
  refreshing: boolean
}) {
  return (
    <Animated.View
      pointerEvents='none'
      style={[styles.wrap, {
        opacity: offset.interpolate({ inputRange: [0, 20, PULL_REFRESH_MAX], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
        transform: [{
          translateY: offset.interpolate({
            inputRange: [0, PULL_REFRESH_MAX],
            outputRange: [-SIZE - 8, PULL_REFRESH_MAX - SIZE - 8],
            extrapolate: 'clamp'
          })
        }]
      }]}
    >
      <View style={[styles.card, { backgroundColor: background }]}>
        {refreshing
          ? <ActivityIndicator color={color} size='small' />
          : (
            <Animated.View style={{
              opacity: offset.interpolate({ inputRange: [0, ARMED - 1, ARMED], outputRange: [0.45, 0.6, 1], extrapolate: 'clamp' }),
              transform: [{ rotate: offset.interpolate({ inputRange: [0, PULL_REFRESH_MAX], outputRange: ['-90deg', '270deg'], extrapolate: 'clamp' }) }]
            }}
            >
              <ReloadIcon width={20} height={20} color={color} />
            </Animated.View>
            )}
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 25
  },
  card: {
    alignItems: 'center',
    borderRadius: SIZE / 2,
    elevation: 6,
    height: SIZE,
    justifyContent: 'center',
    width: SIZE
  }
})
