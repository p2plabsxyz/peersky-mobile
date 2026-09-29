import { NativeModules, Platform } from 'react-native'

import { normalizeAppLogoColor } from './app-logo-colors.mjs'

type AppIconModule = {
  getIcon: () => Promise<string | null>
  setIcon: (name: string | null) => Promise<boolean>
}

const nativeAppIcon = NativeModules.PeerSkyAppIcon as AppIconModule | undefined

/**
 * Changing the icon on the home screen.
 *
 * Both systems name their alternate icons, and both refuse quietly when asked
 * for one they do not have, so the answer comes back rather than being thrown:
 * a launcher icon that did not change is not a reason to lose the colour the
 * person picked, which the app uses for its own logo either way.
 */
export async function applyAppIcon (color: string): Promise<boolean> {
  if (!nativeAppIcon || !['android', 'ios'].includes(Platform.OS)) return false

  const name = normalizeAppLogoColor(color)

  try {
    await nativeAppIcon.setIcon(name)
    return true
  } catch (error) {
    console.warn('Unable to change the app icon:', error)
    return false
  }
}

export function canChangeAppIcon () {
  return Boolean(nativeAppIcon) && ['android', 'ios'].includes(Platform.OS)
}
