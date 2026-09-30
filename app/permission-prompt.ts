import { Alert, Linking } from 'react-native'

/**
 * Ask again, or offer the way back.
 *
 * iOS shows a permission prompt once. After a refusal the system never shows
 * it again, so an app that only says "access is needed" leaves somebody who
 * tapped Don't Allow by accident with nowhere to go. Settings is the only way
 * back, and this offers to open it rather than expecting them to find it.
 *
 * Android re-prompts until "don't ask again", and reports that the same way,
 * so one path covers both.
 */
type PermissionAnswer = { granted: boolean, canAskAgain?: boolean }

export function offerPermissionSettings (title: string, message: string) {
  Alert.alert(title, message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open settings', onPress: () => { void Linking.openSettings() } }
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
