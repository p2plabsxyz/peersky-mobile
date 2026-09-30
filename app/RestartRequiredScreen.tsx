import { Image, Platform, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BROWSER_PALETTES } from './browser-appearance.mjs'

const PEERSKY_ICON = require('../assets/images/logo.png')

// Shown once a restore or a removal is in place, until PeerSky is started
// again. What is on screen still belongs to the data that was replaced, and
// letting it carry on would write that old state back over the new one.
// Neither platform lets an app restart itself, so this says how.
export function RestartRequiredScreen ({ isDark }: { isDark: boolean }) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  const how = Platform.OS === 'ios'
    ? 'Swipe up from the bottom and hold to see your apps, swipe PeerSky away, then open it again.'
    : 'Close PeerSky from your recent apps, then open it again.'

  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={[styles.screen, { backgroundColor: palette.shell }]}
    >
      <View style={styles.content}>
        <Image source={PEERSKY_ICON} style={styles.logo} />
        <Text accessibilityRole='header' style={[styles.title, { color: palette.text }]}>
          Close PeerSky to finish
        </Text>
        <Text style={[styles.body, { color: palette.mutedText }]}>
          Everything is in place. PeerSky needs a fresh start to pick it up.
        </Text>
        <Text style={[styles.body, { color: palette.mutedText }]}>{how}</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    paddingHorizontal: 32
  },
  logo: { height: 76, marginBottom: 8, width: 76 },
  title: {
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center'
  },
  body: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center'
  }
})
