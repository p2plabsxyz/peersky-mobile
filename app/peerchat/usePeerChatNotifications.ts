import { useCallback, useEffect, useRef, useState } from 'react'
import { File, Paths } from 'expo-file-system'
import { AppState } from 'react-native'

import { RPC_HYPER_REFRESH, RPC_PEERCHAT_ROOMS } from '../../backend/rpc/commands.mjs'
import {
  collectPeerChatNotificationCandidates,
  DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES,
  parsePeerChatNotificationPreferences,
  PEERCHAT_NOTIFICATION_PREFERENCES_MAX_BYTES,
  serializePeerChatNotificationPreferences,
  shouldAskForPeerChatNotifications,
  shouldEnablePeerChatBackground,
  shouldHandlePeerChatNotificationInApp
} from './notification-state.mjs'
import {
  canAskForPeerChatNotifications,
  hasPeerChatNotificationPermission,
  addPeerChatNotificationResponseListener,
  getPeerChatBadgeCount,
  presentPeerChatNotification,
  preparePeerChatNotifications,
  requestPeerChatNotificationPermission,
  setPeerChatBadgeCount
} from './notifications'
import { playPeerChatSound } from './sounds'
import { addPeerChatBackgroundTickListener, setPeerChatBackgroundEnabled } from './background-service'

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
  unreadTotal?: number
}

type NotificationPreferences = {
  notifications: boolean
  sounds: boolean
}

const POLL_INTERVAL_MS = 5000
// A network change in the background leaves a stale swarm announce behind, and
// until this the only refresh was on the app coming back to the foreground. On
// a phone left alone overnight that is the difference between reachable and not.
const BACKGROUND_REFRESH_INTERVAL_MS = 15 * 60 * 1000
const PREFERENCES_FILE = new File(Paths.document, 'peerchat-notifications.json')
const RECEIVE_SOUND = require('../../assets/sounds/peerchat/receive.mp3')

