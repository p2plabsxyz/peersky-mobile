import { File, Paths } from 'expo-file-system'
import { AppState } from 'react-native'

import { RPC_HYPER_REFRESH, RPC_PEERCHAT_ROOMS } from '../../backend/rpc/commands.mjs'
import {
  collectPeerChatNotificationCandidates,
  collectSeenPeerChatNotifications,
  DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES,
  parsePeerChatNotificationPreferences,
  PEERCHAT_NOTIFICATION_PREFERENCES_MAX_BYTES,
  serializePeerChatNotificationPreferences,
  shouldClearSeenPeerChatNotifications,
  shouldEnablePeerChatBackground,
  shouldHandlePeerChatNotificationInApp
} from './notification-state.mjs'
import {
  dismissPeerChatNotifications,
  getPeerChatBadgeCount,
  getPresentedPeerChatNotifications,
  hasPeerChatNotificationPermission,
  presentPeerChatNotification,
  preparePeerChatNotifications,
  requestPeerChatNotificationPermission,
  setPeerChatBadgeCount
} from './notifications'
import { playPeerChatSound } from './sounds'
import {
  addPeerChatBackgroundTickListener,
  setPeerChatBackgroundEnabled,
  setPeerChatBackgroundStatus
} from './background-service'

// Looks for new PeerChat messages and shows them. It lives here, beside the
// backend (app/backend.ts), rather than in the screen, so it goes on without
// one: Android runs PeerSky with no screen when its PeerChat service brings it
// back after the system stopped it, a reboot or an update, and after PeerSky
// is swiped away from Recents. The screen reads what it knows through
// usePeerChatNotifications.

