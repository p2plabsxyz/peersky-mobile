import { Image, StyleSheet, View } from 'react-native'

import { BROWSER_PALETTES } from './browser-appearance.mjs'

// The bird on its own, the same picture the launch screen draws.
const BIRD = require('../assets/images/logo.png')

// 200pt, the imageWidth the launch screen draws it at in app.json, so the
// moment the app takes over nothing moves. Android crops its launch picture to
// a circle in the middle of the image, and at this size the bird still clears it.
const BIRD_SIZE = 200

// The bird is drawn with black outlines, which disappear on near black. A
// dark grey keeps them, and the launch screen uses the same one.
export const STARTUP_DARK_BACKGROUND = '#52525b'

/**
 * What the app shows while it is coming up.
 *
 * The same picture as the launch image and nothing more: no title, no spinner,
 * no animation. Anything that moves here draws the eye to a wait, and anything
 * the launch image does not also have is a visible change at the handover.
 */
export function StartupScreen ({ isDark }: { isDark: boolean }) {
  const backgroundColor = isDark ? STARTUP_DARK_BACKGROUND : BROWSER_PALETTES.light.shell

  return (
    <View style={[styles.screen, { backgroundColor }]}>
      <Image source={BIRD} style={styles.bird} />
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
