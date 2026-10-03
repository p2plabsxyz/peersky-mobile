import type { ReactNode } from 'react'
import { useState } from 'react'
import { Image, type LayoutChangeEvent, StyleSheet, View } from 'react-native'

const WALLPAPER = require('../assets/images/wallpaper-ten-lakes.jpg')

/**
 * The home screen's wallpaper, the same one the desktop browser opens on, with
 * a scrim between the photo and the labels.
 *
 * The photo keeps the tallest size the home screen has had at this width and
 * is pinned to the top. When the keyboard comes up and the space above it gets
 * shorter, the photo is cut off at the bottom instead of being scaled again to
 * fit what is left. Turning the phone changes the width and starts over.
 */
export function BrowserHomeBackground ({
  children,
  scrim
}: {
  children: ReactNode
  scrim: string
}) {
  const [frame, setFrame] = useState<{ height: number, width: number } | null>(null)

  const onLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    setFrame((current) => current && current.width === layout.width && current.height >= layout.height
      ? current
      : { height: layout.height, width: layout.width })
  }

  return (
    <View style={styles.background} onLayout={onLayout}>
      <Image
        source={WALLPAPER}
        resizeMode='cover'
        // Android fades every image in by default, which looked like the
        // wallpaper loading again.
        fadeDuration={0}
        style={[styles.wallpaper, frame ? { height: frame.height } : styles.wallpaperFill]}
      />
      <View style={[styles.scrim, { backgroundColor: scrim }]}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  background: { flex: 1, overflow: 'hidden' },
  // A required image takes its file's size as its default width, so the
  // width has to be given here or the photo draws at 3024 points across.
  wallpaper: { left: 0, position: 'absolute', top: 0, width: '100%' },
  // Until the first layout says how tall the home screen is.
  wallpaperFill: { height: '100%' },
  scrim: { flex: 1 }
})
