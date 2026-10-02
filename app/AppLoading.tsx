import { useEffect, useRef } from 'react'
import { Animated, Easing, Image, StyleSheet, View } from 'react-native'

import { BROWSER_PALETTES } from './browser-appearance.mjs'

const LOADING_ICONS = {
  p2pmd: require('../assets/images/loading/p2pmd.png'),
  peerchat: require('../assets/images/loading/peerchat.png'),
  peertunes: require('../assets/images/loading/peertunes.png')
}

const APP_NAMES = {
  p2pmd: 'P2PMD',
  peerchat: 'PeerChat',
  peertunes: 'PeerTunes'
}

export type LoadingApp = keyof typeof LOADING_ICONS

const TRACK_WIDTH = 120
const SEGMENT_WIDTH = 36

/**
 * An app on its way up: its own icon, held still, over a thin bar that moves.
 * The icon says which app without reading; the bar says it is still working.
 */
export function AppLoading ({ app, isDark }: { app: LoadingApp, isDark: boolean }) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  const appear = useRef(new Animated.Value(0)).current
  const sweep = useRef(new Animated.Value(0)).current

  useEffect(() => {
    // Fades in rather than popping up, so a quick start does not flash.
    const fadeIn = Animated.timing(appear, {
      duration: 220,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true
    })
    const loop = Animated.loop(Animated.timing(sweep, {
      duration: 1100,
      easing: Easing.inOut(Easing.cubic),
      toValue: 1,
      useNativeDriver: true
    }))
    fadeIn.start()
    loop.start()

    return () => {
      fadeIn.stop()
      loop.stop()
    }
  }, [appear, sweep])

  return (
    <View
      style={styles.centered}
      accessibilityRole='progressbar'
      accessibilityLabel={`Opening ${APP_NAMES[app]}`}
    >
      <Animated.View style={[styles.content, { opacity: appear }]}>
        <Image source={LOADING_ICONS[app]} style={styles.icon} />
        <View style={[styles.track, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(31, 42, 68, 0.1)' }]}>
          <Animated.View
            style={[
              styles.segment,
              {
                backgroundColor: palette.accent,
                transform: [{
                  translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-SEGMENT_WIDTH, TRACK_WIDTH] })
                }]
              }
            ]}
          />
        </View>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24
  },
  content: { alignItems: 'center', gap: 6 },
  // The artwork leaves a wide margin around the glyph, so the image is sized
  // well past the glyph it shows.
  icon: { height: 136, resizeMode: 'contain', width: 136 },
  segment: {
    borderRadius: 1.5,
    height: 3,
    left: 0,
    position: 'absolute',
    top: 0,
    width: SEGMENT_WIDTH
  },
  track: {
    borderRadius: 1.5,
    height: 3,
    overflow: 'hidden',
    width: TRACK_WIDTH
  }
})
