import { Image, StyleSheet, View } from 'react-native'

import { getAppLogoColor } from './app-logo-colors.mjs'

const BIRD = require('../assets/images/logo.png')

/**
 * The bird in its circle, drawn rather than shipped as a picture.
 *
 * There is one bird and six backgrounds, so drawing the circle here means one
 * image in the bundle instead of six, and the colour can change the moment it
 * is picked rather than on the next launch.
 */
export function AppLogo ({ color, size = 96 }: { color: string, size?: number }) {
  const { background } = getAppLogoColor(color)

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: background,
          borderRadius: size / 2,
          borderWidth: Math.max(2, Math.round(size * 0.035)),
          height: size,
          width: size
        }
      ]}
    >
      <Image source={BIRD} style={{ height: size * 0.76, width: size * 0.76 }} />
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderColor: '#141414',
    justifyContent: 'center',
    overflow: 'hidden'
  }
})
