import { Image, StyleSheet, View } from 'react-native'

import { BROWSER_PALETTES } from './browser-appearance.mjs'

// The circle, the same mark the app wears on the home screen. The bird on its
// own is drawn with black outlines and needs something behind it in either
// theme, so the badge is that something in both.
const BADGE = require('../assets/images/logo-badge.png')

// 140pt, the imageWidth the launch screen draws the badge at in app.json, so
// the moment the app takes over nothing moves.
const BIRD_SIZE = 140

/**
 * What the app shows while it is coming up.
 *
 * The same picture as the launch image and nothing more: no title, no spinner,
 * no animation. Anything that moves here draws the eye to a wait, and anything
 * the launch image does not also have is a visible change at the handover.
 */
export function StartupScreen ({ isDark }: { isDark: boolean }) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light

  return (
    <View style={[styles.screen, { backgroundColor: palette.shell }]}>
      <Image source={BADGE} style={styles.bird} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center'
  },
  bird: {
    height: BIRD_SIZE,
    resizeMode: 'contain',
    width: BIRD_SIZE
  }
})