type NotificationRoom = {
  roomKey: string
  name?: string
  isMuted?: boolean
  unreadCount?: number
  unreadMentions?: number
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

type CallRpc = (command: number, data?: object) => Promise<NotificationRpcResponse>

export type PeerChatNotificationPreferences = {
  notifications: boolean
  sounds: boolean
}

export type PeerChatNotifierState = {
  isReady: boolean
  preferences: PeerChatNotificationPreferences
  unreadTotal: number
  roomCount: number
}

const POLL_INTERVAL_MS = 5000
// A network change in the background leaves a stale swarm announce behind, and
// until this the only refresh was on the app coming back to the foreground. On
// a phone left alone overnight that is the difference between reachable and not.
const BACKGROUND_REFRESH_INTERVAL_MS = 15 * 60 * 1000
const PREFERENCES_FILE = new File(Paths.document, 'peerchat-notifications.json')
const RECEIVE_SOUND = require('../../assets/sounds/peerchat/receive.mp3')

let state: PeerChatNotifierState = {
  isReady: false,
  preferences: { ...DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES },
  unreadTotal: 0,
  roomCount: 0
}
const subscribers = new Set<() => void>()
let isPeerChatVisible = false

// The checking, while the backend runs.
type Checker = {
  callRpc: CallRpc
  cancelled: boolean
  timer: ReturnType<typeof setTimeout> | null
  stop: () => void
}
let checker: Checker | null = null
let previousRooms: NotificationRoom[] | null = null
let pollInFlight = false
// Asked for while a check was under way: one more goes once it is done, so a
// message that landed meanwhile is not left for the next tick.
let pollAgain = false
let warned = false
let badgeCount = -1
let badgeWarning = false
// What the PeerChat service was last told: run or not, and connected.
let backgroundWanted: boolean | null = null
let reportedConnected = false

function setState (next: Partial<PeerChatNotifierState>) {
  state = { ...state, ...next }
  for (const subscriber of subscribers) subscriber()
}

export function getPeerChatNotifierState () {
  loadPreferences()
  return state
}

export function subscribePeerChatNotifier (subscriber: () => void) {
  subscribers.add(subscriber)
  return () => { subscribers.delete(subscriber) }
}

// Read once, the first time anything asks.
function loadPreferences () {
  if (state.isReady) return
  let preferences: PeerChatNotificationPreferences = { ...DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES }
  try {
    if (PREFERENCES_FILE.exists &&
        PREFERENCES_FILE.size != null &&
        PREFERENCES_FILE.size <= PEERCHAT_NOTIFICATION_PREFERENCES_MAX_BYTES) {
      preferences = parsePeerChatNotificationPreferences(PREFERENCES_FILE.textSync())
    }
  } catch (error) {
    console.warn('Unable to load PeerChat notification preferences:', error)
  }
  state = { ...state, isReady: true, preferences }
  // The app icon still holds the last count, and the messages it counts are
  // still unread until their room is opened. Show it on the PeerChat shortcut
  // from the start, rather than nothing until the first check comes back.
  void getPeerChatBadgeCount().then((count) => {
    if (badgeCount === -1 && count > 0) setState({ unreadTotal: count })
  })
}

function persistPreferences (preferences: PeerChatNotificationPreferences) {
  try {
    if (!PREFERENCES_FILE.exists) PREFERENCES_FILE.create({ intermediates: true })
    PREFERENCES_FILE.write(serializePeerChatNotificationPreferences(preferences))
    return true
  } catch (error) {
    console.warn('Unable to save PeerChat notification preferences:', error)
    return false
  }
}

export async function setPeerChatNotificationsEnabled (enabled: boolean) {
  loadPreferences()
  if (enabled && !await requestPeerChatNotificationPermission()) {
    const denied = { ...state.preferences, notifications: false }
    if (persistPreferences(denied)) {
      setState({ preferences: denied })
      updateBackgroundService()
    }
    return false
  }
  const next = { ...state.preferences, notifications: enabled }
  if (!persistPreferences(next)) return false
  setState({ preferences: next })
  updateBackgroundService()
  return true
}

export function setPeerChatSoundsEnabled (enabled: boolean) {
  loadPreferences()
  const next = { ...state.preferences, sounds: enabled }
  if (!persistPreferences(next)) return false
  setState({ preferences: next })
  return true
}

/** Whether the chat screen is what is on show, where a new message only plays a sound. */
export function setPeerChatNotifierVisible (visible: boolean) {
  isPeerChatVisible = visible
}

/**
 * Starts looking for messages, for as long as the backend runs. Once is
 * enough: the screen opening over a PeerChat the service started finds it
 * running. Resolves after the first look.
 */
export function startPeerChatNotifier (callRpc: CallRpc) {
  loadPreferences()
  if (checker) {
    checker.callRpc = callRpc
    return Promise.resolve()
  }

  const current: Checker = { callRpc, cancelled: false, timer: null, stop: () => {} }
  checker = current
  previousRooms = null
  badgeCount = -1

  const schedule = () => {
    if (!current.cancelled) {
      current.timer = setTimeout(async () => {
        await poll(current)
        schedule()
      }, POLL_INTERVAL_MS)
    }
  }
  const appStateSubscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') void poll(current)
  })
  let lastBackgroundRefresh = Date.now()
  const backgroundTickSubscription = addPeerChatBackgroundTickListener(() => {
    if (!state.preferences.notifications) return
    void poll(current)

    if (AppState.currentState === 'active') return
    const now = Date.now()
    if (now - lastBackgroundRefresh < BACKGROUND_REFRESH_INTERVAL_MS) return
    lastBackgroundRefresh = now
    void current.callRpc(RPC_HYPER_REFRESH, {}).catch((error) => {
      console.warn('Unable to refresh Hyper networking in the background:', error)
    })
  })
  current.stop = () => {
    appStateSubscription.remove()
    backgroundTickSubscription.remove()
  }

  void preparePeerChatNotifications().catch((error) => {
    console.warn('Unable to prepare PeerChat notifications:', error)
  })
  return poll(current).finally(schedule)
}

/**
 * Looks now, as when the backend says PeerChat changed. In the background
 * that is what shows a message the moment it lands: the app's timers wait
 * there, and the service's tick comes once a minute.
 */
export function checkPeerChatNow () {
  if (checker) void poll(checker)
}

/**
 * Stops looking, as when a clear or a restore replaced what PeerChat had.
 * disableService also stops the PeerChat service: its notice would say
 * connected for a PeerChat that is gone.
 */
