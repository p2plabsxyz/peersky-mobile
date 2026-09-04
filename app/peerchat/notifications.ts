import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

const PEERCHAT_SOUND_CHANNEL = 'peerchat-messages'
const PEERCHAT_SILENT_CHANNEL = 'peerchat-messages-silent'

let channelsOpening: Promise<void> | null = null

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
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
      showBadge: true,
      sound: 'default'
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

export async function requestPeerChatNotificationPermission () {
  await preparePeerChatNotifications()
  if (await hasPeerChatNotificationPermission()) return true

  const permission = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true
    }
  })
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
