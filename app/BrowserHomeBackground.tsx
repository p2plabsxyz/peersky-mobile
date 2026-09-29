import type { ReactNode } from 'react'
import { ImageBackground, StyleSheet, View } from 'react-native'

const WALLPAPER = require('../assets/images/wallpaper-ten-lakes.jpg')

/**
 * The home screen's wallpaper, the same one the desktop browser opens on.
 *
 * A photograph behind text is only a good idea with something between them.
 * The scrim is the theme's own background at most of its opacity, so the
 * labels keep the colour they already had and stay readable over the bright
 * part of the picture as well as the dark part.
 */
export function BrowserHomeBackground ({
  children,
  scrim
}: {
  children: ReactNode
  scrim: string
}) {
  return (
    <ImageBackground source={WALLPAPER} resizeMode='cover' style={styles.background}>
      <View style={[styles.scrim, { backgroundColor: scrim }]}>{children}</View>
    </ImageBackground>
  )
}

const styles = StyleSheet.create({
  background: { flex: 1 },
  scrim: { flex: 1 }
})
