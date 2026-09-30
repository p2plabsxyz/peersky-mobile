import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'

import { BROWSER_PALETTES } from './browser-appearance.mjs'

const LOADING_ICONS = {
  hyper: require('../assets/images/loading/hyperdrive.png'),
  p2pmd: require('../assets/images/loading/p2pmd.png'),
  peerchat: require('../assets/images/loading/peerchat.png'),
  peertunes: require('../assets/images/loading/peertunes.png')
}

export type LoadingApp = keyof typeof LOADING_ICONS

/**
 * An app on its way up.
 *
 * "Starting PeerChat..." next to a spinner says nothing the person who tapped
 * PeerChat did not already know. Its own icon, breathing, says the same thing
 * and says which app without reading.
 */
export function AppLoading ({
  app,
  isDark,
  message
}: {
  app: LoadingApp
  isDark: boolean
  message?: string
}) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  const pulse = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true
        }),
        Animated.timing(pulse, {
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true
        })
      ])
    )
    animation.start()

    return () => animation.stop()
  }, [pulse])

  return (
    <View style={styles.centered}>
      <Animated.Image
        source={LOADING_ICONS[app]}
        style={[
          styles.icon,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
            transform: [{
              scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] })
            }]
          }
        ]}
      />
      {message ? <Text style={[styles.message, { color: palette.mutedText }]}>{message}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 14,
    justifyContent: 'center',
    padding: 24
  },
  icon: { height: 84, resizeMode: 'contain', width: 84 },
  message: { fontSize: 14, textAlign: 'center' }
})
