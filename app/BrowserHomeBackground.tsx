import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { Animated, Easing, ImageBackground, StyleSheet } from 'react-native'

const WALLPAPER = require('../assets/images/wallpaper-ten-lakes.jpg')

/**
 * The home screen's wallpaper, the same one the desktop browser opens on.
 *
 * A photograph behind text is only a good idea with something between them.
 * The scrim is the theme's own background at most of its opacity, so the
 * labels keep the colour they already had and stay readable over the bright
 * part of the picture as well as the dark part.
 *
 * It fades in on the way here. Arriving home is usually the end of something,
 * closing a tab or burning the lot, and cutting straight to a photograph makes
 * that land hard. Opacity only, so nothing shifts or shows an edge.
 */
export function BrowserHomeBackground ({
  bleed,
  children,
  scrim
}: {
  // The page around this steps in around the notch, which in landscape left a
  // band of shell down each side of the photograph. The wallpaper reaches the
  // glass; the shortcuts on top of it keep the inset.
  bleed: { left: number, right: number }
  children: ReactNode
  scrim: string
}) {
  const enter = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const animation = Animated.timing(enter, {
      duration: 220,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true
    })
    animation.start()

    return () => animation.stop()
  }, [enter])

  return (
    <Animated.View
      style={[
        styles.background,
        { marginLeft: -bleed.left, marginRight: -bleed.right, opacity: enter }
      ]}
    >
      <ImageBackground source={WALLPAPER} resizeMode='cover' style={styles.background}>
        <Animated.View style={[styles.scrim, { backgroundColor: scrim }]}>{children}</Animated.View>
      </ImageBackground>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  background: { flex: 1 },
  scrim: { flex: 1 }
})
