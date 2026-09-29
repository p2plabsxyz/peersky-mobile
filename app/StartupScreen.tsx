import { Image, StyleSheet, View } from 'react-native'

import { BROWSER_PALETTES } from './browser-appearance.mjs'

// The artwork is drawn with black outlines, which vanish against a dark
// screen, so the dark one carries its own white backing.
const BIRD = {
  light: require('../assets/images/logo.png'),
  dark: require('../assets/images/logo-on-dark.png')
}


// 140pt, the same as the launch image draws it on a three times screen, so the
// moment the app takes over nothing moves.
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
      <Image source={isDark ? BIRD.dark : BIRD.light} style={styles.bird} />
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
