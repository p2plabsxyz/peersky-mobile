import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioPlayer } from 'expo-audio'
import { File, Paths } from 'expo-file-system'
import { AppState } from 'react-native'

import { RPC_PEERCHAT_ROOMS } from '../../backend/rpc/commands.mjs'
import {
  collectPeerChatNotificationCandidates,
  DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES,
  parsePeerChatNotificationPreferences,
  PEERCHAT_NOTIFICATION_PREFERENCES_MAX_BYTES,
  serializePeerChatNotificationPreferences
} from './notification-state.mjs'
import {
  hasPeerChatNotificationPermission,
  presentPeerChatNotification,
  preparePeerChatNotifications,
  requestPeerChatNotificationPermission
} from './notifications'

type NotificationRoom = {
  roomKey: string
  name?: string
  isMuted?: boolean
  unreadCount?: number
  lastMessage?: {
    sender?: string
    senderName?: string
    message?: string
    timestamp?: number
  } | null
}

type NotificationRpcResponse = {
  ok: boolean
  error?: string
  rooms?: NotificationRoom[]
}

type NotificationPreferences = {
  notifications: boolean
  sounds: boolean
}

const POLL_INTERVAL_MS = 5000
const PREFERENCES_FILE = new File(Paths.document, 'peerchat-notifications.json')

export function usePeerChatNotifications ({
  isPeerChatVisible,
  isRuntimeReady,
  onCallRpc
}: {
  isPeerChatVisible: boolean
  isRuntimeReady: boolean
  onCallRpc: (command: number, data?: object) => Promise<NotificationRpcResponse>
}) {
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    ...DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES
  })
  const [isReady, setIsReady] = useState(false)
  const callRpcRef = useRef(onCallRpc)
  const isPeerChatVisibleRef = useRef(isPeerChatVisible)
  const preferencesRef = useRef(preferences)
  const previousRoomsRef = useRef<NotificationRoom[] | null>(null)
  const pollInFlightRef = useRef(false)
  const warnedRef = useRef(false)
  const receiveSoundPlayer = useAudioPlayer(require('../../assets/sounds/peerchat/receive.mp3'))

  callRpcRef.current = onCallRpc
  isPeerChatVisibleRef.current = isPeerChatVisible
  preferencesRef.current = preferences
  const shouldPoll = preferences.notifications || (isPeerChatVisible && preferences.sounds)

  useEffect(() => {
    try {
      if (PREFERENCES_FILE.exists &&
          PREFERENCES_FILE.size != null &&
          PREFERENCES_FILE.size <= PEERCHAT_NOTIFICATION_PREFERENCES_MAX_BYTES) {
        setPreferences(parsePeerChatNotificationPreferences(PREFERENCES_FILE.textSync()))
      }
    } catch (error) {
      console.warn('Unable to load PeerChat notification preferences:', error)
    } finally {
      setIsReady(true)
    }
  }, [])

  const persistPreferences = useCallback((nextPreferences: NotificationPreferences) => {
    try {
      if (!PREFERENCES_FILE.exists) PREFERENCES_FILE.create({ intermediates: true })
      PREFERENCES_FILE.write(serializePeerChatNotificationPreferences(nextPreferences))
      return true
    } catch (error) {
      console.warn('Unable to save PeerChat notification preferences:', error)
      return false
    }
  }, [])

  const setNotificationsEnabled = useCallback(async (enabled: boolean) => {
    if (enabled && !await requestPeerChatNotificationPermission()) return false
    const nextPreferences = { ...preferencesRef.current, notifications: enabled }
    if (!persistPreferences(nextPreferences)) return false
    preferencesRef.current = nextPreferences
    setPreferences(nextPreferences)
    return true
  }, [persistPreferences])

  const setSoundsEnabled = useCallback((enabled: boolean) => {
    const nextPreferences = { ...preferencesRef.current, sounds: enabled }
    if (!persistPreferences(nextPreferences)) return false
    preferencesRef.current = nextPreferences
    setPreferences(nextPreferences)
    return true
  }, [persistPreferences])

  useEffect(() => {
    if (!isReady || !isRuntimeReady || !shouldPoll) {
      previousRoomsRef.current = null
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      if (cancelled || pollInFlightRef.current || AppState.currentState !== 'active') return
      pollInFlightRef.current = true
      try {
        const response = await callRpcRef.current(RPC_PEERCHAT_ROOMS, {})
        if (!response.ok) throw new Error(response.error || 'Unable to check PeerChat messages.')
        if (cancelled) return

        const nextRooms = Array.isArray(response.rooms) ? response.rooms : []
        const previousRooms = previousRoomsRef.current
        previousRoomsRef.current = nextRooms
        warnedRef.current = false
        if (!previousRooms) return
        const candidates = collectPeerChatNotificationCandidates(previousRooms, nextRooms)
        if (candidates.length === 0) return
        if (isPeerChatVisibleRef.current) {
          if (preferencesRef.current.sounds) {
            await receiveSoundPlayer.seekTo(0)
            receiveSoundPlayer.play()
          }
          return
        }
        if (!preferencesRef.current.notifications || !await hasPeerChatNotificationPermission()) return

        for (const candidate of candidates) {
          if (cancelled) return
          await presentPeerChatNotification({
            ...candidate,
            sounds: preferencesRef.current.sounds
          })
        }
      } catch (error) {
        if (!cancelled && !warnedRef.current) {
          warnedRef.current = true
          console.warn('Unable to check PeerChat notifications:', error)
        }
      } finally {
        pollInFlightRef.current = false
      }
    }

    const schedule = () => {
      if (!cancelled) timer = setTimeout(async () => {
        await poll()
        schedule()
      }, POLL_INTERVAL_MS)
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void poll()
    })

    void preparePeerChatNotifications().catch((error) => {
      console.warn('Unable to prepare PeerChat notifications:', error)
    })
    void poll().finally(schedule)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      subscription.remove()
    }
  }, [isReady, isRuntimeReady, receiveSoundPlayer, shouldPoll])

  return {
    isReady,
    notificationsEnabled: preferences.notifications,
    setNotificationsEnabled,
    setSoundsEnabled,
    soundsEnabled: preferences.sounds
  }
}