export function stopPeerChatNotifier ({ disableService = false }: { disableService?: boolean } = {}) {
  const current = checker
  checker = null
  previousRooms = null
  badgeCount = -1
  if (current) {
    current.cancelled = true
    if (current.timer) clearTimeout(current.timer)
    current.stop()
  }
  if (disableService) {
    backgroundWanted = false
    reportedConnected = false
    void setPeerChatBackgroundEnabled(false).catch((error) => {
      console.warn('Unable to stop the PeerChat background service:', error)
    })
  }
}

/** The backend stopped or could not start: the service's notice says so. */
export function reportPeerChatOffline () {
  reportedConnected = false
  setPeerChatBackgroundStatus('offline')
}

// The PeerChat service runs while notifications are on and there is a chat,
// decided once the backend has said how many chats there are. Before that,
// nothing is known, and a service Android started is left running.
function updateBackgroundService () {
  if (!checker || previousRooms === null) return
  const wanted = shouldEnablePeerChatBackground({
    isRuntimeReady: true,
    notificationsEnabled: state.preferences.notifications,
    roomCount: state.roomCount
  })
  if (wanted === backgroundWanted) return
  backgroundWanted = wanted
  void setPeerChatBackgroundEnabled(wanted).catch((error) => {
    console.warn('Unable to update PeerChat background service:', error)
  })
}

async function poll (current: Checker): Promise<void> {
  if (current.cancelled) return
  if (pollInFlight) {
    pollAgain = true
    return
  }
  if (AppState.currentState !== 'active' && !state.preferences.notifications) return
  pollInFlight = true
  try {
    const response = await current.callRpc(RPC_PEERCHAT_ROOMS, {})
    if (!response.ok) throw new Error(response.error || 'Unable to check PeerChat messages.')
    if (current.cancelled) return

    const nextRooms = Array.isArray(response.rooms) ? response.rooms : []
    const nextUnreadTotal = normalizeUnreadTotal(response.unreadTotal, nextRooms)
    setState({ roomCount: nextRooms.length, unreadTotal: nextUnreadTotal })
    if (!reportedConnected) {
      reportedConnected = true
      setPeerChatBackgroundStatus('connected')
    }
    if (badgeCount !== nextUnreadTotal) {
      badgeCount = nextUnreadTotal
      try {
        await setPeerChatBadgeCount(nextUnreadTotal)
        badgeWarning = false
      } catch (error) {
        if (!badgeWarning) {
          badgeWarning = true
          console.warn('Unable to update PeerChat badge:', error)
        }
      }
    }
    const previous = previousRooms
    previousRooms = nextRooms
    warned = false
    updateBackgroundService()
    if (shouldClearSeenPeerChatNotifications(previous, nextRooms)) {
      try {
        await dismissPeerChatNotifications(collectSeenPeerChatNotifications(
          await getPresentedPeerChatNotifications(),
          nextRooms
        ))
      } catch (error) {
        console.warn('Unable to clear read PeerChat notifications:', error)
      }
    }
    if (!previous) return
    const candidates = collectPeerChatNotificationCandidates(previous, nextRooms)
    if (candidates.length === 0) return
    if (shouldHandlePeerChatNotificationInApp(isPeerChatVisible, AppState.currentState)) {
      if (state.preferences.sounds) playPeerChatSound('receive', RECEIVE_SOUND)
      return
    }
    if (!state.preferences.notifications || !await hasPeerChatNotificationPermission()) return

    for (const candidate of candidates) {
      if (current.cancelled) return
      await presentPeerChatNotification({
        ...candidate,
        sounds: state.preferences.sounds
      })
    }
  } catch (error) {
    if (!current.cancelled && !warned) {
      warned = true
      console.warn('Unable to check PeerChat notifications:', error)
    }
  } finally {
    pollInFlight = false
    if (pollAgain) {
      pollAgain = false
      if (checker) void poll(checker)
    }
  }
}

function normalizeUnreadTotal (value: unknown, rooms: NotificationRoom[]) {
  if (Number.isSafeInteger(value) && Number(value) >= 0) return Math.min(Number(value), 9999)
  // A muted chat counts its mentions only, as getUnreadTotal does.
  return Math.min(9999, rooms.reduce((total, room) => {
    const count = room.isMuted === true ? room.unreadMentions : room.unreadCount
    const unread = Number.isSafeInteger(count) && Number(count) > 0 ? Number(count) : 0
    return total + unread
  }, 0))
}
