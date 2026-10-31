import { useEffect, useRef, useSyncExternalStore } from 'react'

import { shouldAskForPeerChatNotifications } from './notification-state.mjs'
import {
  addPeerChatNotificationResponseListener,
  canAskForPeerChatNotifications
} from './notifications'
import {
  getPeerChatNotifierState,
  setPeerChatNotificationsEnabled,
  setPeerChatNotifierVisible,
  setPeerChatSoundsEnabled,
  subscribePeerChatNotifier
} from './notifier'

const setNotificationsEnabled = setPeerChatNotificationsEnabled

// What the screen shows of PeerChat's notifications, and its switches. The
// looking for new messages goes on in notifier.ts, with the screen or
// without it.
export function usePeerChatNotifications ({
  isPeerChatVisible,
  isRuntimeReady,
  onOpenRoom
}: {
  isPeerChatVisible: boolean
  isRuntimeReady: boolean
  onOpenRoom: (roomKey: string) => void
}) {
  const state = useSyncExternalStore(subscribePeerChatNotifier, getPeerChatNotifierState)
  const openRoomRef = useRef(onOpenRoom)
  openRoomRef.current = onOpenRoom

  useEffect(() => {
    const subscription = addPeerChatNotificationResponseListener((roomKey) => openRoomRef.current(roomKey))
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    setPeerChatNotifierVisible(isPeerChatVisible)
  }, [isPeerChatVisible])

  // Asked once, the first time PeerChat is open with chats in it, when the
  // system has never been asked: a profile from Link Device or a restore
  // never went through onboarding, where this is asked.
  const notificationsAskedRef = useRef(false)
  const notificationsEnabled = state.preferences.notifications
  useEffect(() => {
    if (!shouldAskForPeerChatNotifications({
      asked: notificationsAskedRef.current,
      isPeerChatVisible,
      isReady: state.isReady,
      isRuntimeReady,
      notificationsEnabled,
      roomCount: state.roomCount
    })) return
    notificationsAskedRef.current = true
    void canAskForPeerChatNotifications()
      .then((canAsk) => (canAsk ? setNotificationsEnabled(true) : undefined))
      .catch((error) => console.warn('Unable to ask about PeerChat notifications:', error))
  }, [isPeerChatVisible, state.isReady, isRuntimeReady, notificationsEnabled, state.roomCount])

  return {
    isReady: state.isReady,
    notificationsEnabled,
    setNotificationsEnabled,
    setSoundsEnabled: setPeerChatSoundsEnabled,
    soundsEnabled: state.preferences.sounds,
    unreadTotal: state.unreadTotal
  }
}
