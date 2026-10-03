import type { ReactNode } from 'react'
import { useState } from 'react'
import { Image, type LayoutChangeEvent, StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

const WALLPAPER = require('../assets/images/wallpaper-ten-lakes.jpg')

// How far down the shade behind the shortcuts reaches before it is gone: past
// the apps and a row or two of favourites on a phone.
const VEIL_HEIGHT = 460

/**
 * The home screen's wallpaper, the same one the desktop browser opens on, with
 * a shade behind the shortcuts at the top.
 *
 * The whole photo used to sit under a tint, which washed it out. Now only the
 * part behind the shortcuts is shaded, fading out below them, so the labels
 * stay readable and the rest of the picture keeps its colour. The app icons
 * stay as they are: another wallpaper should not mean another icon design.
 *
 * The photo keeps the tallest size the home screen has had at this width and
 * is pinned to the top. When the keyboard comes up and the space above it gets
 * shorter, the photo is cut off at the bottom instead of being scaled again to
 * fit what is left. Turning the phone changes the width and starts over.
 */
export function BrowserHomeBackground ({
  children,
  isDark
}: {
  children: ReactNode
  isDark: boolean
}) {
  // A white shade flattens a photograph in a way a dark one does not, so the
  // light theme's is fainter rather than the same numbers.
  const shade = isDark ? '#09090b' : '#ffffff'
  const strength = isDark ? 0.55 : 0.4

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
      <Svg
        height={VEIL_HEIGHT}
        pointerEvents='none'
        preserveAspectRatio='none'
        style={styles.veil}
        viewBox='0 0 10 100'
        width='100%'
      >
        <Defs>
          <LinearGradient id='home-veil' x1='0' x2='0' y1='0' y2='1'>
            <Stop offset='0' stopColor={shade} stopOpacity={strength} />
            <Stop offset='0.5' stopColor={shade} stopOpacity={strength * 0.55} />
            <Stop offset='1' stopColor={shade} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect fill='url(#home-veil)' height='100' width='10' />
      </Svg>
      <View style={styles.content}>{children}</View>
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
  veil: { left: 0, position: 'absolute', right: 0, top: 0 },
  content: { flex: 1 }
})
