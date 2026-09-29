import { useEffect, useRef } from 'react'
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { AppLogo } from './AppLogo'
import { BROWSER_PALETTES } from './browser-appearance.mjs'

// The transparent set, the same artwork each app shows while it starts. The
// home screen keeps the solid icons: those are things to tap, these are things
// happening.
const STARTUP_ICONS = [
  { id: 'peerchat', source: require('../assets/images/loading/peerchat.png') },
  { id: 'peertunes', source: require('../assets/images/loading/peertunes.png') },
  { id: 'p2pmd', source: require('../assets/images/loading/p2pmd.png') },
  { id: 'hyper', source: require('../assets/images/loading/hyperdrive.png') }
]
const STEP_MS = 420
const BADGE_SIZE = 112

/**
 * What the app shows while it is coming up.
 *
 * A spinner and the word Starting tell you nothing you did not already know.
 * The apps that are being started say it instead: each lights up as the wait
 * goes on, so the screen is doing the job a progress bar would.
 */
export function StartupScreen ({ isDark, logoColor }: { isDark: boolean, logoColor: string }) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(progress, {
        duration: STEP_MS * STARTUP_ICONS.length,
        easing: Easing.linear,
        toValue: STARTUP_ICONS.length,
        useNativeDriver: true
      })
    )
    animation.start()

    return () => animation.stop()
  }, [progress])

  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={[styles.screen, { backgroundColor: palette.shell }]}
    >
      {/* The badge is the only thing in the flow here, so it centres on exactly
          the spot the launch image put it. The title hangs off that centre
          rather than pushing the badge up, which is what made the logo jump
          the moment the app took over from the launch image. */}
      <View style={styles.center}>
        <AppLogo color={logoColor} size={BADGE_SIZE} />
        <Text style={[styles.title, { color: palette.text, marginTop: BADGE_SIZE / 2 + 18 }]}>
          PeerSky
        </Text>
      </View>

      <View style={styles.apps}>
        {STARTUP_ICONS.map((app, index) => (
          <Animated.View
            key={app.id}
            style={{
              opacity: progress.interpolate({
                // Dim, bright at its turn, dim again, and the last frame has to
                // land where the first one starts or the loop jumps.
                inputRange: [index - 1, index, index + 1, STARTUP_ICONS.length + index - 1, STARTUP_ICONS.length + index],
                outputRange: [0.25, 1, 0.25, 0.25, 1],
                extrapolate: 'clamp'
              })
            }}
          >
            <Image source={app.source} style={styles.appIcon} />
          </Animated.View>
        ))}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center'
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0.2,
    position: 'absolute',
    top: '50%'
  },
  apps: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 18,
    justifyContent: 'center',
    paddingBottom: 44
  },
  appIcon: { height: 40, width: 40 }
})
