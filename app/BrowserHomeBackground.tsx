import type { ReactNode } from 'react'
import { Image, StyleSheet, View } from 'react-native'

const WALLPAPER = require('../assets/images/wallpaper-ten-lakes.jpg')

/**
 * The home screen's wallpaper, the same one the desktop browser opens on, with
 * a scrim between the photo and the labels.
 */
export function BrowserHomeBackground ({
  children,
  scrim
}: {
  children: ReactNode
  scrim: string
}) {
  return (
    <View style={styles.background}>
      <Image
        source={WALLPAPER}
        resizeMode='cover'
        // Android fades every image in by default, which looked like the
        // wallpaper loading again.
        fadeDuration={0}
        style={styles.wallpaper}
      />
      <View style={[styles.scrim, { backgroundColor: scrim }]}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  background: { flex: 1, overflow: 'hidden' },
  // A required image takes its file's size as its default width and height,
  // so both have to be given here or the photo draws at 3024 points across.
  wallpaper: { height: '100%', left: 0, position: 'absolute', top: 0, width: '100%' },
  scrim: { flex: 1 }
})
