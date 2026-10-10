import { useEffect, useRef } from 'react'
import { Animated, StyleSheet } from 'react-native'

/**
 * A thin line along the address bar's edge that fills as the page loads, as
 * other browsers draw. A spinner in place of reload said that a page was
 * loading but not how far along, so every load seemed as slow as the last.
 */
export function BrowserLoadProgress ({
  color,
  edge,
  isLoading,
  progress
}: {
  color: string
  // Which edge of the bar it runs along: the one facing the page.
  edge: 'top' | 'bottom'
  isLoading: boolean
  // From 0 to 1, as the page reports it.
  progress: Animated.Value
}) {
  const opacity = useRef(new Animated.Value(isLoading ? 1 : 0)).current

  useEffect(() => {
    if (isLoading) {
      opacity.stopAnimation()
      opacity.setValue(1)
      return
    }
    // Filled to the end, then gone, ready for the next page. Width is not
    // something the native driver animates, and a scale anchored at the left
    // was not anchored on Android, so this runs in JavaScript: a few small
    // steps per page.
    const finish = Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: 120, useNativeDriver: false }),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: false })
    ])
    let running = true
    finish.start(({ finished }) => {
      running = false
      if (finished) progress.setValue(0)
    })
    // Stopping a timing stops whatever its value is doing, so a finished
    // sequence stopped here killed the next page's first step, and the line
    // stayed empty until the server answered.
    return () => {
      if (running) finish.stop()
    }
  }, [isLoading, opacity, progress])

  return (
    <Animated.View
      pointerEvents='none'
      style={[
        styles.bar,
        edge === 'top' ? styles.top : styles.bottom,
        {
          backgroundColor: color,
          opacity,
          width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
        }
      ]}
    />
  )
}

const styles = StyleSheet.create({
  bar: {
    height: 2.5,
    left: 0,
    position: 'absolute'
  },
  top: { top: 0 },
  bottom: { bottom: 0 }
})
