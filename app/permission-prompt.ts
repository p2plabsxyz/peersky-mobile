import { Alert, Linking, Platform } from 'react-native'

import { msg, t } from './i18n/i18n.mjs'

// Both systems ask once for the local network and remember the answer. iOS
// keeps it under the app's own entry; Android with the permissions for nearby
// devices. Wi-Fi off looks the same from in here, so both say so. Both are
// English: whatever shows them passes them through tKey().
export const LAN_PERMISSION_TITLE = msg('Nearby devices cannot be found')
export const LAN_PERMISSION_HELP = Platform.OS === 'ios'
  ? msg('PeerSky finds nearby devices over your local network. If that was turned down, switch Local Network back on for PeerSky in Settings. Wi-Fi also has to be on, and both devices on the same network.')
  : msg('PeerSky finds nearby devices over your local network. Check that Wi-Fi is on and that Nearby devices is allowed for PeerSky in Settings, with both devices on the same network.')

/**
 * iOS shows a permission prompt only once, so after a refusal Settings is the
 * only way back, and this offers to open it. Android re-prompts until "don't
 * ask again" and reports that the same way, so one path covers both.
 */
type PermissionAnswer = { granted: boolean, canAskAgain?: boolean }

export function offerPermissionSettings (title: string, message: string) {
  Alert.alert(title, message, [
    { text: t('Not now'), style: 'cancel' },
    { text: t('Open settings'), onPress: () => { void Linking.openSettings() } }
  ])
}

export async function ensurePermission ({
  request,
  title,
  message
}: {
  request: () => Promise<PermissionAnswer>
  title: string
  message: string
}) {
  const permission = await request()
  if (permission.granted) return true
  // Still askable means the person just said no this time, and a dialog on top
  // of their own refusal is nagging. Only a refusal the system will not revisit
  // needs a way out.
  if (permission.canAskAgain === false) offerPermissionSettings(title, message)
  return false
}