export function usePeerChatNotifications ({
  isPeerChatVisible,
  isRuntimeReady,
  onOpenRoom,
  onCallRpc
}: {
  isPeerChatVisible: boolean
  isRuntimeReady: boolean
  onOpenRoom: (roomKey: string) => void
  onCallRpc: (command: number, data?: object) => Promise<NotificationRpcResponse>
}) {
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    ...DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES
  })
  const [isReady, setIsReady] = useState(false)
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [roomCount, setRoomCount] = useState(0)
  const callRpcRef = useRef(onCallRpc)
  const openRoomRef = useRef(onOpenRoom)
  const isPeerChatVisibleRef = useRef(isPeerChatVisible)
  const preferencesRef = useRef(preferences)
  const previousRoomsRef = useRef<NotificationRoom[] | null>(null)
  const pollInFlightRef = useRef(false)
  const warnedRef = useRef(false)
  const badgeCountRef = useRef(-1)
  const badgeWarningRef = useRef(false)

  callRpcRef.current = onCallRpc
  openRoomRef.current = onOpenRoom
  isPeerChatVisibleRef.current = isPeerChatVisible
  preferencesRef.current = preferences

  useEffect(() => {
    const subscription = addPeerChatNotificationResponseListener((roomKey) => openRoomRef.current(roomKey))
    return () => subscription.remove()
  }, [])

  // The app icon still holds the last count, and the messages it counts are
  // still unread until their room is opened. Show it on the PeerChat shortcut
  // from the start, rather than nothing until the first check comes back.
  useEffect(() => {
    let cancelled = false
    void getPeerChatBadgeCount().then((count) => {
      if (!cancelled && badgeCountRef.current === -1 && count > 0) setUnreadTotal(count)
    })
    return () => { cancelled = true }
  }, [])

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
    if (enabled && !await requestPeerChatNotificationPermission()) {
      const deniedPreferences = { ...preferencesRef.current, notifications: false }
      if (persistPreferences(deniedPreferences)) {
        preferencesRef.current = deniedPreferences
        setPreferences(deniedPreferences)
      }
      return false
    }
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

  // Asked once, the first time PeerChat is open with chats in it, when the
  // system has never been asked: a profile from Link Device or a restore
  // never went through onboarding, where this is asked.
  const notificationsAskedRef = useRef(false)
  useEffect(() => {
    if (!shouldAskForPeerChatNotifications({
      asked: notificationsAskedRef.current,
      isPeerChatVisible,
      isReady,
      isRuntimeReady,
      notificationsEnabled: preferences.notifications,
      roomCount
    })) return
    notificationsAskedRef.current = true
    void canAskForPeerChatNotifications()
      .then((canAsk) => (canAsk ? setNotificationsEnabled(true) : undefined))
      .catch((error) => console.warn('Unable to ask about PeerChat notifications:', error))
  }, [isPeerChatVisible, isReady, isRuntimeReady, preferences.notifications, roomCount, setNotificationsEnabled])

  useEffect(() => {
    if (!isReady) return
    void setPeerChatBackgroundEnabled(shouldEnablePeerChatBackground({
      isRuntimeReady,
      notificationsEnabled: preferences.notifications,
      roomCount
    })).catch((error) => {
      console.warn('Unable to update PeerChat background service:', error)
    })
  }, [isReady, isRuntimeReady, preferences.notifications, roomCount])

  // While the runtime is starting, or restarting, nothing is known about the
  // rooms. The count on the app icon and the shortcut is left as it was: the
  // messages are still unread. Zeroing it here blanked the icon every time
  // PeerSky opened, and it stayed blank if you left before the first check.
  useEffect(() => {
    if (!isReady || isRuntimeReady) return
    previousRoomsRef.current = null
    badgeCountRef.current = -1
  }, [isReady, isRuntimeReady])

  useEffect(() => {
    if (!isReady || !isRuntimeReady) {
      previousRoomsRef.current = null
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      if (cancelled || pollInFlightRef.current) return
      if (AppState.currentState !== 'active' && !preferencesRef.current.notifications) return
      pollInFlightRef.current = true
      try {
        const response = await callRpcRef.current(RPC_PEERCHAT_ROOMS, {})
        if (!response.ok) throw new Error(response.error || 'Unable to check PeerChat messages.')
        if (cancelled) return

        const nextRooms = Array.isArray(response.rooms) ? response.rooms : []
        setRoomCount(nextRooms.length)
        const nextUnreadTotal = normalizeUnreadTotal(response.unreadTotal, nextRooms)
        setUnreadTotal(nextUnreadTotal)
        if (badgeCountRef.current !== nextUnreadTotal) {
          badgeCountRef.current = nextUnreadTotal
          try {
            await setPeerChatBadgeCount(nextUnreadTotal)
            badgeWarningRef.current = false
          } catch (error) {
            if (!badgeWarningRef.current) {
              badgeWarningRef.current = true
              console.warn('Unable to update PeerChat badge:', error)
            }
          }
        }
        const previousRooms = previousRoomsRef.current
        previousRoomsRef.current = nextRooms
        warnedRef.current = false
        if (!previousRooms) return
        const candidates = collectPeerChatNotificationCandidates(previousRooms, nextRooms)
        if (candidates.length === 0) return
        if (shouldHandlePeerChatNotificationInApp(
          isPeerChatVisibleRef.current,
          AppState.currentState
        )) {
          if (preferencesRef.current.sounds) playPeerChatSound('receive', RECEIVE_SOUND)
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
    let lastBackgroundRefresh = Date.now()
    const backgroundTickSubscription = addPeerChatBackgroundTickListener(() => {
      if (!preferencesRef.current.notifications) return
      void poll()

      if (AppState.currentState === 'active') return
      const now = Date.now()
      if (now - lastBackgroundRefresh < BACKGROUND_REFRESH_INTERVAL_MS) return
      lastBackgroundRefresh = now
      void callRpcRef.current(RPC_HYPER_REFRESH, {}).catch((error) => {
        console.warn('Unable to refresh Hyper networking in the background:', error)
      })
    })

    void preparePeerChatNotifications().catch((error) => {
      console.warn('Unable to prepare PeerChat notifications:', error)
    })
    void poll().finally(schedule)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      subscription.remove()
      backgroundTickSubscription.remove()
    }
  }, [isReady, isRuntimeReady])

  return {
    isReady,
    notificationsEnabled: preferences.notifications,
    setNotificationsEnabled,
    setSoundsEnabled,
    soundsEnabled: preferences.sounds,
    unreadTotal
  }
}

function normalizeUnreadTotal (value: unknown, rooms: NotificationRoom[]) {
  if (Number.isSafeInteger(value) && Number(value) >= 0) return Math.min(Number(value), 9999)
  return Math.min(9999, rooms.reduce((total, room) => {
    const unread = Number.isSafeInteger(room.unreadCount) && Number(room.unreadCount) > 0
      ? Number(room.unreadCount)
      : 0
    return total + unread
  }, 0))
}
