import * as Notifications from 'expo-notifications'
import { Linking, Platform } from 'react-native'

const PEERCHAT_SOUND_CHANNEL = 'peerchat-messages-v2'
const PEERCHAT_SILENT_CHANNEL = 'peerchat-messages-silent-v2'

let channelsOpening: Promise<void> | null = null
let permissionAsking: Promise<boolean> | null = null

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true
  })
})

export async function preparePeerChatNotifications () {
  if (Platform.OS !== 'android') return
  if (channelsOpening) return channelsOpening

  channelsOpening = Promise.all([
    Notifications.setNotificationChannelAsync(PEERCHAT_SOUND_CHANNEL, {
      name: 'PeerChat messages',
      description: 'New PeerChat message notifications',
      importance: Notifications.AndroidImportance.HIGH,
      showBadge: true
      // No sound key here on purpose. For an Android channel, omitting it means
      // the system default notification sound, null means silent, and any
      // string is looked up as a bundled sound file. Passing 'default' made it
      // hunt for a file by that name and log a console error on every launch.
    }),
    Notifications.setNotificationChannelAsync(PEERCHAT_SILENT_CHANNEL, {
      name: 'PeerChat messages (silent)',
      description: 'New PeerChat messages without sound',
      importance: Notifications.AndroidImportance.DEFAULT,
      showBadge: true,
      sound: null
    })
  ]).then(() => undefined).catch((error) => {
    channelsOpening = null
    throw error
  })

  return channelsOpening
}

export async function hasPeerChatNotificationPermission () {
  const permission = await Notifications.getPermissionsAsync()
  return permission.granted || (
    Platform.OS === 'ios' &&
    permission.ios != null &&
    [
      Notifications.IosAuthorizationStatus.AUTHORIZED,
      Notifications.IosAuthorizationStatus.PROVISIONAL,
      Notifications.IosAuthorizationStatus.EPHEMERAL
    ].includes(permission.ios.status)
  )
}

// Not allowed yet, and the system will still put up its prompt. Android 13
// and newer report a permission never asked for as denied, so this goes by
// whether it can be asked rather than by that.
export async function canAskForPeerChatNotifications () {
  if (await hasPeerChatNotificationPermission()) return false
  const permission = await Notifications.getPermissionsAsync()
  return permission.canAskAgain !== false
}

// One prompt at a time. Onboarding and the first look at PeerChat can both
// ask at once, and both get the one answer.
export async function requestPeerChatNotificationPermission () {
  if (!permissionAsking) {
    permissionAsking = askForPeerChatNotificationPermission().finally(() => {
      permissionAsking = null
    })
  }
  return permissionAsking
}

async function askForPeerChatNotificationPermission () {
  await preparePeerChatNotifications()
  if (await hasPeerChatNotificationPermission()) return true

  const permission = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true
    }
  })
  // Declining is an answer, not a problem to solve. Nothing is opened here; the
  // screen offers Settings only if the user asks for notifications again and
  // the system has stopped showing its own prompt.
  return permission.granted || (
    Platform.OS === 'ios' &&
    permission.ios != null &&
    [
      Notifications.IosAuthorizationStatus.AUTHORIZED,
      Notifications.IosAuthorizationStatus.PROVISIONAL,
      Notifications.IosAuthorizationStatus.EPHEMERAL
    ].includes(permission.ios.status)
  )
}

// True once the system will no longer ask, so the only way back is Settings.
export async function isPeerChatNotificationBlocked () {
  if (await hasPeerChatNotificationPermission()) return false
  const permission = await Notifications.getPermissionsAsync()
  return permission.canAskAgain === false
}

// iOS 15.4 and newer open the app's own notification page. Everything else
// lands on the app's settings page, which is as close as the platform gets.
export async function openPeerChatNotificationSettings () {
  if (Platform.OS === 'ios') {
    try {
      await Linking.openURL('app-settings:notifications')
      return
    } catch {}
  }
  await Linking.openSettings()
}

export async function presentPeerChatNotification ({
  body,
  roomKey,
  sounds,
  title
}: {
  body: string
  roomKey: string
  sounds: boolean
  title: string
}) {
  await preparePeerChatNotifications()
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { roomKey },
      sound: sounds ? 'default' : false
    },
    trigger: Platform.OS === 'android'
      ? { channelId: sounds ? PEERCHAT_SOUND_CHANNEL : PEERCHAT_SILENT_CHANNEL }
      : null
  })
}

export async function setPeerChatBadgeCount (count: number) {
  return Notifications.setBadgeCountAsync(Math.max(0, Math.trunc(count)))
}

/** The count on the app icon now, as last set, or 0 when it cannot be read. */
export async function getPeerChatBadgeCount () {
  try {
    const count = await Notifications.getBadgeCountAsync()
    return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0
  } catch {
    return 0
  }
}

export function addPeerChatNotificationResponseListener (listener: (roomKey: string) => void) {
  let handledIdentifier = ''
  const handleResponse = (response: Notifications.NotificationResponse | null) => {
    const identifier = response?.notification.request.identifier
    if (!identifier || identifier === handledIdentifier) return
    const roomKey = response?.notification.request.content.data?.roomKey
    if (typeof roomKey !== 'string' || !/^[a-f0-9]{64}$/i.test(roomKey)) return
    handledIdentifier = identifier
    listener(roomKey.toLowerCase())
    Notifications.clearLastNotificationResponse()
  }

  const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse)
  void Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      handleResponse(response)
    })
    .catch(() => {})
  return subscription
}
