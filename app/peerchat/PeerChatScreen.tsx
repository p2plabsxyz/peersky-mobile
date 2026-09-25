import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Constants from 'expo-constants'
import { File, Paths } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { useVideoPlayer, VideoView } from 'expo-video'
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Clipboard,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'

import {
  parsePeerChatIntroState,
  PEERCHAT_INTRO_MAX_BYTES,
  PEERCHAT_INTRO_POINTS,
  serializePeerChatIntroState
} from './intro-state.mjs'
import {
  parsePeerChatUiState,
  PEERCHAT_UI_STATE_MAX_BYTES,
  serializePeerChatUiState
} from './ui-state.mjs'
import { assessLink, describeLinkRisk, extractFirstLink, LINK_SUSPICIOUS } from './link-safety.mjs'
import { shareLink } from '../share'
import {
  filterPeerChatMembers,
  filterPeerChatMessages,
  filterPeerChatRooms,
  formatPeerChatDateLabel,
  formatPeerChatMessageDetails,
  PEERCHAT_SEARCH_QUERY_MAX_CHARACTERS
} from './message-search.mjs'
import { normalizePeerChatMentionSpacing, splitPeerChatMentions } from './message-text.mjs'
import {
  isPeerChatNotificationBlocked,
  openPeerChatNotificationSettings
} from './notifications'
import {
  isPeerChatBatteryUnrestricted,
  openPeerChatBatterySettings
} from './background-service'
import { playPeerChatSound } from './sounds'
import {
  createPeerChatEmojiEntries,
  filterPeerChatEmojiEntries,
  PEERCHAT_EMOJI_SEARCH_MAX_CHARACTERS
} from './emoji-search.mjs'
import { mergePeerChatProfile } from './profile-state.mjs'
import {
  createPeerChatAvatarDataUrl,
  MAX_PEERCHAT_AVATAR_FILE_BYTES
} from './avatar.mjs'
import {
  RPC_HYPER_FETCH,
  RPC_PEERCHAT_ATTACHMENT_OPEN,
  RPC_PEERCHAT_ATTACHMENT_UPLOAD,
  RPC_PEERCHAT_DM_ACCEPT,
  RPC_PEERCHAT_DM_CREATE,
  RPC_PEERCHAT_DM_REJECT,
  RPC_PEERCHAT_INIT,
  RPC_PEERCHAT_BLOCK,
  RPC_PEERCHAT_ONBOARD,
  RPC_PEERCHAT_PROFILE_SET,
  RPC_PEERCHAT_ROOM_CREATE,
  RPC_PEERCHAT_ROOM_JOIN,
  RPC_PEERCHAT_ROOM_LEAVE,
  RPC_PEERCHAT_ROOM_MUTE,
  RPC_PEERCHAT_ROOM_PIN,
  RPC_PEERCHAT_ROOM_UPDATE,
  RPC_PEERCHAT_ROOMS,
  RPC_PEERCHAT_REACT,
  RPC_PEERCHAT_SET_ACTIVE,
  RPC_PEERCHAT_SEND,
  RPC_PEERCHAT_SNAPSHOT,
  RPC_PEERCHAT_UNBLOCK
} from '../../backend/rpc/commands.mjs'
import BackIcon from '../../assets/icons/bootstrap/arrow-left.svg'
import ShareIcon from '../../assets/icons/bootstrap/share.svg'
import CloseIcon from '../../assets/icons/bootstrap/x-lg.svg'
import LatestIcon from '../../assets/icons/peerchat/arrow-down.svg'
import MuteIcon from '../../assets/icons/peerchat/mute.svg'
import PinIcon from '../../assets/icons/peerchat/pin.svg'
import SearchIcon from '../../assets/icons/peerchat/search.svg'
import SendIcon from '../../assets/icons/peerchat/send.svg'
import SettingsIcon from '../../assets/icons/peerchat/settings.svg'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { buildPeerChatInviteUrl, parsePeerChatInvite } from './peerchat-invite.mjs'
import { pickUploads } from '../media/upload-gate'
import { scanMedia } from '../media/NsfwScanner'
import { MEDIA_BLOCKED } from '../media/media-moderation.mjs'

type PeerChatMessage = {
  id: string
  sender: string
  senderName: string
  message: string
  timestamp: number
  self: boolean
  replyTo?: PeerChatReply | null
  reactions?: PeerChatReactionSummary[]
  fileName?: string
  fileSize?: number
  fileEnc?: boolean
  preview?: PeerChatLinkPreview | null
  system?: boolean
}

type PeerChatModeration = {
  abuseFilter: boolean
  nsfwFilter: boolean
  spamRateLimit: number
}

type PeerChatLinkPreview = {
  url: string
  host?: string
  title?: string
  description?: string
}

type PeerChatReactionSummary = {
  emoji: string
  count: number
  self: boolean
}

type PeerChatReply = {
  id: string
  sender: string
  sn: string
  text: string
}

type PeerChatLastMessage = {
  sender: string
  senderName: string
  message: string
  timestamp: number
}

type PeerChatRoom = {
  roomKey: string
  name: string
  bio: string
  link: string
  avatar: string | null
  isDM: boolean
  dmWith: string | null
  pendingAcceptance: boolean
  rejected: boolean
  blockedByPeer: boolean
  isHost: boolean
  isPinned: boolean
  isMuted: boolean
  createdAt: number
  createdBy: string
  createdByName: string
  moderation: PeerChatModeration
  lastMessage: PeerChatLastMessage | null
  peerCount: number
  unreadCount: number
  unreadMentions: number
  lastReadTs: number
  members: PeerChatMember[]
  connectionState: 'connecting' | 'syncing' | 'connected' | 'waiting'
}

type PeerChatMember = {
  id: string
  username: string
  bio: string
  avatar: string | null
  self: boolean
  online: boolean
}

type PeerChatMediaTarget = {
  kind: 'image' | 'video'
  label: string
  uri: string
}

type PeerChatProfile = {
  id: string
  username: string
  bio: string
  avatar: string | null
  linkPreview: boolean
}

type PeerChatDirectInvite = {
  roomKey: string
  fromId: string
  fromUsername: string
  fromBio: string
  fromAvatar: string | null
  receivedAt: number
}

export type PeerChatResponse = {
  ok: boolean
  error?: string
  profile?: PeerChatProfile
  room?: PeerChatRoom
  rooms?: PeerChatRoom[]
  messages?: PeerChatMessage[] | null
  version?: number
  sent?: PeerChatMessage
  item?: { name: string, url: string, byteLength?: number }
  pendingDirectMessages?: PeerChatDirectInvite[]
  blockedPeers?: PeerChatBlockedPeer[]
  unreadTotal?: number
  mediaType?: 'image' | 'video' | 'audio'
  mediaUrl?: string
  localUri?: string
}

type PeerChatScreenProps = {
  isDark: boolean
  // Bumped by the backend the moment PeerChat changes, so a message lands
  // without waiting for the next poll.
  revision: number
  notificationPreferencesReady: boolean
  notificationsEnabled: boolean
  onCallRpc: (command: number, data?: object) => Promise<PeerChatResponse>
  onNotificationsEnabledChange: (enabled: boolean) => Promise<boolean>
  onOpenLocalFile: (uri: string, name: string) => Promise<boolean>
  onRequestedRoomHandled: () => void
  onOpenUrl: (url: string) => void
  onSoundsEnabledChange: (enabled: boolean) => boolean
  onStatus: (message: string) => void
  soundsEnabled: boolean
  requestedRoomKey: string | null
}

const POLL_INTERVAL_MS = 1500
const ROOM_LIST_POLL_INTERVAL_MS = 3000
const MAX_PEERCHAT_AVATAR_SOURCE_BYTES = 25 * 1024 * 1024
type PeerChatBlockedPeer = {
  peerId: string
  username: string
  blockedAt: number
}

// A refused upload or a failed send has to survive long enough to be read.
const ERROR_MIN_VISIBLE_MS = 5000
// A large video streams slowly, so this is generous. It is only here so a
// stalled upload cannot lock the composer for the rest of the session.
const UPLOAD_TIMEOUT_MS = 3 * 60 * 1000

const PEERCHAT_SOURCE_URL = 'https://github.com/p2plabsxyz/peerchat'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥']
const PEERCHAT_EMOJI_ENTRIES = createPeerChatEmojiEntries(
  require('../../assets/peerchat/emojilib-emoji-en-US.json')
)
const PEERCHAT_ICON = require('../../assets/images/peerchat.png')
const PEERCHAT_INTRO_FILE = new File(Paths.document, 'peerchat-intro.json')

type LandingAction = 'create' | 'join' | null

type PeerChatUiState = {
  activeRoomKey: string | null
  draftRoomKey: string | null
  draft: string
}

const EMPTY_UI_STATE: PeerChatUiState = {
  activeRoomKey: null,
  draftRoomKey: null,
  draft: ''
}

const PEERCHAT_UI_STATE_FILE = new File(Paths.document, 'peerchat-ui-state.json')
const UI_STATE_PERSIST_DELAY_MS = 300
const CHAT_HEADER_ICON_SIZE = 20
const ROOM_STATE_ICON_SIZE = 13
const AUTO_INLINE_MEDIA_MAX_BYTES = 100 * 1024 * 1024

export function PeerChatScreen ({
  isDark,
  revision,
  notificationPreferencesReady,
  notificationsEnabled,
  onCallRpc,
  onNotificationsEnabledChange,
  onOpenLocalFile,
  onRequestedRoomHandled,
  onOpenUrl,
  onSoundsEnabledChange,
  onStatus,
  soundsEnabled,
  requestedRoomKey
}: PeerChatScreenProps) {
  const colors = isDark ? darkColors : lightColors
  const callRpcRef = useRef(onCallRpc)
  const messageListRef = useRef<FlatList<PeerChatMessage> | null>(null)
  const versionRef = useRef(-1)
  const activeRoomRef = useRef<PeerChatRoom | null>(null)
  const pollInFlightRef = useRef(false)
  const roomListPollInFlightRef = useRef(false)
  const actionInFlightRef = useRef(false)
  const isNearMessageBottomRef = useRef(true)
  const observedMessageIdsRef = useRef<Set<string> | null>(null)
  const roomOpenedAtRef = useRef(0)
  const mountedRef = useRef(true)
  const composerRoomKeyRef = useRef<string | null>(null)
  const uiStateRef = useRef<PeerChatUiState>(EMPTY_UI_STATE)
  const uiStateRestoredRef = useRef(false)
  const [isIntroReady, setIsIntroReady] = useState(false)
  const [showIntro, setShowIntro] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moderationWarning, setModerationWarning] = useState<string | null>(null)
  const [profile, setProfile] = useState<PeerChatProfile | null>(null)
  const [profileName, setProfileName] = useState('')
  const [profileBio, setProfileBio] = useState('')
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null)
  const [linkPreviewsEnabled, setLinkPreviewsEnabled] = useState(true)
  const [roomName, setRoomName] = useState('')
  const [roomBio, setRoomBio] = useState('')
  const [roomLink, setRoomLink] = useState('')
  const [roomAvatar, setRoomAvatar] = useState<string | null>(null)
  const [roomAbuseFilter, setRoomAbuseFilter] = useState(true)
  const [roomNsfwFilter, setRoomNsfwFilter] = useState(true)
  const [roomSpamRateLimit, setRoomSpamRateLimit] = useState(10)
  const [joinKey, setJoinKey] = useState('')
  const [isScanningInvite, setIsScanningInvite] = useState(false)
  const [blockedPeers, setBlockedPeers] = useState<PeerChatBlockedPeer[]>([])
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const inviteScanHandledRef = useRef(false)
  const [rooms, setRooms] = useState<PeerChatRoom[]>([])
  const [pendingDirectMessages, setPendingDirectMessages] = useState<PeerChatDirectInvite[]>([])
  const [activeRoom, setActiveRoom] = useState<PeerChatRoom | null>(null)
  const [messages, setMessages] = useState<PeerChatMessage[]>([])
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const [composer, setComposer] = useState('')
  const [replyTarget, setReplyTarget] = useState<PeerChatReply | null>(null)
  const [messageActionTarget, setMessageActionTarget] = useState<PeerChatMessage | null>(null)
  const [roomActionTarget, setRoomActionTarget] = useState<PeerChatRoom | null>(null)
  const [profileTarget, setProfileTarget] = useState<PeerChatMember | null>(null)
  // A refresh clears the error, and refreshes now arrive the moment anything
  // changes, so a message could be gone before it had been read.
  const errorShownAtRef = useRef(0)
  const [mediaTarget, setMediaTarget] = useState<PeerChatMediaTarget | null>(null)
  const [isConfirmingRoomLeave, setIsConfirmingRoomLeave] = useState(false)
  const [isMessageInfoVisible, setIsMessageInfoVisible] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [roomSearchQuery, setRoomSearchQuery] = useState('')
  const [showPeerChatSettings, setShowPeerChatSettings] = useState(false)
  // A page swap inside the same sheet, not a second modal. iOS crashes when one
  // modal is presented over another, and a back button reads better anyway.
  const [settingsPage, setSettingsPage] = useState<'main' | 'about'>('main')
  const [showRoomInfo, setShowRoomInfo] = useState(false)
  const pendingModalRef = useRef<(() => void) | null>(null)
  const pendingModalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [editRoomName, setEditRoomName] = useState('')
  const [editRoomBio, setEditRoomBio] = useState('')
  const [editRoomLink, setEditRoomLink] = useState('')
  const [editRoomAvatar, setEditRoomAvatar] = useState<string | null>(null)
  const [memberSearchQuery, setMemberSearchQuery] = useState('')
  const [showComposerEmoji, setShowComposerEmoji] = useState(false)
  const [emojiSearchQuery, setEmojiSearchQuery] = useState('')
  const [landingAction, setLandingAction] = useState<LandingAction>(null)
  const [restoredUiState, setRestoredUiState] = useState<PeerChatUiState | null>(null)
  const mentionCandidates = getMentionCandidates(
    composer,
    activeRoom?.members || [],
    messages,
    profile?.id || ''
  )
  const visibleMessages = useMemo(
    () => filterPeerChatMessages(messages, isSearching ? searchQuery : '') as PeerChatMessage[],
    [isSearching, messages, searchQuery]
  )
  const displayedMessages = useMemo(() => [...visibleMessages].reverse(), [visibleMessages])
  const visibleRooms = filterPeerChatRooms(rooms, roomSearchQuery) as PeerChatRoom[]
  const visibleMembers = filterPeerChatMembers(
    activeRoom?.members || [],
    memberSearchQuery
  ) as PeerChatMember[]
  const visibleEmoji = useMemo(
    () => filterPeerChatEmojiEntries(PEERCHAT_EMOJI_ENTRIES, emojiSearchQuery),
    [emojiSearchQuery]
  )
  // Messaging someone offline is allowed. There is no server holding the
  // message, so it only moves while both sides are running.
  const offlineDirectPeer = activeRoom?.isDM && activeRoom.dmWith
    ? activeRoom.members.find((member) => member.id === activeRoom.dmWith && !member.online) || null
    : null
  // A block closes the conversation both ways, so the composer is shut whether
  // we blocked them or they blocked us.
  const blockedTheDirectMessage = Boolean(
    activeRoom?.isDM && activeRoom.dmWith &&
    blockedPeers.some((blocked) => blocked.peerId === activeRoom.dmWith)
  )
  const isDirectMessageBlocked = Boolean(
    activeRoom?.isDM && (activeRoom.blockedByPeer || blockedTheDirectMessage)
  )

  useEffect(() => {
    callRpcRef.current = onCallRpc
  }, [onCallRpc])

  useEffect(() => {
    let cancelled = false

    async function loadIntroState () {
      let completed = false
      try {
        if (PEERCHAT_INTRO_FILE.exists && PEERCHAT_INTRO_FILE.size <= PEERCHAT_INTRO_MAX_BYTES) {
          completed = parsePeerChatIntroState(await PEERCHAT_INTRO_FILE.text())
        }
      } catch (cause) {
        console.warn('Unable to load PeerChat intro state:', cause)
      }

      if (!cancelled) {
        setShowIntro(!completed)
        setIsIntroReady(true)
      }
    }

    void loadIntroState()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadUiState () {
      let restored = EMPTY_UI_STATE
      try {
        if (PEERCHAT_UI_STATE_FILE.exists && PEERCHAT_UI_STATE_FILE.size <= PEERCHAT_UI_STATE_MAX_BYTES) {
          restored = parsePeerChatUiState(await PEERCHAT_UI_STATE_FILE.text()) as PeerChatUiState
        }
      } catch (cause) {
        console.warn('Unable to load PeerChat UI state:', cause)
      }
      if (!cancelled) setRestoredUiState(restored)
    }

    void loadUiState()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      if (uiStateRestoredRef.current) persistPeerChatUiState(uiStateRef.current)
      void callRpcRef.current(RPC_PEERCHAT_SET_ACTIVE, { roomKey: null }).catch(() => {})
      mountedRef.current = false
      activeRoomRef.current = null
      if (pendingModalTimerRef.current) clearTimeout(pendingModalTimerRef.current)
      pendingModalTimerRef.current = null
      pendingModalRef.current = null
    }
  }, [])

  const callRpc = useCallback((command: number, data: object = {}) => {
    return callRpcRef.current(command, data)
  }, [])

  useEffect(() => {
    activeRoomRef.current = activeRoom
  }, [activeRoom])

  useEffect(() => {
    if (!moderationWarning) return
    const timer = setTimeout(() => setModerationWarning(null), 6000)
    return () => clearTimeout(timer)
  }, [moderationWarning])

  useEffect(() => {
    let cancelled = false
    void callRpc(RPC_PEERCHAT_SET_ACTIVE, { roomKey: activeRoom?.roomKey || null })
      .then((response) => {
        if (!cancelled && mountedRef.current && response.ok && response.rooms) setRooms(response.rooms)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeRoom?.roomKey, callRpc])

  useEffect(() => {
    if (!uiStateRestoredRef.current) return

    const nextState = {
      activeRoomKey: activeRoom?.roomKey || null,
      draftRoomKey: composer ? composerRoomKeyRef.current : null,
      draft: composer
    }
    uiStateRef.current = nextState
    const timer = setTimeout(() => persistPeerChatUiState(nextState), UI_STATE_PERSIST_DELAY_MS)
    return () => clearTimeout(timer)
  }, [activeRoom?.roomKey, composer])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && uiStateRestoredRef.current) {
        persistPeerChatUiState(uiStateRef.current)
      }
      void callRpcRef.current(RPC_PEERCHAT_SET_ACTIVE, {
        roomKey: state === 'active' ? activeRoomRef.current?.roomKey || null : null
      }).catch(() => {})
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (!activeRoom) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setActiveRoom(null)
      setIsSearching(false)
      setSearchQuery('')
      return true
    })
    return () => subscription.remove()
  }, [activeRoom])

  useEffect(() => {
    if (!requestedRoomKey || !isInitialized) return
    const room = rooms.find((item) => item.roomKey === requestedRoomKey)
    if (room) {
      openRoom(room)
      onRequestedRoomHandled()
      return
    }

    // An invite link for a room we are not in yet: join it, then open it, so
    // tapping a link does the whole thing rather than landing on the list.
    onRequestedRoomHandled()
    void joinRoomByKey(requestedRoomKey)
  }, [isInitialized, onRequestedRoomHandled, requestedRoomKey, rooms])

  useEffect(() => {
    let cancelled = false

    void callRpc(RPC_PEERCHAT_INIT, {})
      .then((response) => {
        if (cancelled) return
        if (!response.ok) throw new Error(response.error || 'Unable to start PeerChat.')
        const nextProfile = response.profile || null
        setProfile(nextProfile)
        setProfileName(nextProfile?.username || '')
        setProfileBio(nextProfile?.bio || '')
        setProfileAvatar(nextProfile?.avatar || null)
        setLinkPreviewsEnabled(nextProfile?.linkPreview !== false)
        setRooms(response.rooms || [])
        setPendingDirectMessages(response.pendingDirectMessages || [])
        setBlockedPeers(response.blockedPeers || [])
        versionRef.current = Number.isSafeInteger(response.version) ? response.version as number : -1
        setIsInitialized(true)
        setIsReady(true)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
        setIsReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [callRpc])

  useEffect(() => {
    if (!isInitialized || !restoredUiState || uiStateRestoredRef.current) return

    const roomKeys = new Set(rooms.map((room) => room.roomKey))
    const draftRoomKey = restoredUiState.draftRoomKey && roomKeys.has(restoredUiState.draftRoomKey)
      ? restoredUiState.draftRoomKey
      : null
    const restoredRoom = restoredUiState.activeRoomKey
      ? rooms.find((room) => room.roomKey === restoredUiState.activeRoomKey) || null
      : null

    composerRoomKeyRef.current = draftRoomKey
    setComposer(draftRoomKey ? restoredUiState.draft : '')
    if (restoredRoom) {
      versionRef.current = -1
      observedMessageIdsRef.current = null
      roomOpenedAtRef.current = Date.now()
      setMessages([])
      resetMessageScrollState()
      setActiveRoom(restoredRoom)
    }
    uiStateRef.current = {
      activeRoomKey: restoredRoom?.roomKey || null,
      draftRoomKey,
      draft: draftRoomKey ? restoredUiState.draft : ''
    }
    uiStateRestoredRef.current = true
  }, [isInitialized, restoredUiState, rooms])

  const refreshRoom = useCallback(async (force = false) => {
    const room = activeRoomRef.current
    if (!room || pollInFlightRef.current) return
    pollInFlightRef.current = true

    try {
      const response = await callRpc(RPC_PEERCHAT_SNAPSHOT, {
        roomKey: room.roomKey,
        version: force ? -1 : versionRef.current
      })
      if (!response.ok) throw new Error(response.error || 'Unable to refresh PeerChat room.')
      if (!mountedRef.current || activeRoomRef.current?.roomKey !== room.roomKey) return

      if (response.room) setActiveRoom(response.room)
      if (response.rooms) setRooms(response.rooms)
      if (Array.isArray(response.messages)) {
        const previousIds = observedMessageIdsRef.current
        if (previousIds && soundsEnabled) {
          const hasNewRemoteMessage = response.messages.some((message) => (
            !message.self &&
            !message.system &&
            !previousIds.has(message.id) &&
            message.timestamp >= roomOpenedAtRef.current
          ))
          if (hasNewRemoteMessage) {
            playPeerChatSound('receive', require('../../assets/sounds/peerchat/receive.mp3'))
          }
        }
        observedMessageIdsRef.current = new Set(response.messages.map((message) => message.id))
        setMessages(response.messages)
      }
      if (Number.isSafeInteger(response.version)) versionRef.current = response.version as number
      clearReadError()
    } catch (cause) {
      if (mountedRef.current && activeRoomRef.current?.roomKey === room.roomKey) {
        showError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      pollInFlightRef.current = false
    }
  }, [callRpc, soundsEnabled])

  useEffect(() => {
    if (!activeRoom) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      if (cancelled) return
      if (AppState.currentState === 'active') await refreshRoom()
      if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS)
    }
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshRoom(true)
    })
    void refreshRoom(true).finally(() => {
      if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS)
    })

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      appStateSubscription.remove()
    }
  }, [activeRoom?.roomKey, refreshRoom])

  // The backend bumps this the moment anything changes, so a message shows up
  // straight away rather than on the next poll. Polling stays as the fallback.
  useEffect(() => {
    if (!revision) return
    void refreshRoom(true)
  }, [revision, refreshRoom])

  useEffect(() => {
    if (!isReady || activeRoom) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const refreshRooms = async () => {
      if (cancelled || roomListPollInFlightRef.current || AppState.currentState !== 'active') return
      roomListPollInFlightRef.current = true
      try {
        const response = await callRpc(RPC_PEERCHAT_ROOMS, {})
        if (!response.ok) throw new Error(response.error || 'Unable to refresh PeerChat rooms.')
        if (cancelled || !mountedRef.current) return
        if (response.profile) setProfile((current) => mergePeerChatProfile(current, response.profile))
        setRooms(response.rooms || [])
        setPendingDirectMessages(response.pendingDirectMessages || [])
        setBlockedPeers(response.blockedPeers || [])
        if (Number.isSafeInteger(response.version)) versionRef.current = response.version as number
      } catch (cause) {
        if (!cancelled && mountedRef.current) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        roomListPollInFlightRef.current = false
      }
    }

    const schedule = () => {
      if (!cancelled) timer = setTimeout(async () => {
        await refreshRooms()
        schedule()
      }, ROOM_LIST_POLL_INTERVAL_MS)
    }
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshRooms()
    })
    schedule()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      appStateSubscription.remove()
    }
  }, [activeRoom, callRpc, isReady])

  async function saveProfile () {
    const response = await callRpc(RPC_PEERCHAT_PROFILE_SET, {
      username: profileName,
      bio: profileBio,
      avatar: profileAvatar,
      linkPreview: linkPreviewsEnabled
    })
    if (!response.ok || !response.profile) {
      throw new Error(response.error || 'Unable to save PeerChat name.')
    }
    if (!mountedRef.current) return
    setProfile(response.profile)
    setProfileName(response.profile.username)
    setProfileBio(response.profile.bio || '')
    setProfileAvatar(response.profile.avatar || null)
    setLinkPreviewsEnabled(response.profile.linkPreview !== false)
  }

  function openPeerChatSettings () {
    if (profile) {
      setProfileName(profile.username)
      setProfileBio(profile.bio || '')
      setProfileAvatar(profile.avatar || null)
      setLinkPreviewsEnabled(profile.linkPreview !== false)
    }
    setSettingsPage('main')
    setShowPeerChatSettings(true)
  }

  function showError (message: string) {
    errorShownAtRef.current = Date.now()
    setError(message)
  }

  function clearReadError () {
    if (Date.now() - errorShownAtRef.current < ERROR_MIN_VISIBLE_MS) return
    setError(null)
  }

  async function runAction (action: () => Promise<void>) {
    if (actionInFlightRef.current) return
    actionInFlightRef.current = true
    setIsBusy(true)
    setError(null)
    try {
      await action()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (mountedRef.current) {
        if (message.startsWith('Message blocked:')) {
          setModerationWarning(message.replace(/^Message blocked:\s*/, ''))
        } else {
          showError(message)
        }
        onStatus(message)
      }
    } finally {
      actionInFlightRef.current = false
      if (mountedRef.current) setIsBusy(false)
    }
  }

  function changeNotifications () {
    void runAction(async () => {
      const enabled = !notificationsEnabled
      if (await onNotificationsEnabledChange(enabled)) {
        onStatus(enabled ? 'PeerChat notifications enabled' : 'PeerChat notifications disabled')
        if (enabled) await offerBatteryExemption()
        return
      }
      if (!enabled) throw new Error('Unable to save notification preference.')
      if (!await isPeerChatNotificationBlocked()) {
        onStatus('PeerChat notifications stay off')
        return
      }
      Alert.alert(
        'Notifications are turned off',
        `${Platform.OS === 'ios' ? 'iOS' : 'Android'} is blocking alerts for PeerSky, so PeerChat cannot tell you about new messages. You can turn them back on in Settings.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: () => void openPeerChatNotificationSettings() }
        ]
      )
    })
  }

  // Android only. Without the exemption the system puts PeerSky to sleep after
  // a day or two of not opening it, and the peer silently drops offline.
  async function offerBatteryExemption () {
    if (Platform.OS !== 'android') return
    if (await isPeerChatBatteryUnrestricted()) return

    // Samsung layers its own sleeping-apps list on top of Android's, in a
    // different place, so that sentence only earns its space on a Samsung.
    const isSamsung = /samsung/i.test(Platform.constants?.Manufacturer || '')
    const samsungHint = isSamsung
      ? '\n\nOn this phone also open Battery, Background usage limits, and take PeerSky out of Sleeping apps.'
      : ''

    Alert.alert(
      'Keep PeerChat reachable',
      `Android puts apps it thinks are unused to sleep, which takes you offline for everyone. Setting PeerSky to unrestricted keeps messages arriving.${samsungHint}`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Open settings',
          onPress: () => void openPeerChatBatterySettings().catch(() => onStatus('Unable to open battery settings'))
        }
      ]
    )
  }

  function changeNotificationSounds () {
    const enabled = !soundsEnabled
    if (!onSoundsEnabledChange(enabled)) {
      setError('Unable to save notification sound preference.')
      return
    }
    onStatus(enabled ? 'PeerChat notification sound enabled' : 'PeerChat notification sound disabled')
  }

  function chooseAvatar (current: string | null, onChange: (avatar: string | null) => void) {
    if (isBusy) return
    const select = () => void runAction(async () => {
      // A profile picture is broadcast to everyone in your rooms, so it goes
      // through the same gate as an attachment.
      const [asset] = await pickUploads({ type: 'image/*' })
      if (!asset) return
      if (asset.size > MAX_PEERCHAT_AVATAR_SOURCE_BYTES) {
        throw new Error('Choose an image smaller than 25 MB.')
      }

      const manipulation = ImageManipulator.manipulate(asset.uri)
      let resizedImage = null
      let avatar = ''
      try {
        const dimensions = await Image.getSize(asset.uri)
        if (Math.max(dimensions.width, dimensions.height) > 512) {
          manipulation.resize(dimensions.width >= dimensions.height ? { width: 512 } : { height: 512 })
        }
        resizedImage = await manipulation.renderAsync()
        for (const compress of [0.8, 0.65, 0.5, 0.35]) {
          const result = await resizedImage.saveAsync({
            base64: true,
            compress,
            format: SaveFormat.JPEG
          })
          const resizedFile = new File(result.uri)
          if (resizedFile.size > MAX_PEERCHAT_AVATAR_FILE_BYTES) continue
          avatar = createPeerChatAvatarDataUrl({
            name: 'peerchat-avatar.jpg',
            mimeType: 'image/jpeg',
            size: resizedFile.size,
            base64: result.base64
          })
          break
        }
      } finally {
        resizedImage?.release()
        manipulation.release()
      }
      if (!avatar) throw new Error('Unable to reduce the selected image below 143 KB.')
      if (mountedRef.current) onChange(avatar)
    })

    if (!current) {
      select()
      return
    }
    Alert.alert('Chat image', 'Choose a new image or remove the current one.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onChange(null) },
      { text: 'Choose image', onPress: select }
    ])
  }

  function openRoom (room: PeerChatRoom) {
    if (composerRoomKeyRef.current !== room.roomKey) setComposer('')
    composerRoomKeyRef.current = room.roomKey
    versionRef.current = -1
    observedMessageIdsRef.current = null
    roomOpenedAtRef.current = Date.now()
    setMessages([])
    setReplyTarget(null)
    setIsSearching(false)
    setSearchQuery('')
    setShowRoomInfo(false)
    setEditRoomName(room.name)
    setEditRoomBio(room.bio || '')
    setEditRoomLink(room.link || '')
    setEditRoomAvatar(room.avatar || null)
    setMemberSearchQuery('')
    setShowComposerEmoji(false)
    setEmojiSearchQuery('')
    resetMessageScrollState()
    setActiveRoom(room)
    setRooms((current) => current.map((item) => item.roomKey === room.roomKey
      ? { ...item, unreadCount: 0, unreadMentions: 0 }
      : item))
    setError(null)
    onStatus(`Opened PeerChat room ${room.name}`)
  }

  function insertComposerEmoji (emoji: string) {
    setComposer((current) => `${current}${emoji}`)
    setEmojiSearchQuery('')
    setShowComposerEmoji(false)
  }

  function resetMessageScrollState () {
    isNearMessageBottomRef.current = true
    setShowScrollToLatest(false)
  }

  function saveRoomDetails () {
    if (!activeRoom?.isHost || isBusy) return
    void runAction(async () => {
      const response = await callRpc(RPC_PEERCHAT_ROOM_UPDATE, {
        roomKey: activeRoom.roomKey,
        name: editRoomName,
        bio: editRoomBio,
        link: editRoomLink,
        avatar: editRoomAvatar
      })
      if (!response.ok || !response.room || !response.rooms) {
        throw new Error(response.error || 'Unable to save room details.')
      }
      if (!mountedRef.current) return
      setActiveRoom(response.room)
      setRooms(response.rooms)
      setEditRoomName(response.room.name)
      setEditRoomBio(response.room.bio || '')
      setEditRoomLink(response.room.link || '')
      setEditRoomAvatar(response.room.avatar || null)
      setShowRoomInfo(false)
      onStatus('PeerChat room details saved')
    })
  }

  function startDirectMessage (member: PeerChatMember) {
    if (member.self || isBusy) return
    void runAction(async () => {
      const response = await callRpc(RPC_PEERCHAT_DM_CREATE, {
        peerId: member.id,
        username: member.username,
        bio: member.bio,
        avatar: member.avatar
      })
      if (!response.ok || !response.room || !response.rooms) {
        throw new Error(response.error || 'Unable to start direct message.')
      }
      if (!mountedRef.current) return
      setRooms(response.rooms)
      openRoom(response.room)
      onStatus(`Message request sent to ${member.username}`)
    })
  }

  // iOS presents every React Native Modal as its own view controller, so
  // opening a second one while the first is still on screen throws
  // "Attempt to present ... which is already presenting" and then takes the
  // Fabric view registry down with it. Hand over only once the first sheet has
  // finished dismissing. Android stacks modals fine and goes straight through.
  function flushPendingModal () {
    if (pendingModalTimerRef.current) {
      clearTimeout(pendingModalTimerRef.current)
      pendingModalTimerRef.current = null
    }
    const open = pendingModalRef.current
    pendingModalRef.current = null
    if (open) open()
  }

  function replaceModal (close: () => void, open: () => void) {
    close()
    if (Platform.OS !== 'ios') {
      open()
      return
    }
    pendingModalRef.current = open
    // onDismiss never fires if the sheet was closed before it finished
    // presenting, so do not rely on it alone.
    pendingModalTimerRef.current = setTimeout(flushPendingModal, 450)
  }

  function openMessageSenderProfile (message: PeerChatMessage) {
    const member = activeRoom?.members.find((candidate) => candidate.id === message.sender)
    setProfileTarget(member || {
      id: message.sender,
      username: message.senderName,
      bio: activeRoom?.isDM && activeRoom.dmWith === message.sender ? activeRoom.bio : '',
      avatar: activeRoom?.isDM && activeRoom.dmWith === message.sender ? activeRoom.avatar : null,
      self: message.self,
      online: false
    })
  }

  function viewProfileAvatar (member: PeerChatMember) {
    if (!member.avatar) return
    const avatar = member.avatar
    replaceModal(
      () => setProfileTarget(null),
      () => setMediaTarget({ kind: 'image', label: `${member.username}'s avatar`, uri: avatar })
    )
  }

  function openHeaderDetails () {
    if (!activeRoom?.isDM) {
      setShowRoomInfo(true)
      return
    }
    const peer = activeRoom.members.find((member) => !member.self && (
      !activeRoom.dmWith || member.id === activeRoom.dmWith
    ))
    if (peer) {
      setProfileTarget(peer)
      return
    }
    if (activeRoom.dmWith) {
      setProfileTarget({
        id: activeRoom.dmWith,
        username: activeRoom.name,
        bio: activeRoom.bio,
        avatar: activeRoom.avatar,
        self: false,
        online: false
      })
      return
    }
    setShowRoomInfo(true)
  }

  function respondToDirectMessage (invite: PeerChatDirectInvite, accept: boolean) {
    if (isBusy) return
    void runAction(async () => {
      const response = await callRpc(accept ? RPC_PEERCHAT_DM_ACCEPT : RPC_PEERCHAT_DM_REJECT, {
        roomKey: invite.roomKey
      })
      if (!response.ok) throw new Error(response.error || 'Unable to respond to message request.')
      if (!mountedRef.current) return
      setPendingDirectMessages(response.pendingDirectMessages || [])
      if (response.rooms) setRooms(response.rooms)
      if (accept && response.room) openRoom(response.room)
      onStatus(accept ? 'Message request accepted' : 'Message request declined')
    })
  }

  function createRoom () {
    void runAction(async () => {
      await saveProfile()
      const response = await callRpc(RPC_PEERCHAT_ROOM_CREATE, {
        name: roomName,
        bio: roomBio,
        link: roomLink,
        avatar: roomAvatar,
        moderation: {
          abuseFilter: roomAbuseFilter,
          nsfwFilter: roomNsfwFilter,
          spamRateLimit: roomSpamRateLimit
        }
      })
      if (!response.ok || !response.room) {
        throw new Error(response.error || 'Unable to create PeerChat room.')
      }
      if (!mountedRef.current) return
      setRooms((current) => [response.room as PeerChatRoom, ...current])
      setRoomName('')
      setRoomBio('')
      setRoomLink('')
      setRoomAvatar(null)
      setRoomAbuseFilter(true)
      setRoomNsfwFilter(true)
      setRoomSpamRateLimit(10)
      // The form has done its job. Leaving it open means coming back from the
      // room to a half-filled panel that looks like nothing happened.
      setLandingAction(null)
      openRoom(response.room)
      onStatus('PeerChat room created')
    })
  }

  // Shared by the Join button, an invite link and a scanned QR code. A function
  // declaration so the invite effect above can call it.
  async function joinRoomByKey (roomKey: string) {
    await runAction(async () => {
      await saveProfile()
      const response = await callRpc(RPC_PEERCHAT_ROOM_JOIN, { roomKey })
      if (!response.ok || !response.room) {
        throw new Error(response.error || 'Unable to join PeerChat room.')
      }
      if (!mountedRef.current) return
      setRooms((current) => [
        response.room as PeerChatRoom,
        ...current.filter((room) => room.roomKey !== response.room?.roomKey)
      ])
      setJoinKey('')
      setLandingAction(null)
      openRoom(response.room)
      onStatus('PeerChat room joined')
    })
  }

  function isMemberBlocked (member: PeerChatMember | null) {
    if (!member) return false
    return blockedPeers.some((blocked) => blocked.peerId === member.id)
  }

  async function blockMember (member: PeerChatMember) {
    setProfileTarget(null)
    await runAction(async () => {
      const response = await callRpc(RPC_PEERCHAT_BLOCK, { peerId: member.id, username: member.username })
      if (!response.ok) throw new Error(response.error || 'Unable to block this person.')
      if (!mountedRef.current) return
      setBlockedPeers(response.blockedPeers || [])
      setPendingDirectMessages(response.pendingDirectMessages || [])
      onStatus(`Blocked direct messages from ${member.username}`)
    })
  }

  async function unblockPeerId (peerId: string, username: string) {
    setProfileTarget(null)
    await runAction(async () => {
      const response = await callRpc(RPC_PEERCHAT_UNBLOCK, { peerId })
      if (!response.ok) throw new Error(response.error || 'Unable to unblock this person.')
      if (!mountedRef.current) return
      setBlockedPeers(response.blockedPeers || [])
      onStatus(`Unblocked ${username}`)
    })
  }

  async function unblockMember (member: PeerChatMember) {
    await unblockPeerId(member.id, member.username)
  }

  // There is no server to receive a report, so it goes to the maintainers by
  // email with enough context to act on.
  function reportMember (member: PeerChatMember) {
    setProfileTarget(null)
    const subject = `PeerChat report: ${member.username}`
    const body = [
      `Reported user: ${member.username}`,
      `Peer ID: ${member.id}`,
      `Room: ${activeRoom?.name || 'unknown'}`,
      `Room key: ${activeRoom?.roomKey || 'unknown'}`,
      `Reported at: ${new Date().toISOString()}`,
      '',
      'What happened?',
      '',
      '',
      'Please describe the behaviour above. PeerChat is peer to peer, so nobody',
      'can remove content for you, but blocking stops their direct messages.'
    ].join('\n')

    const url = `mailto:contact@p2plabs.xyz?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    Linking.openURL(url).catch(() => onStatus('Unable to open your email app'))
  }

  async function openInviteScanner () {
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission()
    if (!permission?.granted) {
      onStatus('Camera access is needed to scan an invite')
      return
    }
    inviteScanHandledRef.current = false
    setIsScanningInvite(true)
  }

  function handleScannedInvite (value: string) {
    if (inviteScanHandledRef.current) return
    inviteScanHandledRef.current = true
    setIsScanningInvite(false)

    // Accepts an invite link or a bare room key, so either kind of QR works.
    const roomKey = parsePeerChatInvite(value)
    if (!roomKey) {
      onStatus('That QR code is not a PeerChat invite')
      return
    }
    setJoinKey(roomKey)
    void joinRoomByKey(roomKey)
  }

  function joinRoom () {
    void runAction(async () => {
      await saveProfile()
      const response = await callRpc(RPC_PEERCHAT_ROOM_JOIN, {
        roomKey: joinKey
      })
      if (!response.ok || !response.room) {
        throw new Error(response.error || 'Unable to join PeerChat room.')
      }
      if (!mountedRef.current) return
      setRooms((current) => [
        response.room as PeerChatRoom,
        ...current.filter((room) => room.roomKey !== response.room?.roomKey)
      ])
      setJoinKey('')
      setLandingAction(null)
      openRoom(response.room)
      onStatus('PeerChat room joined')
    })
  }

  function showRoomActions (room: PeerChatRoom) {
    setIsConfirmingRoomLeave(false)
    setRoomActionTarget(room)
  }

  async function updateRoomPreference (room: PeerChatRoom, preference: 'muted' | 'pinned') {
    await runAction(async () => {
      const isMuted = preference === 'muted'
      const response = await callRpc(isMuted ? RPC_PEERCHAT_ROOM_MUTE : RPC_PEERCHAT_ROOM_PIN, {
        roomKey: room.roomKey,
        [preference]: isMuted ? !room.isMuted : !room.isPinned
      })
      if (!response.ok || !response.rooms) {
        throw new Error(response.error || 'Unable to update the chat preference.')
      }
      if (!mountedRef.current) return
      setRooms(response.rooms)
      const enabled = isMuted ? !room.isMuted : !room.isPinned
      onStatus(`PeerChat room ${enabled ? '' : 'un'}${preference}`)
    })
  }

  function sendMessage () {
    const message = activeRoom
      ? normalizePeerChatMentionSpacing(
          composer.trim(),
          activeRoom.members.map((member) => member.username)
        )
      : ''
    if (!activeRoom || !message || isBusy) return
    const selectedReply = replyTarget

    void runAction(async () => {
      const response = await callRpc(RPC_PEERCHAT_SEND, {
        roomKey: activeRoom.roomKey,
        message,
        replyTo: selectedReply
      })
      if (!response.ok) throw new Error(response.error || 'Unable to send PeerChat message.')
      if (!mountedRef.current) return
      setComposer('')
      setReplyTarget(null)
      if (response.sent) {
        setMessages((current) => current.some((item) => item.id === response.sent?.id)
          ? current
          : [...current, response.sent as PeerChatMessage])
      }
      versionRef.current = -1
      await refreshRoom(true)
      if (soundsEnabled) playPeerChatSound('send', require('../../assets/sounds/peerchat/send.mp3'))
      onStatus('PeerChat message sent')
    })
  }

  async function withUploadTimeout (work: Promise<PeerChatResponse>, fileName: string) {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        work,
        new Promise<PeerChatResponse>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${fileName} is taking too long to upload. It may be too large to share here.`)),
            UPLOAD_TIMEOUT_MS
          )
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  function attachFile () {
    if (!activeRoom || isBusy) return
    void runAction(async () => {
      // pickUploads bounds the batch and screens every file before any of it
      // is uploaded, so a refusal never leaves half a send in the room.
      const assets = await pickUploads({ multiple: true })
      if (assets.length === 0) return

      for (const [index, asset] of assets.entries()) {
        // A video takes a while to encrypt and write, and without this the
        // spinner is indistinguishable from the app having hung.
        onStatus(assets.length === 1
          ? `Uploading ${asset.name}`
          : `Uploading ${index + 1} of ${assets.length}: ${asset.name}`)
        // A safety net, not a deadline. The upload streams to a Hyperdrive and
        // always replies in the ordinary case; this only exists so a stall can
        // never leave the composer stuck busy with no way out.
        const upload = await withUploadTimeout(callRpc(RPC_PEERCHAT_ATTACHMENT_UPLOAD, {
          roomKey: activeRoom.roomKey,
          fileUri: asset.uri,
          byteLength: asset.size
        }), asset.name)
        if (!upload.ok || !upload.item) throw new Error(upload.error || 'Unable to upload attachment.')

        const response = await callRpc(RPC_PEERCHAT_SEND, {
          roomKey: activeRoom.roomKey,
          message: upload.item.url,
          fileName: asset.name,
          fileSize: upload.item.byteLength ?? asset.size,
          fileEnc: true
        })
        if (!response.ok) throw new Error(response.error || 'Unable to send attachment.')
      }

      versionRef.current = -1
      await refreshRoom(true)
      if (soundsEnabled) playPeerChatSound('send', require('../../assets/sounds/peerchat/send.mp3'))
      onStatus(assets.length === 1 ? `Sent ${assets[0].name}` : `Sent ${assets.length} files`)
    })
  }

  function leaveRoom (room: PeerChatRoom) {
    setRoomActionTarget(null)
    setIsConfirmingRoomLeave(false)
    void runAction(async () => {
      const response = await callRpc(RPC_PEERCHAT_ROOM_LEAVE, {
        roomKey: room.roomKey
      })
      if (!response.ok) throw new Error(response.error || 'Unable to leave PeerChat room.')
      if (!mountedRef.current) return
      setRooms((current) => current.filter((item) => item.roomKey !== room.roomKey))
      if (composerRoomKeyRef.current === room.roomKey) {
        composerRoomKeyRef.current = null
        setComposer('')
      }
      if (activeRoomRef.current?.roomKey === room.roomKey) {
        setActiveRoom(null)
        setMessages([])
        setReplyTarget(null)
        setIsSearching(false)
        setSearchQuery('')
      }
      onStatus('PeerChat room removed')
    })
  }

  async function shareRoom () {
    if (!activeRoom) return
    try {
      // The link, not the bare key. Tapping it joins the room; a 64 character
      // key has to be copied into Join Room by hand.
      await shareLink({
        title: `Join ${activeRoom.name} on PeerChat`,
        message: buildPeerChatInviteUrl(activeRoom.roomKey) || activeRoom.roomKey
      })
    } catch (cause) {
      if (!mountedRef.current) return
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      onStatus(message)
    }
  }

  function showMessageActions (message: PeerChatMessage) {
    setIsMessageInfoVisible(false)
    setMessageActionTarget(message)
  }

  function replyToMessage (message: PeerChatMessage) {
    setMessageActionTarget(null)
    setReplyTarget({
      id: message.id,
      sender: message.sender,
      sn: message.senderName,
      text: message.message
    })
  }

  function copyMessageText (message: PeerChatMessage) {
    Clipboard.setString(message.message)
    setMessageActionTarget(null)
    onStatus('Message copied')
  }

  function showMessageInfo () {
    setIsMessageInfoVisible(true)
  }

  function sendReaction (messageId: string, emoji: string) {
    if (!activeRoom || isBusy) return
    const message = messages.find((item) => item.id === messageId)
    if (!message) return
    const currentEmoji = message.reactions?.find((reaction) => reaction.self)?.emoji

    void runAction(async () => {
      const response = await callRpc(RPC_PEERCHAT_REACT, {
        roomKey: activeRoom.roomKey,
        msgId: messageId,
        emoji: currentEmoji === emoji ? '' : emoji
      })
      if (!response.ok) throw new Error(response.error || 'Unable to update PeerChat reaction.')
      if (!mountedRef.current) return
      versionRef.current = -1
      await refreshRoom(true)
    })
  }

  function sendMessageActionReaction (messageId: string, emoji: string) {
    setMessageActionTarget(null)
    setReplyTarget(null)
    sendReaction(messageId, emoji)
  }

  function continueFromIntro () {
    try {
      if (!PEERCHAT_INTRO_FILE.exists) PEERCHAT_INTRO_FILE.create({ intermediates: true })
      PEERCHAT_INTRO_FILE.write(serializePeerChatIntroState())
    } catch (cause) {
      console.warn('Unable to save PeerChat intro state:', cause)
      onStatus('PeerChat will show the introduction again next time.')
    }
    setShowIntro(false)
  }

  function completeProfileOnboarding () {
    if (!profileName.trim() || isBusy) return
    void runAction(async () => {
      const response = await callRpc(RPC_PEERCHAT_ONBOARD, {
        username: profileName,
        bio: profileBio,
        avatar: profileAvatar,
        linkPreview: linkPreviewsEnabled
      })
      if (!response.ok || !response.profile || !response.rooms) {
        throw new Error(response.error || 'Unable to create PeerChat profile.')
      }
      if (!mountedRef.current) return
      setProfile(response.profile)
      setProfileName(response.profile.username)
      setProfileBio(response.profile.bio || '')
      setProfileAvatar(response.profile.avatar || null)
      setLinkPreviewsEnabled(response.profile.linkPreview !== false)
      setRooms(response.rooms)
      const notificationsAllowed = await onNotificationsEnabledChange(true)
      onStatus(notificationsAllowed
        ? 'PeerChat profile created and notifications enabled'
        : 'PeerChat profile created; notifications remain disabled')
    })
  }

  if (!isReady || !isIntroReady) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={[styles.helper, { color: colors.muted }]}>Starting PeerChat...</Text>
      </View>
    )
  }

  if (showIntro) {
    return (
      <View style={[styles.introScreen, { backgroundColor: colors.background }]}>
        <ScrollView contentContainerStyle={styles.introContent}>
          <Image source={PEERCHAT_ICON} style={styles.introLogo} />
          <Text style={[styles.introTitle, { color: colors.text }]}>Chat directly with your peers</Text>
          <View style={styles.introPoints}>
            {PEERCHAT_INTRO_POINTS.map((point, index) => (
              <View key={point} style={styles.introPointRow}>
                <View style={[styles.introPointNumber, { backgroundColor: colors.accentSoft }]}>
                  <Text style={[styles.introPointNumberText, { color: colors.accent }]}>{index + 1}</Text>
                </View>
                <Text style={[styles.introPointText, { color: colors.text }]}>{point}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
        <Pressable
          accessibilityRole='button'
          onPress={continueFromIntro}
          style={[styles.introContinue, { backgroundColor: colors.accent }]}
        >
          <Text style={styles.introContinueText}>Continue</Text>
        </Pressable>
      </View>
    )
  }

  if (isInitialized && !profile?.username) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.onboardingScreen, { backgroundColor: colors.background }]}
      >
        <ScrollView
          contentContainerStyle={styles.onboardingContent}
          keyboardShouldPersistTaps='handled'
        >
          <Image source={PEERCHAT_ICON} style={styles.onboardingLogo} />
          <Text style={[styles.onboardingTitle, { color: colors.text }]}>Set up your profile</Text>
          <Text style={[styles.onboardingHelper, { color: colors.muted }]}>Choose the name other peers will see in rooms and direct messages.</Text>
          <View style={styles.onboardingFields}>
            <Text style={[styles.onboardingLabel, { color: colors.text }]}>Name</Text>
            <TextInput
              autoCapitalize='words'
              autoCorrect={false}
              autoFocus
              maxLength={50}
              onChangeText={setProfileName}
              placeholder='Your display name'
              placeholderTextColor={colors.muted}
              returnKeyType='next'
              style={[styles.input, { backgroundColor: colors.input, color: colors.text }]}
              value={profileName}
            />
            <Text style={[styles.onboardingLabel, { color: colors.text }]}>Bio</Text>
            <TextInput
              maxLength={300}
              multiline
              onChangeText={setProfileBio}
              placeholder='A short bio (optional)'
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.onboardingBio, { backgroundColor: colors.input, color: colors.text }]}
              value={profileBio}
            />
          </View>
          {!!error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
        </ScrollView>
        <Pressable
          accessibilityRole='button'
          disabled={!profileName.trim() || isBusy}
          onPress={completeProfileOnboarding}
          style={[
            styles.introContinue,
            { backgroundColor: colors.accent },
            !profileName.trim() || isBusy ? styles.disabled : null
          ]}
        >
          {isBusy
            ? <ActivityIndicator color='#ffffff' />
            : <Text style={styles.introContinueText}>Continue</Text>}
        </Pressable>
      </KeyboardAvoidingView>
    )
  }

  if (activeRoom) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.chatHeader, { borderBottomColor: colors.border }]}> 
          <Pressable
            accessibilityRole='button'
            onPress={() => {
              setReplyTarget(null)
              setIsSearching(false)
              setSearchQuery('')
              setActiveRoom(null)
            }}
            style={styles.headerAction}
          >
            <BackIcon width={CHAT_HEADER_ICON_SIZE} height={CHAT_HEADER_ICON_SIZE} color={colors.accent} />
          </Pressable>
          <Pressable
            accessibilityHint={activeRoom.isDM ? 'Opens peer profile' : 'Opens room information'}
            accessibilityRole='button'
            onPress={openHeaderDetails}
            style={styles.chatHeaderCopy}
          >
            {activeRoom.avatar
              ? <Image source={{ uri: activeRoom.avatar }} style={styles.chatHeaderAvatar} />
              : (
                <View style={[styles.chatHeaderAvatar, styles.chatHeaderAvatarFallback, { backgroundColor: colors.accentSoft }]}>
                  <Text style={[styles.chatHeaderAvatarText, { color: colors.accent }]}>{getRoomInitials(activeRoom.name)}</Text>
                </View>
                )}
            <View style={styles.chatHeaderText}>
              <Text numberOfLines={1} style={[styles.chatTitle, { color: colors.text }]}>{activeRoom.name}</Text>
              <Text style={[
                styles.connectionText,
                { color: activeRoom.connectionState === 'connected' ? colors.success : colors.muted }
              ]}>
                {formatRoomConnection(activeRoom)}
              </Text>
            </View>
          </Pressable>
          <View style={styles.chatHeaderActions}>
            <Pressable
              accessibilityLabel={isSearching ? 'Close message search' : 'Find messages'}
              accessibilityRole='button'
              onPress={() => {
                setIsSearching((current) => !current)
                if (isSearching) setSearchQuery('')
              }}
              style={styles.headerAction}
            >
              {isSearching
                ? <CloseIcon width={CHAT_HEADER_ICON_SIZE} height={CHAT_HEADER_ICON_SIZE} color={colors.accent} />
                : <SearchIcon width={CHAT_HEADER_ICON_SIZE} height={CHAT_HEADER_ICON_SIZE} color={colors.accent} />}
            </Pressable>
            {!activeRoom.isDM && (
              <Pressable
                accessibilityHint='Shares a link that joins this room'
                accessibilityLabel='Share room'
                accessibilityRole='button'
                onPress={() => void shareRoom()}
                style={styles.headerAction}
              >
                <ShareIcon width={CHAT_HEADER_ICON_SIZE} height={CHAT_HEADER_ICON_SIZE} color={colors.accent} />
              </Pressable>
            )}
          </View>
        </View>

        <Modal
          animationType='fade'
          onDismiss={flushPendingModal}
          onRequestClose={() => setShowRoomInfo(false)}
          statusBarTranslucent
          transparent
          visible={showRoomInfo}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.roomInfoModalRoot}
          >
            <Pressable
              accessibilityLabel='Close room information'
              accessibilityRole='button'
              onPress={() => setShowRoomInfo(false)}
              style={styles.roomInfoBackdrop}
            />
            <SafeAreaView
              edges={['bottom', 'left', 'right']}
              style={[styles.roomInfoPanel, { backgroundColor: colors.surface }]}
            >
              <View style={[styles.roomInfoHeader, { borderBottomColor: colors.border }]}>
                <Text style={[styles.roomInfoHeading, { color: colors.text }]}>Room info</Text>
                <Pressable
                  accessibilityLabel='Close room information'
                  accessibilityRole='button'
                  hitSlop={8}
                  onPress={() => setShowRoomInfo(false)}
                  style={styles.roomInfoClose}
                >
                  <CloseIcon width={18} height={18} color={colors.muted} />
                </Pressable>
              </View>
              <ScrollView
                keyboardShouldPersistTaps='handled'
                contentContainerStyle={styles.roomInfo}
              >
            {activeRoom.isHost
              ? (
                <>
                  <Pressable
                    accessibilityRole='button'
                    onPress={() => chooseAvatar(editRoomAvatar, setEditRoomAvatar)}
                    style={styles.avatarEditor}
                  >
                    {editRoomAvatar
                      ? <Image source={{ uri: editRoomAvatar }} style={styles.avatarEditorImage} />
                      : <View style={[styles.avatarEditorImage, { backgroundColor: colors.accentSoft }]} />}
                    <Text style={[styles.memberMessage, { color: colors.accent }]}>Change room image</Text>
                  </Pressable>
                  <TextInput
                    maxLength={80}
                    onChangeText={setEditRoomName}
                    placeholder='Room name'
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { backgroundColor: colors.input, color: colors.text }]}
                    value={editRoomName}
                  />
                  <TextInput
                    maxLength={300}
                    multiline
                    onChangeText={setEditRoomBio}
                    placeholder='Room description (optional)'
                    placeholderTextColor={colors.muted}
                    style={[styles.input, styles.bioInput, { backgroundColor: colors.input, color: colors.text }]}
                    value={editRoomBio}
                  />
                  <TextInput
                    autoCapitalize='none'
                    autoCorrect={false}
                    maxLength={512}
                    onChangeText={setEditRoomLink}
                    placeholder='https:// link (optional)'
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { backgroundColor: colors.input, color: colors.text }]}
                    value={editRoomLink}
                  />
                  <Pressable
                    accessibilityRole='button'
                    disabled={!editRoomName.trim() || isBusy}
                    onPress={saveRoomDetails}
                    style={[styles.roomInfoSave, { backgroundColor: colors.accent }, !editRoomName.trim() || isBusy ? styles.disabled : null]}
                  >
                    <Text style={styles.profileSaveText}>Save room details</Text>
                  </Pressable>
                </>
                )
              : (
                <>
                  <Text style={[styles.roomInfoTitle, { color: colors.text }]}>{activeRoom.name}</Text>
                  {!!activeRoom.bio && <Text style={[styles.helper, { color: colors.muted }]}>{activeRoom.bio}</Text>}
                  {!!activeRoom.link && (
                    <Pressable accessibilityRole='link' onPress={() => onOpenUrl(activeRoom.link)}>
                      <Text numberOfLines={1} style={[styles.roomInfoLink, { color: colors.accent }]}>{activeRoom.link}</Text>
                    </Pressable>
                  )}
                  {!activeRoom.bio && !activeRoom.link && (
                    <Text style={[styles.helper, { color: colors.muted }]}>No room details shared.</Text>
                  )}
                </>
                )}
            {!activeRoom.isDM && (
              <View style={styles.roomProvenance}>
                <Text style={[styles.helper, { color: colors.muted }]}>
                  Created by {activeRoom.createdByName || 'Unknown'}{formatRoomCreatedAt(activeRoom.createdAt)}
                </Text>
                <Pressable
                  accessibilityRole='button'
                  onPress={() => {
                    Clipboard.setString(activeRoom.roomKey)
                    onStatus('PeerChat room key copied')
                  }}
                >
                  <Text style={[styles.memberMessage, { color: colors.accent }]}>Copy room key</Text>
                </Pressable>
                <Text style={[styles.roomInfoTitle, { color: colors.text }]}>Moderation</Text>
                <Text style={[styles.helper, { color: colors.muted }]}>Abuse filter: {activeRoom.moderation.abuseFilter ? 'On' : 'Off'}</Text>
                <Text style={[styles.helper, { color: colors.muted }]}>Profanity &amp; slurs: {activeRoom.moderation.nsfwFilter ? 'On' : 'Off'}</Text>
                <Text style={[styles.helper, { color: colors.muted }]}>Spam limit: {activeRoom.moderation.spamRateLimit} messages / 10 seconds</Text>
                <Text style={[styles.helper, { color: colors.muted }]}>Adult-domain links: Always blocked</Text>
              </View>
            )}
            {activeRoom.members.length > 0 && (
              <View style={styles.memberList}>
                <Text style={[styles.roomInfoTitle, { color: colors.text }]}>
                  People ({activeRoom.members.length})
                </Text>
                <TextInput
                  autoCapitalize='none'
                  autoCorrect={false}
                  maxLength={PEERCHAT_SEARCH_QUERY_MAX_CHARACTERS}
                  onChangeText={setMemberSearchQuery}
                  placeholder='Search people'
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { backgroundColor: colors.input, color: colors.text }]}
                  value={memberSearchQuery}
                />
                {visibleMembers.map((member) => (
                  <Pressable
                    accessibilityHint='Opens peer profile'
                    accessibilityRole='button'
                    key={member.id}
                    onPress={() => replaceModal(() => setShowRoomInfo(false), () => setProfileTarget(member))}
                    style={[styles.memberRow, { backgroundColor: colors.input }]}
                  >
                    <View style={styles.memberAvatarWrap}>
                      {member.avatar
                        ? <Image source={{ uri: member.avatar }} style={styles.memberAvatar} />
                        : (
                          <View style={[styles.memberAvatarFallback, { backgroundColor: colors.accentSoft }]}>
                            <Text style={[styles.memberAvatarText, { color: colors.accent }]}>{getRoomInitials(member.username)}</Text>
                          </View>
                          )}
                      <View style={[styles.onlineDot, { backgroundColor: member.online ? colors.success : colors.muted }]} />
                    </View>
                    <View style={styles.memberCopy}>
                      <Text style={[styles.memberName, { color: colors.text }]}>{member.username}</Text>
                      <Text numberOfLines={1} style={[styles.attachmentMeta, { color: colors.muted }]}>
                        {member.bio || (member.online ? 'Online' : 'Offline')}
                      </Text>
                    </View>
                    <Text style={[styles.memberMessage, { color: member.self ? colors.muted : colors.accent }]}>
                      {member.self ? 'You' : 'Message'}
                    </Text>
                  </Pressable>
                ))}
                {visibleMembers.length === 0 && (
                  <Text style={[styles.helper, { color: colors.muted }]}>No matching people.</Text>
                )}
              </View>
            )}
              </ScrollView>
            </SafeAreaView>
          </KeyboardAvoidingView>
        </Modal>

        {activeRoom.isDM && activeRoom.pendingAcceptance && (
          <Text style={[styles.dmStatus, { color: colors.muted, backgroundColor: colors.surface }]}>Waiting for this peer to accept your message request.</Text>
        )}

        {moderationWarning && (
          <View style={[styles.moderationWarning, { backgroundColor: colors.surface, borderColor: colors.danger }]}>
            <Text numberOfLines={2} style={[styles.moderationWarningText, { color: colors.text }]}>
              Message blocked: {moderationWarning}
            </Text>
            <Pressable
              accessibilityLabel='Dismiss moderation warning'
              accessibilityRole='button'
              hitSlop={8}
              onPress={() => setModerationWarning(null)}
              style={styles.moderationWarningClose}
            >
              <CloseIcon width={16} height={16} color={colors.muted} />
            </Pressable>
          </View>
        )}
        {activeRoom.isDM && activeRoom.rejected && (
          <Text style={[styles.dmStatus, { color: colors.danger, backgroundColor: colors.surface }]}>This peer declined the message request.</Text>
        )}

        {offlineDirectPeer && !isDirectMessageBlocked && !activeRoom.rejected && (
          <Text style={[styles.dmStatus, { color: colors.muted, backgroundColor: colors.surface }]}>
            {offlineDirectPeer.username} is offline. Your message arrives the next time you are both online
            {Platform.OS === 'ios'
              ? ', and iOS suspends apps in the background, so keep PeerSky open.'
              : ', so keep PeerSky running in the background.'}
          </Text>
        )}

        {isDirectMessageBlocked && (
          <Text style={[styles.dmStatus, { color: colors.danger, backgroundColor: colors.surface }]}>
            {blockedTheDirectMessage
              ? 'You blocked this person. Unblock them in PeerChat settings to message them again.'
              : 'This peer blocked your direct messages. Open their profile and tap Message to ask again.'}
          </Text>
        )}

        {isSearching && (
          <View style={[styles.searchRow, { borderBottomColor: colors.border }]}>
            <TextInput
              autoFocus
              maxLength={PEERCHAT_SEARCH_QUERY_MAX_CHARACTERS}
              onChangeText={setSearchQuery}
              placeholder='Search messages'
              placeholderTextColor={colors.muted}
              returnKeyType='search'
              style={[styles.searchInput, { backgroundColor: colors.input, color: colors.text }]}
              value={searchQuery}
            />
            <Text style={[styles.searchCount, { color: colors.muted }]}>
              {searchQuery.trim() ? visibleMessages.length : messages.length}
            </Text>
          </View>
        )}

        <View style={styles.messageListContainer}>
          <FlatList
          ref={messageListRef}
          data={displayedMessages}
          inverted
          keyExtractor={(item) => item.id}
          contentContainerStyle={displayedMessages.length > 0 ? styles.messageList : styles.emptyMessageList}
          onContentSizeChange={() => {
            if (isSearching) return
            if (isNearMessageBottomRef.current) {
              messageListRef.current?.scrollToOffset({ animated: false, offset: 0 })
            }
          }}
          onScroll={({ nativeEvent }) => {
            if (isSearching) return
            const nearBottom = nativeEvent.contentOffset.y <= 80
            if (nearBottom === isNearMessageBottomRef.current) return
            isNearMessageBottomRef.current = nearBottom
            setShowScrollToLatest(!nearBottom)
          }}
          scrollEventThrottle={100}
          onScrollToIndexFailed={({ averageItemLength, index }) => {
            messageListRef.current?.scrollToOffset({
              animated: false,
              offset: Math.max(0, averageItemLength * index)
            })
          }}
          renderItem={({ item, index }) => {
            const dateLabel = formatPeerChatDateLabel(item.timestamp)
            const previousDateLabel = index < displayedMessages.length - 1
              ? formatPeerChatDateLabel(displayedMessages[index + 1].timestamp)
              : ''
            const senderMember = !item.self && !item.system
              ? activeRoom.members.find((member) => member.id === item.sender)
              : null
            return (
              <>
              {!!dateLabel && dateLabel !== previousDateLabel && (
                <View accessibilityRole='text' style={styles.dateDivider}>
                  <View style={[styles.dateDividerLine, { backgroundColor: colors.border }]} />
                  <Text style={[styles.dateDividerText, { color: colors.muted }]}>{dateLabel}</Text>
                  <View style={[styles.dateDividerLine, { backgroundColor: colors.border }]} />
                </View>
              )}
              <View style={[styles.messageRow, item.self ? styles.messageRowSelf : null, item.system ? styles.systemMessageRow : null]}>
              <Pressable
                accessibilityHint='Long press for message actions'
                accessibilityRole={item.system ? 'text' : 'button'}
                disabled={item.system}
                onLongPress={() => !item.system && showMessageActions(item)}
                style={[
                  styles.messageBubble,
                  item.system ? styles.systemMessage : null,
                  { backgroundColor: item.system ? colors.input : item.self ? colors.selfBubble : colors.peerBubble }
                ]}
              >
                {!item.self && !item.system && (
                  <Pressable
                    accessibilityHint={`Opens ${item.senderName}'s profile`}
                    accessibilityRole='button'
                    hitSlop={4}
                    onPress={() => openMessageSenderProfile(item)}
                  >
                    <View style={styles.messageSenderRow}>
                      {senderMember?.avatar
                        ? <Image source={{ uri: senderMember.avatar }} style={styles.messageSenderAvatar} />
                        : (
                          <View style={[styles.messageSenderAvatarFallback, { backgroundColor: colors.accentSoft }]}>
                            <Text style={[styles.messageSenderAvatarText, { color: colors.accent }]}>{getRoomInitials(item.senderName)}</Text>
                          </View>
                          )}
                      <Text style={[styles.senderName, { color: colors.accent }]}>{item.senderName}</Text>
                    </View>
                  </Pressable>
                )}
                {item.replyTo && (
                  <View style={[styles.quotedReply, { borderLeftColor: colors.accent, backgroundColor: colors.input }]}>
                    <Text numberOfLines={1} style={[styles.quotedReplySender, { color: colors.accent }]}>
                      {item.replyTo.sn || item.replyTo.sender}
                    </Text>
                    <Text numberOfLines={2} style={[styles.quotedReplyText, { color: colors.muted }]}>
                      {item.replyTo.text}
                    </Text>
                  </View>
                )}
                {item.fileName
                  ? (
                    <PeerChatAttachment
                      colors={colors}
                      item={item}
                      onCallRpc={callRpc}
                      onOpenLocalFile={onOpenLocalFile}
                      onOpenUrl={onOpenUrl}
                      onStatus={onStatus}
                      roomKey={activeRoom.roomKey}
                      onViewMedia={setMediaTarget}
                    />
                    )
                  : (
                    <>
                      <Text style={[styles.messageText, { color: colors.text }]}>
                        {renderMessageText(
                          item.message,
                          [profile?.username || '', ...activeRoom.members.map((member) => member.username)],
                          colors.text,
                          colors.accent
                        )}
                      </Text>
                      <PeerChatLinkCard
                        colors={colors}
                        message={item.message}
                        onOpenUrl={onOpenUrl}
                        preview={item.preview}
                      />
                    </>
                    )}
              </Pressable>
              {item.reactions && item.reactions.length > 0 && (
                <View style={[styles.reactionRow, item.self ? styles.reactionRowSelf : null]}>
                  {item.reactions.map((reaction) => (
                    <Pressable
                      accessibilityLabel={`${reaction.emoji}, ${reaction.count} reaction${reaction.count === 1 ? '' : 's'}`}
                      accessibilityRole='button'
                      disabled={isBusy}
                      key={reaction.emoji}
                      onPress={() => sendReaction(item.id, reaction.emoji)}
                      style={[
                        styles.reactionBubble,
                        {
                          backgroundColor: reaction.self ? colors.accentSoft : colors.surface,
                          borderColor: reaction.self ? colors.accent : colors.border
                        },
                        isBusy ? styles.disabled : null
                      ]}
                    >
                      <Text style={[styles.reactionText, { color: colors.text }]}>{reaction.emoji} {reaction.count}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Text style={[styles.messageTime, item.system ? styles.systemMessageTime : null, { color: colors.muted }]}>
                {formatMessageTime(item.timestamp)}
              </Text>
              </View>
              </>
            )
          }}
          ListEmptyComponent={(
            <View style={styles.emptyState}>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {isSearching && searchQuery.trim() ? 'No matching messages' : 'No messages yet'}
              </Text>
              <Text style={[styles.helper, { color: colors.muted }]}>
                {isSearching && searchQuery.trim()
                  ? 'Try another search term.'
                  : 'Share the room key, then start the conversation.'}
              </Text>
            </View>
          )}
          />
          {showScrollToLatest && !isSearching && (
            <Pressable
              accessibilityHint='Scrolls to the newest message'
              accessibilityRole='button'
              onPress={() => {
                isNearMessageBottomRef.current = true
                setShowScrollToLatest(false)
                messageListRef.current?.scrollToOffset({ animated: true, offset: 0 })
              }}
              style={[styles.scrollToLatest, { backgroundColor: colors.accent }]}
            >
              <LatestIcon width={18} height={18} color='#ffffff' />
            </Pressable>
          )}
        </View>

        {error && <Text style={[styles.inlineError, { color: colors.danger }]}>{error}</Text>}

        {replyTarget && (
          <View style={[styles.replyComposer, { borderTopColor: colors.border, backgroundColor: colors.input }]}>
            <View style={styles.replyComposerCopy}>
              <Text numberOfLines={1} style={[styles.quotedReplySender, { color: colors.accent }]}>
                Replying to {replyTarget.sn || replyTarget.sender}
              </Text>
              <Text numberOfLines={1} style={[styles.quotedReplyText, { color: colors.muted }]}>
                {replyTarget.text}
              </Text>
            </View>
            <Pressable
              accessibilityLabel='Cancel reply'
              accessibilityRole='button'
              hitSlop={8}
              onPress={() => setReplyTarget(null)}
              style={styles.cancelReply}
            >
              <Text style={[styles.cancelReplyText, { color: colors.muted }]}>x</Text>
            </Pressable>
          </View>
        )}
        {mentionCandidates.length > 0 && (
          <View style={[styles.mentionSuggestions, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
            <ScrollView horizontal keyboardShouldPersistTaps='handled' showsHorizontalScrollIndicator={false}>
              <View style={styles.mentionSuggestionRow}>
                {mentionCandidates.map((member) => (
                  <Pressable
                    accessibilityLabel={`Mention ${member.username}`}
                    accessibilityRole='button'
                    key={member.id}
                    onPress={() => setComposer((current) => insertMention(current, member.username))}
                    style={[styles.mentionSuggestion, { backgroundColor: colors.accentSoft }]}
                  >
                    <Text style={[styles.mentionSuggestionText, { color: colors.accent }]}>@{member.username}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
        )}
        {showComposerEmoji && (
          <View style={[styles.emojiPanel, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.emojiQuickRow}>
              {QUICK_REACTIONS.map((emoji) => (
                <Pressable
                  accessibilityLabel={`Insert ${emoji}`}
                  accessibilityRole='button'
                  key={emoji}
                  onPress={() => insertComposerEmoji(emoji)}
                  style={styles.reactionPickerButton}
                >
                  <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              autoCapitalize='none'
              autoCorrect={false}
              maxLength={PEERCHAT_EMOJI_SEARCH_MAX_CHARACTERS}
              onChangeText={setEmojiSearchQuery}
              placeholder='Search emoji, e.g. cat'
              placeholderTextColor={colors.muted}
              style={[styles.emojiSearch, { backgroundColor: colors.input, color: colors.text }]}
              value={emojiSearchQuery}
            />
            <FlatList
              contentContainerStyle={styles.emojiGrid}
              data={visibleEmoji}
              initialNumToRender={64}
              keyboardShouldPersistTaps='handled'
              keyExtractor={(item) => item.emoji}
              ListEmptyComponent={<Text style={[styles.emojiEmpty, { color: colors.muted }]}>No emoji found</Text>}
              maxToRenderPerBatch={64}
              numColumns={8}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityLabel={`Insert ${item.keywords[0]?.replaceAll('_', ' ') || item.emoji}`}
                  accessibilityRole='button'
                  onPress={() => insertComposerEmoji(item.emoji)}
                  style={styles.emojiGridButton}
                >
                  <Text style={styles.reactionPickerEmoji}>{item.emoji}</Text>
                </Pressable>
              )}
              style={styles.emojiGridList}
              windowSize={4}
            />
          </View>
        )}
        <View style={[styles.composer, { borderTopColor: colors.border }]}> 
          <Pressable
            accessibilityLabel='Choose emoji'
            accessibilityRole='button'
            disabled={isBusy || activeRoom.pendingAcceptance || activeRoom.rejected || isDirectMessageBlocked}
            onPress={() => {
              setEmojiSearchQuery('')
              setShowComposerEmoji((current) => !current)
            }}
            style={[styles.emojiButton, { backgroundColor: colors.input }]}
          >
            <Text style={[styles.emojiButtonText, { color: colors.accent }]}>:)</Text>
          </Pressable>
          <Pressable
            accessibilityLabel='Attach file'
            accessibilityRole='button'
            disabled={isBusy || activeRoom.pendingAcceptance || activeRoom.rejected || isDirectMessageBlocked}
            onPress={attachFile}
            style={[
              styles.attachButton,
              { backgroundColor: colors.input },
              isBusy || activeRoom.pendingAcceptance || activeRoom.rejected || isDirectMessageBlocked ? styles.disabled : null
            ]}
          >
            <Text style={[styles.attachButtonText, { color: colors.accent }]}>+</Text>
          </Pressable>
          <TextInput
            value={composer}
            onChangeText={setComposer}
            placeholder='Message'
            placeholderTextColor={colors.muted}
            multiline
            editable={!activeRoom.pendingAcceptance && !activeRoom.rejected && !isDirectMessageBlocked}
            maxLength={64 * 1024}
            style={[
              styles.composerInput,
              { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }
            ]}
          />
          <Pressable
            accessibilityRole='button'
            disabled={!composer.trim() || isBusy || activeRoom.pendingAcceptance || activeRoom.rejected || isDirectMessageBlocked}
            onPress={sendMessage}
            style={[
              styles.sendButton,
              { backgroundColor: colors.accent },
              !composer.trim() || isBusy || activeRoom.pendingAcceptance || activeRoom.rejected || isDirectMessageBlocked ? styles.disabled : null
            ]}
          >
            <SendIcon width={20} height={20} color='#ffffff' />
          </Pressable>
        </View>
        <Modal
          animationType='fade'
          onRequestClose={() => setMessageActionTarget(null)}
          statusBarTranslucent
          transparent
          visible={messageActionTarget !== null}
        >
          <View accessibilityViewIsModal style={styles.actionSheetRoot}>
            <Pressable
              accessibilityLabel='Close message actions'
              accessibilityRole='button'
              onPress={() => setMessageActionTarget(null)}
              style={styles.actionSheetBackdrop}
            />
            {messageActionTarget && (
              <SafeAreaView
                edges={['bottom', 'left', 'right']}
                style={[styles.actionSheet, { backgroundColor: colors.surface }]}
              >
                <Text numberOfLines={1} style={[styles.actionSheetTitle, { color: colors.text }]}>
                  {messageActionTarget.self ? 'You' : messageActionTarget.senderName}
                </Text>
                <Text numberOfLines={2} style={[styles.actionSheetPreview, { color: colors.muted }]}>
                  {Array.from(messageActionTarget.message).slice(0, 200).join('')}
                </Text>
                {!isMessageInfoVisible && (
                  <View style={[styles.actionSheetReactionRow, { backgroundColor: colors.input }]}>
                    {QUICK_REACTIONS.map((emoji) => (
                      <Pressable
                        accessibilityLabel={`React with ${emoji}`}
                        accessibilityRole='button'
                        disabled={isBusy}
                        key={emoji}
                        onPress={() => sendMessageActionReaction(messageActionTarget.id, emoji)}
                        style={[styles.reactionPickerButton, isBusy ? styles.disabled : null]}
                      >
                        <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                <View style={[styles.actionSheetDivider, { backgroundColor: colors.border }]} />
                {isMessageInfoVisible
                  ? (
                    <>
                      <Text style={[styles.actionSheetDetails, { color: colors.text }]}>
                        {formatPeerChatMessageDetails(messageActionTarget.timestamp)}
                      </Text>
                      <Pressable accessibilityRole='button' onPress={() => setIsMessageInfoVisible(false)} style={styles.actionSheetAction}>
                        <Text style={[styles.actionSheetActionText, { color: colors.accent }]}>Back</Text>
                      </Pressable>
                    </>
                    )
                  : (
                    <>
                      <Pressable accessibilityRole='button' onPress={() => replyToMessage(messageActionTarget)} style={styles.actionSheetAction}>
                        <Text style={[styles.actionSheetActionText, { color: colors.text }]}>Reply</Text>
                      </Pressable>
                      <Pressable accessibilityRole='button' onPress={() => copyMessageText(messageActionTarget)} style={styles.actionSheetAction}>
                        <Text style={[styles.actionSheetActionText, { color: colors.text }]}>Copy text</Text>
                      </Pressable>
                      <Pressable accessibilityRole='button' onPress={showMessageInfo} style={styles.actionSheetAction}>
                        <Text style={[styles.actionSheetActionText, { color: colors.text }]}>Info</Text>
                      </Pressable>
                      <Pressable accessibilityRole='button' onPress={() => setMessageActionTarget(null)} style={styles.actionSheetAction}>
                        <Text style={[styles.actionSheetActionText, { color: colors.accent }]}>Cancel</Text>
                      </Pressable>
                    </>
                    )}
              </SafeAreaView>
            )}
          </View>
        </Modal>
        <PeerProfileModal
          colors={colors}
          isBlocked={isMemberBlocked(profileTarget)}
          member={profileTarget}
          onBlock={blockMember}
          onClose={() => setProfileTarget(null)}
          onDismiss={flushPendingModal}
          onMessage={(member) => {
            setProfileTarget(null)
            startDirectMessage(member)
          }}
          onReport={reportMember}
          onUnblock={unblockMember}
          onViewAvatar={viewProfileAvatar}
        />
        <PeerChatMediaViewer
          onClose={() => setMediaTarget(null)}
          target={mediaTarget}
        />
      </View>
    )
  }

  return (
    <>
      <FlatList
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.landingContent}
      data={visibleRooms}
      keyExtractor={(item) => item.roomKey}
      ListHeaderComponent={(
        <View style={styles.landingHeader}>
          <View style={styles.titleRow}>
            <Image source={PEERCHAT_ICON} style={styles.logo} />
            <Text style={[styles.title, styles.titleCopy, { color: colors.text }]}>PeerChat</Text>
            <Pressable
              accessibilityLabel='PeerChat settings'
              accessibilityRole='button'
              hitSlop={8}
              onPress={openPeerChatSettings}
              style={styles.settingsButton}
            >
              <SettingsIcon width={22} height={22} color={colors.muted} />
            </Pressable>
          </View>

          <Pressable
            accessibilityHint='Opens your PeerChat profile'
            accessibilityRole='button'
            onPress={() => {
              if (!profile?.username) {
                openPeerChatSettings()
                return
              }
              setProfileTarget({
                id: profile.id,
                username: profile.username,
                bio: profile.bio || '',
                avatar: profile.avatar || null,
                self: true,
                online: true
              })
            }}
            style={styles.profileSummary}
          >
            {profileAvatar
              ? <Image source={{ uri: profileAvatar }} style={styles.profileAvatar} />
              : (
                <View style={[styles.profileAvatar, styles.profileAvatarFallback, { backgroundColor: colors.accentSoft }]}>
                  <Text style={[styles.roomAvatarText, { color: colors.accent }]}>{getRoomInitials(profileName)}</Text>
                </View>
                )}
            <Text numberOfLines={1} style={[styles.profileSummaryName, { color: colors.text }]}>
              {profileName || 'Set up your profile'}
            </Text>
          </Pressable>

          <Modal
            animationType='fade'
            onRequestClose={() => {
              if (settingsPage === 'about') {
                setSettingsPage('main')
                return
              }
              setShowPeerChatSettings(false)
            }}
            statusBarTranslucent
            transparent
            visible={showPeerChatSettings}
          >
            <KeyboardAvoidingView
              behavior='padding'
              style={styles.roomInfoModalRoot}
            >
              <Pressable
                accessibilityLabel='Close PeerChat settings'
                accessibilityRole='button'
                onPress={() => setShowPeerChatSettings(false)}
                style={styles.roomInfoBackdrop}
              />
              <SafeAreaView
                edges={['bottom', 'left', 'right']}
                style={[styles.roomInfoPanel, { backgroundColor: colors.surface }]}
              >
                <View style={[styles.roomInfoHeader, { borderBottomColor: colors.border }]}>
                  {settingsPage === 'about' && (
                    <Pressable
                      accessibilityLabel='Back to PeerChat settings'
                      accessibilityRole='button'
                      hitSlop={8}
                      onPress={() => setSettingsPage('main')}
                      style={styles.aboutBack}
                    >
                      <BackIcon width={18} height={18} color={colors.accent} />
                    </Pressable>
                  )}
                  <Text style={[styles.roomInfoHeading, { color: colors.text }]}>
                    {settingsPage === 'about' ? 'About PeerChat' : 'PeerChat settings'}
                  </Text>
                  <Pressable
                    accessibilityLabel='Close PeerChat settings'
                    accessibilityRole='button'
                    hitSlop={8}
                    onPress={() => setShowPeerChatSettings(false)}
                    style={styles.roomInfoClose}
                  >
                    <CloseIcon width={18} height={18} color={colors.muted} />
                  </Pressable>
                </View>
                {settingsPage === 'about' && (
                  <PeerChatAboutPage colors={colors} />
                )}
                {settingsPage === 'main' && (
                <ScrollView keyboardShouldPersistTaps='handled' contentContainerStyle={styles.profileSettings}>
                  <View style={styles.profileRow}>
                    <Pressable
                      accessibilityLabel='Change profile image'
                      accessibilityRole='button'
                      onPress={() => chooseAvatar(profileAvatar, setProfileAvatar)}
                    >
                      {profileAvatar
                        ? <Image source={{ uri: profileAvatar }} style={styles.profileAvatar} />
                        : (
                          <View style={[styles.profileAvatar, styles.profileAvatarFallback, { backgroundColor: colors.accentSoft }]}>
                            <Text style={[styles.roomAvatarText, { color: colors.accent }]}>{getRoomInitials(profileName)}</Text>
                          </View>
                          )}
                    </Pressable>
                    <TextInput
                      value={profileName}
                      onChangeText={setProfileName}
                      autoCapitalize='words'
                      autoCorrect={false}
                      maxLength={50}
                      placeholder='Your display name'
                      placeholderTextColor={colors.muted}
                      style={[styles.input, styles.profileInput, { backgroundColor: colors.input, color: colors.text }]}
                    />
                  </View>
                  <TextInput
                    maxLength={300}
                    multiline
                    onChangeText={setProfileBio}
                    placeholder='Bio (optional)'
                    placeholderTextColor={colors.muted}
                    style={[styles.input, styles.bioInput, { backgroundColor: colors.input, color: colors.text }]}
                    value={profileBio}
                  />
                  <Pressable
                    accessibilityRole='switch'
                    accessibilityState={{ checked: linkPreviewsEnabled }}
                    onPress={() => setLinkPreviewsEnabled((enabled) => !enabled)}
                    style={[styles.preferenceRow, { backgroundColor: colors.input }]}
                  >
                    <View style={styles.preferenceCopy}>
                      <Text style={[styles.memberName, { color: colors.text }]}>Link previews</Text>
                      <Text style={[styles.attachmentMeta, { color: colors.muted }]}>Fetch page details only when you send a link</Text>
                    </View>
                    <Text style={[styles.preferenceState, { color: linkPreviewsEnabled ? colors.accent : colors.muted }]}>
                      {linkPreviewsEnabled ? 'On' : 'Off'}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole='switch'
                    accessibilityState={{ checked: notificationsEnabled, disabled: !notificationPreferencesReady || isBusy }}
                    disabled={!notificationPreferencesReady || isBusy}
                    onPress={changeNotifications}
                    style={[styles.preferenceRow, { backgroundColor: colors.input }, !notificationPreferencesReady || isBusy ? styles.disabled : null]}
                  >
                    <View style={styles.preferenceCopy}>
                      <Text style={[styles.memberName, { color: colors.text }]}>Message notifications</Text>
                      <Text style={[styles.attachmentMeta, { color: colors.muted }]}>
                        {Platform.OS === 'ios'
                          ? 'Background delivery is best effort and stops when iOS suspends PeerSky'
                          : 'Keep PeerChat connected and notify for unread messages in the background'}
                      </Text>
                    </View>
                    <Text style={[styles.preferenceState, { color: notificationsEnabled ? colors.accent : colors.muted }]}>
                      {notificationsEnabled ? 'On' : 'Off'}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole='switch'
                    accessibilityState={{ checked: soundsEnabled, disabled: isBusy }}
                    disabled={isBusy}
                    onPress={changeNotificationSounds}
                    style={[styles.preferenceRow, { backgroundColor: colors.input }, isBusy ? styles.disabled : null]}
                  >
                    <View style={styles.preferenceCopy}>
                      <Text style={[styles.memberName, { color: colors.text }]}>Chat sounds</Text>
                      <Text style={[styles.attachmentMeta, { color: colors.muted }]}>Play a sound when messages are sent or received</Text>
                    </View>
                    <Text style={[styles.preferenceState, { color: soundsEnabled ? colors.accent : colors.muted }]}>
                      {soundsEnabled ? 'On' : 'Off'}
                    </Text>
                  </Pressable>
                  {blockedPeers.length > 0 && (
                    <View style={styles.settingsSection}>
                      <Text style={[styles.settingsSectionTitle, { color: colors.muted }]}>Blocked people</Text>
                      {blockedPeers.map((blocked) => (
                        <View key={blocked.peerId} style={[styles.preferenceRow, { backgroundColor: colors.input }]}>
                          <View style={styles.preferenceCopy}>
                            <Text numberOfLines={1} style={[styles.memberName, { color: colors.text }]}>{blocked.username}</Text>
                            <Text style={[styles.attachmentMeta, { color: colors.muted }]}>Their direct messages are blocked</Text>
                          </View>
                          <Pressable
                            accessibilityRole='button'
                            disabled={isBusy}
                            onPress={() => void unblockPeerId(blocked.peerId, blocked.username)}
                          >
                            <Text style={[styles.preferenceState, { color: colors.accent }]}>Unblock</Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}
                  <Pressable
                    accessibilityHint='Explains how PeerChat works'
                    accessibilityRole='button'
                    onPress={() => setSettingsPage('about')}
                    style={[styles.preferenceRow, { backgroundColor: colors.input }]}
                  >
                    <View style={styles.preferenceCopy}>
                      <Text style={[styles.memberName, { color: colors.text }]}>About PeerChat</Text>
                      <Text style={[styles.attachmentMeta, { color: colors.muted }]}>How it works, in plain words</Text>
                    </View>
                    <Text style={[styles.preferenceState, { color: colors.muted }]}>›</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole='link'
                    onPress={() => onOpenUrl(PEERCHAT_SOURCE_URL)}
                    style={[styles.preferenceRow, { backgroundColor: colors.input }]}
                  >
                    <View style={styles.preferenceCopy}>
                      <Text style={[styles.memberName, { color: colors.text }]}>Source code</Text>
                      <Text style={[styles.attachmentMeta, { color: colors.muted }]}>Anyone can read how this works</Text>
                    </View>
                    <Text style={[styles.preferenceState, { color: colors.accent }]}>Open</Text>
                  </Pressable>
                  {error && <Text accessibilityRole='alert' style={[styles.modalError, { color: colors.danger }]}>{error}</Text>}
                  {(profile?.username !== profileName.trim() ||
                    (profile?.bio || '') !== profileBio.trim() ||
                    (profile?.avatar || null) !== profileAvatar ||
                    profile?.linkPreview !== linkPreviewsEnabled) && (
                      <Pressable
                        accessibilityRole='button'
                        disabled={!profileName.trim() || isBusy}
                        onPress={() => void runAction(async () => {
                          await saveProfile()
                          setShowPeerChatSettings(false)
                        })}
                        style={[styles.profileSaveButton, { backgroundColor: colors.accent }, !profileName.trim() || isBusy ? styles.disabled : null]}
                      >
                        <Text style={styles.profileSaveText}>Save changes</Text>
                      </Pressable>
                  )}
                </ScrollView>
                )}
              </SafeAreaView>
            </KeyboardAvoidingView>
          </Modal>

          <View style={styles.quickActions}>
            <Pressable
              accessibilityRole='button'
              onPress={() => setLandingAction((current) => current === 'create' ? null : 'create')}
              style={[
                styles.quickAction,
                { backgroundColor: landingAction === 'create' ? colors.accent : colors.surface }
              ]}
            >
              <Text style={[styles.quickActionSymbol, { color: landingAction === 'create' ? '#ffffff' : colors.accent }]}>+</Text>
              <Text style={[styles.quickActionText, { color: landingAction === 'create' ? '#ffffff' : colors.text }]}>Create group</Text>
            </Pressable>
            <Pressable
              accessibilityRole='button'
              onPress={() => setLandingAction((current) => current === 'join' ? null : 'join')}
              style={[
                styles.quickAction,
                { backgroundColor: landingAction === 'join' ? colors.accent : colors.surface }
              ]}
            >
              <Text style={[styles.quickActionSymbol, { color: landingAction === 'join' ? '#ffffff' : colors.accent }]}>#</Text>
              <Text style={[styles.quickActionText, { color: landingAction === 'join' ? '#ffffff' : colors.text }]}>Join group</Text>
            </Pressable>
          </View>

          {landingAction === 'create' && (
            <View style={[styles.actionPanel, styles.createActionPanel, { backgroundColor: colors.surface }]}>
              <Pressable
                accessibilityRole='button'
                onPress={() => chooseAvatar(roomAvatar, setRoomAvatar)}
                style={styles.avatarEditor}
              >
                {roomAvatar
                  ? <Image source={{ uri: roomAvatar }} style={styles.avatarEditorImage} />
                  : <View style={[styles.avatarEditorImage, { backgroundColor: colors.accentSoft }]} />}
                <Text style={[styles.memberMessage, { color: colors.accent }]}>Add group image</Text>
              </Pressable>
              <TextInput
                value={roomName}
                onChangeText={setRoomName}
                maxLength={80}
                placeholder='Group name'
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.createActionInput, { backgroundColor: colors.input, color: colors.text }]}
              />
              <TextInput
                value={roomBio}
                onChangeText={setRoomBio}
                maxLength={300}
                placeholder='Group description (optional)'
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.createActionInput, { backgroundColor: colors.input, color: colors.text }]}
              />
              <TextInput
                value={roomLink}
                onChangeText={setRoomLink}
                autoCapitalize='none'
                autoCorrect={false}
                maxLength={512}
                placeholder='https:// link (optional)'
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.createActionInput, { backgroundColor: colors.input, color: colors.text }]}
              />
              <Text style={[styles.actionSectionTitle, { color: colors.text }]}>Room moderation</Text>
              <Pressable
                accessibilityRole='switch'
                accessibilityState={{ checked: roomAbuseFilter }}
                onPress={() => setRoomAbuseFilter((enabled) => !enabled)}
                style={[styles.preferenceRow, { backgroundColor: colors.input }]}
              >
                <View style={styles.preferenceCopy}>
                  <Text style={[styles.memberName, { color: colors.text }]}>Abuse filter</Text>
                  <Text style={[styles.attachmentMeta, { color: colors.muted }]}>Block threats and targeted harassment</Text>
                </View>
                <Text style={[styles.preferenceState, { color: roomAbuseFilter ? colors.accent : colors.muted }]}>{roomAbuseFilter ? 'On' : 'Off'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole='switch'
                accessibilityState={{ checked: roomNsfwFilter }}
                onPress={() => setRoomNsfwFilter((enabled) => !enabled)}
                style={[styles.preferenceRow, { backgroundColor: colors.input }]}
              >
                <View style={styles.preferenceCopy}>
                  <Text style={[styles.memberName, { color: colors.text }]}>Profanity &amp; slurs</Text>
                  <Text style={[styles.attachmentMeta, { color: colors.muted }]}>Filter the shared PeerChat word list</Text>
                </View>
                <Text style={[styles.preferenceState, { color: roomNsfwFilter ? colors.accent : colors.muted }]}>{roomNsfwFilter ? 'On' : 'Off'}</Text>
              </Pressable>
              <Pressable
                accessibilityHint='Cycles between 5, 10, and 15 messages per 10 seconds'
                accessibilityRole='button'
                onPress={() => setRoomSpamRateLimit((limit) => limit === 5 ? 10 : limit === 10 ? 15 : 5)}
                style={[styles.preferenceRow, { backgroundColor: colors.input }]}
              >
                <View style={styles.preferenceCopy}>
                  <Text style={[styles.memberName, { color: colors.text }]}>Spam limit</Text>
                  <Text style={[styles.attachmentMeta, { color: colors.muted }]}>Per peer, within 10 seconds</Text>
                </View>
                <Text style={[styles.preferenceState, { color: colors.accent }]}>{roomSpamRateLimit}</Text>
              </Pressable>
              <Pressable
                accessibilityRole='button'
                disabled={!profileName.trim() || isBusy}
                onPress={createRoom}
                style={[styles.actionSubmit, { backgroundColor: colors.accent }, !profileName.trim() || isBusy ? styles.disabled : null]}
              >
                <Text style={styles.actionSubmitText}>Create</Text>
              </Pressable>
            </View>
          )}

          {landingAction === 'join' && (
            <View style={[styles.actionPanel, { backgroundColor: colors.surface }]}>
              <TextInput
                value={joinKey}
                onChangeText={setJoinKey}
                autoCapitalize='none'
                autoCorrect={false}
                maxLength={64}
                placeholder='64-character room key'
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.actionInput, styles.roomKeyInput, { backgroundColor: colors.input, color: colors.text }]}
              />
              <Pressable
                accessibilityRole='button'
                disabled={isBusy}
                onPress={() => void openInviteScanner()}
                style={[styles.actionSubmit, { backgroundColor: colors.input }, isBusy ? styles.disabled : null]}
              >
                <Text style={[styles.actionSubmitText, { color: colors.text }]}>Scan invite or room QR</Text>
              </Pressable>
              <Pressable
                accessibilityRole='button'
                disabled={!profileName.trim() || joinKey.trim().length !== 64 || isBusy}
                onPress={joinRoom}
                style={[styles.actionSubmit, { backgroundColor: colors.accent }, !profileName.trim() || joinKey.trim().length !== 64 || isBusy ? styles.disabled : null]}
              >
                <Text style={styles.actionSubmitText}>Join</Text>
              </Pressable>
            </View>
          )}

          {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
          {isBusy && <ActivityIndicator color={colors.accent} />}
          {pendingDirectMessages.length > 0 && (
            <View style={styles.directRequests}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Message requests</Text>
              {pendingDirectMessages.map((invite) => (
                <View key={invite.roomKey} style={[styles.directRequest, { backgroundColor: colors.surface }]}>
                  {invite.fromAvatar
                    ? <Image source={{ uri: invite.fromAvatar }} style={styles.roomAvatarImage} />
                    : (
                      <View style={[styles.roomAvatar, { backgroundColor: colors.accentSoft }]}>
                        <Text style={[styles.roomAvatarText, { color: colors.accent }]}>{getRoomInitials(invite.fromUsername)}</Text>
                      </View>
                      )}
                  <View style={styles.memberCopy}>
                    <Text style={[styles.memberName, { color: colors.text }]}>{invite.fromUsername}</Text>
                    <Text numberOfLines={1} style={[styles.attachmentMeta, { color: colors.muted }]}>wants to message you</Text>
                  </View>
                  <Pressable accessibilityRole='button' onPress={() => respondToDirectMessage(invite, false)} style={styles.requestAction}>
                    <Text style={[styles.requestActionText, { color: colors.danger }]}>Decline</Text>
                  </Pressable>
                  <Pressable accessibilityRole='button' onPress={() => respondToDirectMessage(invite, true)} style={[styles.requestAction, { backgroundColor: colors.accent }]}>
                    <Text style={[styles.requestActionText, { color: '#ffffff' }]}>Accept</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent chats</Text>
            {rooms.length > 0 && <Text style={[styles.roomCount, { color: colors.muted }]}>{rooms.length}</Text>}
          </View>
          {rooms.length > 0 && (
            <TextInput
              autoCapitalize='none'
              autoCorrect={false}
              maxLength={PEERCHAT_SEARCH_QUERY_MAX_CHARACTERS}
              onChangeText={setRoomSearchQuery}
              placeholder='Search chats'
              placeholderTextColor={colors.muted}
              returnKeyType='search'
              style={[styles.roomSearchInput, { backgroundColor: colors.input, color: colors.text }]}
              value={roomSearchQuery}
            />
          )}
        </View>
      )}
      renderItem={({ item }) => (
        <Pressable
          accessibilityHint='Long press for chat options'
          accessibilityRole='button'
          onLongPress={() => showRoomActions(item)}
          onPress={() => openRoom(item)}
          style={({ pressed }) => [
            styles.roomRow,
            { borderBottomColor: colors.border },
            pressed ? { backgroundColor: colors.input } : null
          ]}
        >
          {item.avatar
            ? <Image source={{ uri: item.avatar }} style={styles.roomAvatarImage} />
            : (
              <View style={[styles.roomAvatar, { backgroundColor: colors.accentSoft }]}>
                <Text style={[styles.roomAvatarText, { color: colors.accent }]}>{getRoomInitials(item.name)}</Text>
              </View>
              )}
          <View style={styles.roomCopy}>
            <View style={styles.roomTitleRow}>
              <Text numberOfLines={1} style={[styles.roomTitle, { color: colors.text }]}>{item.name}</Text>
              {item.isPinned && (
                <PinIcon width={ROOM_STATE_ICON_SIZE} height={ROOM_STATE_ICON_SIZE} color={colors.accent} />
              )}
              {item.isMuted && (
                <MuteIcon width={ROOM_STATE_ICON_SIZE} height={ROOM_STATE_ICON_SIZE} color={colors.muted} />
              )}
            </View>
            <Text numberOfLines={1} style={[styles.roomPreview, { color: colors.muted }]}>
              {item.lastMessage
                ? `${item.lastMessage.senderName}: ${item.lastMessage.message}`
                : `${item.roomKey.slice(0, 10)}...`}
            </Text>
          </View>
          <View style={styles.roomMeta}>
            <Text style={[styles.roomTime, { color: colors.muted }]}>{formatRoomTime(item)}</Text>
            {item.unreadCount > 0 && (
              <View style={[styles.unreadBadge, { backgroundColor: colors.accent }]}>
                <Text style={styles.unreadBadgeText}>
                  {item.unreadMentions > 0 ? '@ ' : ''}{item.unreadCount}
                </Text>
              </View>
            )}
            <Text style={[styles.roomPeerCount, { color: item.peerCount > 0 ? colors.success : colors.muted }]}>
              {formatRoomConnection(item, true)}
            </Text>
          </View>
        </Pressable>
      )}
      ListEmptyComponent={(
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {roomSearchQuery.trim() ? 'No matching chats' : 'No rooms yet'}
          </Text>
          <Text style={[styles.helper, { color: colors.muted }]}>
            {roomSearchQuery.trim()
              ? 'Try another room name, key, or message.'
              : 'Create a room or join one shared from PeerSky Desktop.'}
          </Text>
        </View>
      )}
      />
      <PeerProfileModal
        colors={colors}
        isBlocked={isMemberBlocked(profileTarget)}
        member={profileTarget}
        onBlock={blockMember}
        onClose={() => setProfileTarget(null)}
        onDismiss={flushPendingModal}
        onMessage={(member) => {
          setProfileTarget(null)
          startDirectMessage(member)
        }}
        onReport={reportMember}
        onUnblock={unblockMember}
        onViewAvatar={viewProfileAvatar}
      />
      <PeerChatMediaViewer
        onClose={() => setMediaTarget(null)}
        target={mediaTarget}
      />
      <Modal
        animationType='fade'
        onRequestClose={() => setIsScanningInvite(false)}
        visible={isScanningInvite}
      >
        <View style={styles.peerchatScanner}>
          {isScanningInvite && (
            <CameraView
              style={StyleSheet.absoluteFillObject}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => handleScannedInvite(data)}
            />
          )}
          <SafeAreaView style={styles.peerchatScannerOverlay} edges={['top', 'right', 'bottom', 'left']}>
            <Text style={styles.peerchatScanHint}>Scan an invite link or a room key QR code</Text>
            <Pressable
              accessibilityRole='button'
              onPress={() => setIsScanningInvite(false)}
              style={styles.peerchatScannerClose}
            >
              <Text style={styles.peerchatScannerCloseText}>Cancel</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>
      <Modal
        animationType='fade'
        onRequestClose={() => {
          setRoomActionTarget(null)
          setIsConfirmingRoomLeave(false)
        }}
        statusBarTranslucent
        transparent
        visible={roomActionTarget !== null}
      >
        <View accessibilityViewIsModal style={styles.actionSheetRoot}>
          <Pressable
            accessibilityLabel='Close chat actions'
            accessibilityRole='button'
            onPress={() => {
              setRoomActionTarget(null)
              setIsConfirmingRoomLeave(false)
            }}
            style={styles.actionSheetBackdrop}
          />
          {roomActionTarget && (
            <SafeAreaView
              edges={['bottom', 'left', 'right']}
              style={[styles.actionSheet, { backgroundColor: colors.surface }]}
            >
              <Text numberOfLines={1} style={[styles.actionSheetTitle, { color: colors.text }]}>
                {roomActionTarget.name}
              </Text>
              <Text numberOfLines={2} style={[styles.actionSheetPreview, { color: colors.muted }]}>
                {isConfirmingRoomLeave
                  ? 'Remove this chat and its local history from this device?'
                  : 'Manage this chat on this device.'}
              </Text>
              <View style={[styles.actionSheetDivider, { backgroundColor: colors.border }]} />
              {isConfirmingRoomLeave
                ? (
                  <>
                    <Pressable
                      accessibilityRole='button'
                      onPress={() => leaveRoom(roomActionTarget)}
                      style={styles.actionSheetAction}
                    >
                      <Text style={[styles.actionSheetActionText, { color: colors.danger }]}>Leave chat</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole='button'
                      onPress={() => setIsConfirmingRoomLeave(false)}
                      style={styles.actionSheetAction}
                    >
                      <Text style={[styles.actionSheetActionText, { color: colors.accent }]}>Cancel</Text>
                    </Pressable>
                  </>
                  )
                : (
                  <>
                    <Pressable
                      accessibilityRole='button'
                      onPress={() => {
                        const room = roomActionTarget
                        setRoomActionTarget(null)
                        void updateRoomPreference(room, 'pinned')
                      }}
                      style={styles.actionSheetAction}
                    >
                      <Text style={[styles.actionSheetActionText, { color: colors.text }]}>
                        {roomActionTarget.isPinned ? 'Unpin chat' : 'Pin chat'}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole='button'
                      onPress={() => {
                        const room = roomActionTarget
                        setRoomActionTarget(null)
                        void updateRoomPreference(room, 'muted')
                      }}
                      style={styles.actionSheetAction}
                    >
                      <Text style={[styles.actionSheetActionText, { color: colors.text }]}>
                        {roomActionTarget.isMuted ? 'Unmute notifications' : 'Mute notifications'}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole='button'
                      onPress={() => {
                        Clipboard.setString(roomActionTarget.roomKey)
                        setRoomActionTarget(null)
                        onStatus('PeerChat room key copied')
                      }}
                      style={styles.actionSheetAction}
                    >
                      <Text style={[styles.actionSheetActionText, { color: colors.text }]}>Copy room key</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole='button'
                      onPress={() => {
                        // A link anyone can tap to join, same shape as desktop.
                        Clipboard.setString(buildPeerChatInviteUrl(roomActionTarget.roomKey))
                        setRoomActionTarget(null)
                        onStatus('PeerChat invite link copied')
                      }}
                      style={styles.actionSheetAction}
                    >
                      <Text style={[styles.actionSheetActionText, { color: colors.text }]}>Copy invite link</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole='button'
                      onPress={() => setIsConfirmingRoomLeave(true)}
                      style={styles.actionSheetAction}
                    >
                      <Text style={[styles.actionSheetActionText, { color: colors.danger }]}>Leave chat</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole='button'
                      onPress={() => setRoomActionTarget(null)}
                      style={styles.actionSheetAction}
                    >
                      <Text style={[styles.actionSheetActionText, { color: colors.accent }]}>Cancel</Text>
                    </Pressable>
                  </>
                  )}
            </SafeAreaView>
          )}
        </View>
      </Modal>
    </>
  )
}

// The preview, plus a plain warning when the link looks like a scam. Worked
// out here at render time rather than trusted from the sender, and shown on
// its own when there is no preview, since previews can be off or fail and
// neither makes the link any safer.
function PeerChatLinkCard ({
  colors,
  message,
  onOpenUrl,
  preview
}: {
  colors: typeof lightColors
  message: string
  onOpenUrl: (url: string) => void
  preview?: PeerChatLinkPreview | null
}) {
  const url = preview?.url || extractFirstLink(message)
  const assessment = assessLink(url)
  const warning = describeLinkRisk(assessment)
  const warningColor = assessment.level === LINK_SUSPICIOUS ? colors.danger : colors.muted

  if (!preview) {
    if (!warning) return null
    return <Text style={[styles.linkWarning, { color: warningColor }]}>{warning}</Text>
  }

  return (
    <Pressable
      accessibilityHint='Opens the linked page'
      accessibilityRole='link'
      onPress={() => onOpenUrl(preview.url || '')}
      style={[
        styles.linkPreview,
        { backgroundColor: colors.input, borderColor: assessment.level === LINK_SUSPICIOUS ? colors.danger : colors.border }
      ]}
    >
      {!!warning && (
        <Text style={[styles.linkPreviewWarning, { color: warningColor }]}>{warning}</Text>
      )}
      <Text numberOfLines={1} style={[styles.linkPreviewHost, { color: colors.accent }]}>
        {preview.host || preview.url}
      </Text>
      {!!preview.title && (
        <Text numberOfLines={2} style={[styles.linkPreviewTitle, { color: colors.text }]}>{preview.title}</Text>
      )}
      {!!preview.description && (
        <Text numberOfLines={2} style={[styles.linkPreviewDescription, { color: colors.muted }]}>{preview.description}</Text>
      )}
    </Pressable>
  )
}

function PeerChatAttachment ({
  colors,
  item,
  onCallRpc,
  onOpenLocalFile,
  onOpenUrl,
  onStatus,
  roomKey,
  onViewMedia
}: {
  colors: typeof lightColors
  item: PeerChatMessage
  onCallRpc: (command: number, data?: object) => Promise<PeerChatResponse>
  onOpenLocalFile: (uri: string, name: string) => Promise<boolean>
  onOpenUrl: (url: string) => void
  onStatus: (message: string) => void
  roomKey: string
  onViewMedia: (target: PeerChatMediaTarget) => void
}) {
  const mediaKind = getPeerChatAttachmentMediaKind(item.fileName || '', item.message)
  const canPreview = mediaKind !== null && Number.isFinite(item.fileSize) &&
    Number(item.fileSize) > 0 && Number(item.fileSize) <= AUTO_INLINE_MEDIA_MAX_BYTES
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [isOpening, setIsOpening] = useState(false)
  const [isExplicit, setIsExplicit] = useState(false)
  const [isScreening, setIsScreening] = useState(false)

  // Screening what arrived, not only what is sent. The sending side can be
  // stripped out by anyone running a modified build, which is exactly why the
  // text filters check inbound messages too.
  useEffect(() => {
    // Images only. A video has no frame decoder here, so screening it always
    // came back unscanned anyway, and flipping isScreening tore the video
    // player down and rebuilt it mid-render: "Cannot use shared object that
    // was already released".
    if (!mediaUrl || item.self || mediaKind !== 'image') return
    let cancelled = false
    setIsScreening(true)
    void scanMedia({ uri: mediaUrl, mimeType: getPeerChatAttachmentMimeType(item.fileName || ''), size: item.fileSize })
      .then((verdict) => {
        if (cancelled) return
        setIsExplicit(verdict === MEDIA_BLOCKED)
        setIsScreening(false)
      })
    return () => { cancelled = true }
  }, [mediaUrl, item.self, item.fileName, item.fileSize, mediaKind])

  useEffect(() => {
    if (!canPreview || !mediaKind) return
    let cancelled = false
    const command = item.fileEnc === true ? RPC_PEERCHAT_ATTACHMENT_OPEN : RPC_HYPER_FETCH
    const request = item.fileEnc === true
      ? {
          roomKey,
          url: item.message,
          fileName: item.fileName,
          fileSize: item.fileSize,
          encrypted: true
        }
      : { url: item.message }
    void onCallRpc(command, request)
      .then((response) => {
        const resolvedMediaUrl = item.fileEnc === true ? response.localUri : response.mediaUrl
        if (
          !cancelled &&
          response.ok &&
          typeof resolvedMediaUrl === 'string'
        ) setMediaUrl(resolvedMediaUrl)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [canPreview, item.fileEnc, item.fileName, item.fileSize, item.message, mediaKind, onCallRpc, roomKey])

  async function openAttachment () {
    if (isOpening) return
    if (item.fileEnc !== true) {
      onOpenUrl(item.message)
      return
    }
    setIsOpening(true)
    try {
      const response = await onCallRpc(RPC_PEERCHAT_ATTACHMENT_OPEN, {
        roomKey,
        url: item.message,
        fileName: item.fileName,
        fileSize: item.fileSize,
        encrypted: true
      })
      if (!response.ok || !response.localUri) {
        throw new Error(response.error || 'Unable to open encrypted attachment.')
      }
      if (!await onOpenLocalFile(response.localUri, item.fileName || 'PeerChat attachment')) {
        throw new Error('No app is available to open this attachment.')
      }
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsOpening(false)
    }
  }

  if (mediaUrl && mediaKind === 'image' && (isScreening || isExplicit)) {
    return (
      <View style={[styles.inlineMediaCard, styles.mediaNotice, { backgroundColor: colors.input, borderColor: colors.muted }]}>
        <Text style={[styles.mediaNoticeText, { color: isExplicit ? colors.danger : colors.muted }]}>
          {isExplicit ? 'Hidden: this looks explicit' : 'Checking this picture'}
        </Text>
        <AttachmentCaption colors={colors} inline item={item} />
      </View>
    )
  }

  if (mediaUrl && mediaKind === 'image') {
    return (
      <Pressable
        accessibilityHint='Opens this image full screen'
        accessibilityRole='imagebutton'
        onPress={() => onViewMedia({
          kind: 'image',
          label: item.fileName || 'Image attachment',
          uri: mediaUrl
        })}
        style={[styles.inlineMediaCard, { borderColor: colors.muted }]}
      >
        <Image resizeMode='cover' source={{ uri: mediaUrl }} style={styles.inlineMediaImage} />
        <AttachmentCaption colors={colors} inline item={item} />
      </Pressable>
    )
  }

  if (mediaUrl && mediaKind === 'video') {
    return (
      <View style={[styles.inlineMediaCard, { borderColor: colors.muted }]}>
        <PeerChatVideo mediaUrl={mediaUrl} />
        <Pressable
          accessibilityHint='Opens this video full screen'
          accessibilityRole='button'
          onPress={() => onViewMedia({
            kind: 'video',
            label: item.fileName || 'Video attachment',
            uri: mediaUrl
          })}
        >
          <AttachmentCaption colors={colors} inline item={item} />
        </Pressable>
      </View>
    )
  }

  return (
    <Pressable
      accessibilityHint='Opens this Hyperdrive attachment'
      accessibilityRole='link'
      disabled={isOpening}
      onPress={() => void openAttachment()}
      style={[styles.attachmentCard, { backgroundColor: colors.input, borderColor: colors.muted }]}
    >
      <Text style={[styles.attachmentIcon, { color: colors.accent }]}>+</Text>
      <AttachmentCaption colors={colors} item={item} status={isOpening ? 'Opening...' : undefined} />
    </Pressable>
  )
}

function PeerChatVideo ({ fullScreen = false, mediaUrl }: { fullScreen?: boolean, mediaUrl: string }) {
  const player = useVideoPlayer(mediaUrl)
  return (
    <VideoView
      contentFit='contain'
      nativeControls
      player={player}
      style={fullScreen ? styles.fullScreenMedia : styles.inlineMediaVideo}
      surfaceType={Platform.OS === 'android' ? 'textureView' : undefined}
    />
  )
}

function PeerProfileModal ({
  colors,
  isBlocked,
  member,
  onBlock,
  onClose,
  onDismiss,
  onMessage,
  onReport,
  onUnblock,
  onViewAvatar
}: {
  colors: typeof lightColors
  isBlocked: boolean
  member: PeerChatMember | null
  onBlock: (member: PeerChatMember) => void
  onClose: () => void
  onDismiss: () => void
  onMessage: (member: PeerChatMember) => void
  onReport: (member: PeerChatMember) => void
  onUnblock: (member: PeerChatMember) => void
  onViewAvatar: (member: PeerChatMember) => void
}) {
  return (
    <Modal
      animationType='fade'
      onDismiss={onDismiss}
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={member !== null}
    >
      <View accessibilityViewIsModal style={styles.profileModalRoot}>
        <Pressable
          accessibilityLabel='Close peer profile'
          accessibilityRole='button'
          onPress={onClose}
          style={styles.roomInfoBackdrop}
        />
        {member && (
          <SafeAreaView
            edges={['bottom', 'left', 'right']}
            style={[styles.peerProfileCard, { backgroundColor: colors.surface }]}
          >
            <Pressable
              accessibilityLabel='Close peer profile'
              accessibilityRole='button'
              hitSlop={8}
              onPress={onClose}
              style={styles.peerProfileClose}
            >
              <CloseIcon width={18} height={18} color={colors.muted} />
            </Pressable>
            <Pressable
              accessibilityHint={member.avatar ? 'Opens avatar full screen' : undefined}
              accessibilityRole={member.avatar ? 'imagebutton' : 'image'}
              disabled={!member.avatar}
              onPress={() => onViewAvatar(member)}
            >
              {member.avatar
                ? <Image source={{ uri: member.avatar }} style={styles.peerProfileAvatar} />
                : (
                  <View style={[styles.peerProfileAvatar, styles.profileAvatarFallback, { backgroundColor: colors.accentSoft }]}>
                    <Text style={[styles.peerProfileInitials, { color: colors.accent }]}>{getRoomInitials(member.username)}</Text>
                  </View>
                  )}
            </Pressable>
            <Text style={[styles.peerProfileName, { color: colors.text }]}>{member.username}</Text>
            <Text style={[styles.peerProfileStatus, { color: member.online ? colors.success : colors.muted }]}>
              {member.self ? 'You' : member.online ? 'Online' : 'Offline'}
            </Text>
            <Text style={[styles.peerProfileBio, { color: colors.muted }]}>
              {member.bio || 'No bio shared.'}
            </Text>
            {!member.self && (
              <>
                <Pressable
                  // Offline is fine: the invite is re-sent the moment they
                  // reconnect, so the room opens now and the note in it
                  // explains the wait.
                  accessibilityRole='button'
                  disabled={isBlocked}
                  onPress={() => onMessage(member)}
                  style={[
                    styles.peerProfileMessage,
                    { backgroundColor: isBlocked ? colors.input : colors.accent }
                  ]}
                >
                  <Text style={[styles.profileSaveText, isBlocked ? { color: colors.muted } : null]}>
                    {isBlocked ? 'Blocked' : 'Message'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityHint={isBlocked
                    ? 'Lets this person send you direct messages again'
                    : 'Stops direct messages from this person. They can still see you in shared rooms.'}
                  accessibilityRole='button'
                  onPress={() => (isBlocked ? onUnblock(member) : onBlock(member))}
                  style={styles.peerProfileSecondary}
                >
                  <Text style={[styles.peerProfileSecondaryText, { color: colors.danger }]}>
                    {isBlocked ? 'Unblock' : 'Block direct messages'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole='button'
                  onPress={() => onReport(member)}
                  style={styles.peerProfileSecondary}
                >
                  <Text style={[styles.peerProfileSecondaryText, { color: colors.muted }]}>Report</Text>
                </Pressable>
              </>
            )}
          </SafeAreaView>
        )}
      </View>
    </Modal>
  )
}

// Written for someone who has never heard of peer to peer. Every entry is a
// question a real person asks in the first week. The awkward ones, deleting a
// message and deleting an account, get a straight answer rather than a dodge,
// and each one leads with what you get before what you give up.
const PEERCHAT_ABOUT = [
  {
    q: 'Do I need an account?',
    a: 'No, and you never will. Pick a name and start chatting. It lives on this phone, not in anyone\u2019s database.'
  },
  {
    q: 'What do you know about me?',
    a: 'Nothing at all. No tracking, no analytics, no profile of you sitting on a server somewhere, because there is no server to sit on.'
  },
  {
    q: 'Who can read my messages?',
    a: 'Only the people in the room. Everything is locked with the room key before it leaves your phone, so anyone in between sees scrambled text.'
  },
  {
    q: 'Where do my messages live?',
    a: 'On the phones of the people you are talking to, and nowhere else. Your conversation belongs to the people in it.'
  },
  {
    q: 'Why can I not delete a message?',
    a: 'Once it arrives it is on their phone, and their phone is theirs. It works the way a text message does, so it is worth a second look before you send.'
  },
  {
    q: 'Can I delete my account?',
    a: 'There is no account to delete, which is the good news. Clearing PeerSky data wipes your name and chats from this phone. Anything you already sent stays with the people you sent it to.'
  },
  {
    q: 'Why did messages stop arriving?',
    a: 'Messages hop straight between phones, so both need to be awake. Open PeerChat and anything waiting comes through.'
  },
  {
    q: 'Why can I not see older messages?',
    a: 'You start fresh from the moment you join, so nobody\u2019s old conversation follows them around.'
  },
  {
    q: 'How do people join my room?',
    a: 'Send them the invite link or the room key. Anyone who has it can join, so share it the way you would a house key.'
  },
  {
    q: 'Can people send anything they like?',
    a: 'Some things are blocked for everyone, with nothing to switch on. Nudity in pictures is refused before it is sent and again when it arrives, covering what you post, your profile picture, a room picture and anything inside a folder you upload. Text is filtered for abuse, slurs and adult links. A link that looks like a scam gets a warning under it. Violent or graphic pictures are not detected, so block and report are what to use for those.'
  },
  {
    q: 'Someone is bothering me',
    a: 'Open their profile and block them. Their direct messages stop right away, and you still share any rooms you are both in. Report sends a note to the people who build PeerChat.'
  },
  {
    q: 'Can I use the same profile on my phone and my computer?',
    a: 'One phone and one computer, and only one of them at a time. Messages arrive on whichever is running, not both, and writing from both splits your history in two. Moving to a new phone is a deliberate step: remove the identity from the old one first, in Settings.'
  },
  {
    q: 'Does it work without internet?',
    a: 'Yes, on the same WiFi. Phones find each other over the local network, so an outage does not stop a conversation.'
  }
]

function PeerChatAboutPage ({ colors }: { colors: typeof lightColors }) {
  return (
    <ScrollView contentContainerStyle={styles.profileSettings}>
      <Text style={[styles.aboutLead, { color: colors.text }]}>
        PeerChat is chat between phones, and nothing more. No sign up, no company in the
        middle, and nothing you send passes through a server.
      </Text>

      {PEERCHAT_ABOUT.map((entry) => (
        <View key={entry.q} style={[styles.aboutCard, { backgroundColor: colors.input }]}>
          <Text style={[styles.aboutQuestion, { color: colors.text }]}>{entry.q}</Text>
          <Text style={[styles.aboutText, { color: colors.muted }]}>{entry.a}</Text>
        </View>
      ))}

      <Text style={[styles.aboutVersion, { color: colors.muted }]}>
        Version {Constants.expoConfig?.version || 'unknown'}
      </Text>
    </ScrollView>
  )
}

function PeerChatMediaViewer ({
  onClose,
  target
}: {
  onClose: () => void
  target: PeerChatMediaTarget | null
}) {
  return (
    <Modal
      animationType='fade'
      onRequestClose={onClose}
      statusBarTranslucent
      visible={target !== null}
    >
      {/*
        A Modal is its own root view on iOS, so a bare SafeAreaView inside it
        reports zero top inset and the close button lands under the Dynamic
        Island, leaving no way back. Its own provider gives it real insets.
      */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.mediaViewer}>
        <View style={styles.mediaViewerHeader}>
          <Text numberOfLines={1} style={styles.mediaViewerTitle}>{target?.label}</Text>
          <Pressable
            accessibilityLabel='Close media viewer'
            accessibilityRole='button'
            hitSlop={8}
            onPress={onClose}
            style={styles.mediaViewerClose}
          >
            <CloseIcon width={22} height={22} color='#f2f3f7' />
          </Pressable>
        </View>
        <View style={styles.mediaViewerContent}>
          {target?.kind === 'image' && (
            <Image resizeMode='contain' source={{ uri: target.uri }} style={styles.fullScreenMedia} />
          )}
          {target?.kind === 'video' && <PeerChatVideo fullScreen mediaUrl={target.uri} />}
        </View>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  )
}

function AttachmentCaption ({
  colors,
  inline = false,
  item,
  status
}: {
  colors: typeof lightColors
  inline?: boolean
  item: PeerChatMessage
  status?: string
}) {
  return (
    <View style={inline ? styles.inlineMediaCaption : styles.attachmentCopy}>
      <Text numberOfLines={1} style={[styles.attachmentName, { color: colors.text }]}>{item.fileName}</Text>
      <Text style={[styles.attachmentMeta, { color: colors.muted }]}>{status || formatFileSize(item.fileSize)}</Text>
    </View>
  )
}

function getPeerChatAttachmentMediaKind (fileName: string, url: string): 'image' | 'video' | null {
  const source = `${fileName} ${url.split(/[?#]/, 1)[0]}`.toLocaleLowerCase()
  // heic and heif are what an iPhone camera writes by default, so leaving them
  // out meant the commonest photo on the platform was not treated as one.
  if (/\.(?:avif|gif|heic|heif|jpe?g|png|webp)(?:\s|$)/.test(source)) return 'image'
  if (/\.(?:3gp|avi|m4v|mkv|mov|mp4|webm)(?:\s|$)/.test(source)) return 'video'
  return null
}

// The classifier decides from the bytes, but it needs a type to build a data
// url the page can decode. Only the still formats matter: video is not
// screened yet.
function getPeerChatAttachmentMimeType (fileName: string) {
  const extension = fileName.toLocaleLowerCase().split('.').pop() || ''
  const byExtension: Record<string, string> = {
    avif: 'image/avif',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp'
  }
  return byExtension[extension] || ''
}

function getRoomInitials (name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'PC'
}

function renderMessageText (message: string, usernames: string[], textColor: string, mentionColor: string) {
  return splitPeerChatMentions(message, usernames).map((part, index) => (
    <Text
      key={`${index}-${part.text}`}
      style={{ color: part.mention ? mentionColor : textColor, fontWeight: part.mention ? '800' : '400' }}
    >
      {part.text}
    </Text>
  ))
}

function getMentionCandidates (
  composer: string,
  members: PeerChatMember[],
  messages: PeerChatMessage[],
  localId: string
) {
  const atIndex = composer.lastIndexOf('@')
  if (atIndex < 0 || (atIndex > 0 && !/\s/.test(composer[atIndex - 1]))) return []
  const query = composer.slice(atIndex + 1)
  if (query.includes('\n') || Array.from(query).length > 50) return []

  const candidates = new Map<string, PeerChatMember>()
  for (const member of members) {
    if (!member.self && member.id !== localId) candidates.set(member.id, member)
  }
  for (const message of messages) {
    if (message.self || message.sender === localId || candidates.has(message.sender)) continue
    candidates.set(message.sender, {
      id: message.sender,
      username: message.senderName,
      bio: '',
      avatar: null,
      self: false,
      online: true
    })
  }

  const normalizedQuery = query.toLocaleLowerCase()
  return [...candidates.values()]
    .filter((member) => member.username.toLocaleLowerCase().includes(normalizedQuery))
    .slice(0, 5)
}

function insertMention (composer: string, username: string) {
  const atIndex = composer.lastIndexOf('@')
  if (atIndex < 0) return composer
  return `${composer.slice(0, atIndex)}@${username}  `
}

function formatMessageTime (timestamp: number) {
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatFileSize (value?: number) {
  if (!Number.isFinite(value) || Number(value) < 0) return 'Hyperdrive attachment'
  if (Number(value) < 1024) return `${value} B`
  if (Number(value) < 1024 * 1024) return `${(Number(value) / 1024).toFixed(1)} KB`
  return `${(Number(value) / (1024 * 1024)).toFixed(1)} MB`
}

function formatRoomTime (room: PeerChatRoom) {
  const timestamp = room.lastMessage?.timestamp || room.createdAt
  if (!Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { day: '2-digit', month: 'short' })
}

function formatRoomCreatedAt (timestamp: number) {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return ''
  return ` on ${new Date(timestamp).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}`
}

function formatRoomConnection (room: PeerChatRoom, compact = false) {
  if (room.connectionState === 'connecting') return 'Connecting...'
  if (room.connectionState === 'syncing') return 'Syncing...'
  if (room.connectionState === 'connected') {
    return compact
      ? `${room.peerCount} online`
      : `${room.peerCount} peer${room.peerCount === 1 ? '' : 's'} connected`
  }
  return compact ? 'No peers' : 'Waiting for peers'
}

function persistPeerChatUiState (state: PeerChatUiState) {
  try {
    if (!PEERCHAT_UI_STATE_FILE.exists) PEERCHAT_UI_STATE_FILE.create({ intermediates: true })
    PEERCHAT_UI_STATE_FILE.write(serializePeerChatUiState(state))
  } catch (cause) {
    console.warn('Unable to save PeerChat UI state:', cause)
  }
}

const darkColors = {
  background: '#17181d',
  surface: '#23252c',
  input: '#2d3039',
  border: '#3d414d',
  text: '#f2f3f7',
  muted: '#9ca2b2',
  accent: '#62a5ff',
  accentSoft: '#243b5c',
  success: '#6fd5a5',
  danger: '#ff8278',
  selfBubble: '#234b78',
  peerBubble: '#2c2f38'
}

const lightColors = {
  background: '#f5f6f8',
  surface: '#ffffff',
  input: '#f0f2f5',
  border: '#d8dce5',
  text: '#171a21',
  muted: '#687083',
  accent: '#1f6fd1',
  accentSoft: '#e5f0ff',
  success: '#23845d',
  danger: '#c43d35',
  selfBubble: '#dcecff',
  peerBubble: '#eceef2'
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center' },
  introScreen: { flex: 1, paddingBottom: 18 },
  introContent: { flexGrow: 1, paddingHorizontal: 22, paddingVertical: 24 },
  introLogo: { alignSelf: 'center', borderRadius: 18, height: 72, marginBottom: 18, width: 72 },
  introTitle: { fontSize: 25, fontWeight: '900', lineHeight: 31, marginBottom: 24, textAlign: 'center' },
  introPoints: { gap: 20 },
  introPointRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 13 },
  introPointNumber: { alignItems: 'center', borderRadius: 15, height: 30, justifyContent: 'center', width: 30 },
  introPointNumberText: { fontSize: 13, fontWeight: '900' },
  introPointText: { flex: 1, fontSize: 14, lineHeight: 20 },
  introContinue: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', marginHorizontal: 22, minHeight: 50 },
  introContinueText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  onboardingScreen: { flex: 1, paddingBottom: 18 },
  onboardingContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 28 },
  onboardingLogo: { alignSelf: 'center', borderRadius: 18, height: 72, marginBottom: 16, width: 72 },
  onboardingTitle: { fontSize: 25, fontWeight: '900', textAlign: 'center' },
  onboardingHelper: { alignSelf: 'center', fontSize: 13, lineHeight: 19, marginTop: 8, maxWidth: 340, textAlign: 'center' },
  onboardingFields: { gap: 8, marginTop: 26 },
  onboardingLabel: { fontSize: 12, fontWeight: '800', marginTop: 4 },
  onboardingBio: { maxHeight: 110, minHeight: 76, textAlignVertical: 'top' },
  landingContent: { paddingBottom: 28 },
  landingHeader: { gap: 12, paddingHorizontal: 16, paddingTop: 14 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  logo: { borderRadius: 10, height: 38, width: 38 },
  titleCopy: { flex: 1 },
  title: { fontSize: 21, fontWeight: '900' },
  settingsButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  helper: { fontSize: 13, lineHeight: 19 },
  profileRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  profileAvatar: { borderRadius: 21, height: 42, width: 42 },
  profileAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  profileSummary: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 10, minHeight: 46 },
  profileSummaryName: { fontSize: 15, fontWeight: '800', maxWidth: 240 },
  profileInput: { flex: 1 },
  profileSettings: { gap: 10, padding: 16 },
  bioInput: { maxHeight: 92, minHeight: 52, textAlignVertical: 'top' },
  profileSaveButton: { alignItems: 'center', borderRadius: 10, justifyContent: 'center', minHeight: 42, paddingHorizontal: 14 },
  profileSaveText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  modalError: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  input: { borderRadius: 10, borderWidth: 0, fontSize: 14, minHeight: 42, paddingHorizontal: 12, paddingVertical: 9 },
  roomKeyInput: { fontFamily: 'monospace', fontSize: 13 },
  quickActions: { flexDirection: 'row', gap: 10 },
  quickAction: { alignItems: 'center', borderRadius: 12, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 42, paddingHorizontal: 8 },
  quickActionSymbol: { fontSize: 20, fontWeight: '500' },
  quickActionText: { fontSize: 14, fontWeight: '800' },
  actionPanel: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 8, padding: 8 },
  createActionPanel: { alignItems: 'stretch', flexDirection: 'column' },
  createActionInput: { width: '100%' },
  actionInput: { flex: 1 },
  peerchatScanner: { backgroundColor: '#000000', flex: 1 },
  peerchatScannerOverlay: { alignItems: 'center', flex: 1, justifyContent: 'flex-end', padding: 24 },
  peerchatScanHint: { color: '#ffffff', fontSize: 15, marginBottom: 16, textAlign: 'center' },
  peerchatScannerClose: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 10, justifyContent: 'center', minHeight: 44, paddingHorizontal: 28 },
  peerchatScannerCloseText: { color: '#1f2027', fontSize: 15, fontWeight: '700' },
  peerProfileSecondary: { alignItems: 'center', justifyContent: 'center', marginTop: 8, minHeight: 40, paddingHorizontal: 24 },
  peerProfileSecondaryText: { fontSize: 15, fontWeight: '700' },
  actionSubmit: { alignItems: 'center', borderRadius: 9, justifyContent: 'center', minHeight: 42, minWidth: 72, paddingHorizontal: 14 },
  actionSubmitText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  error: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  directRequests: { gap: 7 },
  directRequest: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 7, padding: 9 },
  requestAction: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 7 },
  requestActionText: { fontSize: 11, fontWeight: '800' },
  sectionTitle: { fontSize: 16, fontWeight: '900' },
  roomSearchInput: { borderRadius: 16, fontSize: 14, minHeight: 38, paddingHorizontal: 12, paddingVertical: 8 },
  roomCount: { fontSize: 12, fontWeight: '700' },
  roomRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, minHeight: 72, paddingHorizontal: 16, paddingVertical: 10 },
  roomAvatar: { alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  roomAvatarImage: { borderRadius: 22, height: 44, width: 44 },
  roomAvatarText: { fontSize: 14, fontWeight: '900' },
  roomCopy: { flex: 1, gap: 4 },
  roomTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  roomTitle: { flexShrink: 1, fontSize: 15, fontWeight: '800' },
  roomPreview: { fontSize: 12 },
  roomMeta: { alignItems: 'flex-end', gap: 5 },
  roomTime: { fontSize: 10 },
  roomPeerCount: { fontSize: 11, fontWeight: '700' },
  unreadBadge: { alignItems: 'center', borderRadius: 10, justifyContent: 'center', minWidth: 20, paddingHorizontal: 6, paddingVertical: 2 },
  unreadBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  emptyState: { alignItems: 'center', gap: 5, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 36 },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  chatHeader: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 62, paddingHorizontal: 8 },
  chatHeaderCopy: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 7, paddingHorizontal: 5 },
  chatHeaderAvatar: { borderRadius: 17, height: 34, width: 34 },
  chatHeaderAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  chatHeaderAvatarText: { fontSize: 11, fontWeight: '900' },
  chatHeaderText: { alignItems: 'center', flex: 1 },
  chatHeaderActions: { flexDirection: 'row' },
  roomInfoModalRoot: { flex: 1, justifyContent: 'center', paddingHorizontal: 18 },
  roomInfoBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.56)' },
  roomInfoPanel: { alignSelf: 'center', borderRadius: 16, elevation: 12, maxHeight: '82%', maxWidth: 440, overflow: 'hidden', width: '100%' },
  roomInfoHeader: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 50, paddingHorizontal: 16 },
  roomInfoHeading: { flex: 1, fontSize: 17, fontWeight: '900' },
  roomInfoClose: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
  roomInfo: { gap: 10, padding: 16 },
  roomProvenance: { alignItems: 'stretch', gap: 7 },
  roomInfoTitle: { fontSize: 15, fontWeight: '800' },
  roomInfoLink: { fontSize: 12, textDecorationLine: 'underline' },
  roomInfoSave: { alignItems: 'center', alignSelf: 'center', borderRadius: 9, minHeight: 38, justifyContent: 'center', paddingHorizontal: 14 },
  profileModalRoot: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  peerProfileCard: { alignItems: 'center', borderRadius: 18, elevation: 12, maxWidth: 360, padding: 24, width: '100%' },
  peerProfileClose: { alignItems: 'center', height: 36, justifyContent: 'center', position: 'absolute', right: 8, top: 8, width: 36 },
  peerProfileAvatar: { borderRadius: 48, height: 96, width: 96 },
  peerProfileInitials: { fontSize: 27, fontWeight: '900' },
  peerProfileName: { fontSize: 20, fontWeight: '900', marginTop: 13, textAlign: 'center' },
  peerProfileStatus: { fontSize: 12, fontWeight: '700', marginTop: 3 },
  peerProfileBio: { fontSize: 13, lineHeight: 19, marginTop: 10, textAlign: 'center' },
  peerProfileMessage: { alignItems: 'center', borderRadius: 10, justifyContent: 'center', marginTop: 18, minHeight: 42, paddingHorizontal: 28 },
  avatarEditor: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 8, minHeight: 38 },
  avatarEditorImage: { borderRadius: 18, height: 36, width: 36 },
  memberList: { gap: 6, marginTop: 2 },
  memberRow: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 8, minHeight: 46, paddingHorizontal: 9, paddingVertical: 6 },
  memberAvatar: { borderRadius: 16, height: 32, width: 32 },
  memberAvatarWrap: { height: 32, width: 32 },
  memberAvatarFallback: { alignItems: 'center', borderRadius: 16, height: 32, justifyContent: 'center', width: 32 },
  memberAvatarText: { fontSize: 10, fontWeight: '900' },
  onlineDot: { borderColor: '#ffffff', borderRadius: 5, borderWidth: 2, bottom: -1, height: 10, position: 'absolute', right: -1, width: 10 },
  memberCopy: { flex: 1 },
  memberName: { fontSize: 13, fontWeight: '800' },
  memberMessage: { fontSize: 12, fontWeight: '800' },
  dmStatus: { fontSize: 12, paddingHorizontal: 12, paddingVertical: 8, textAlign: 'center' },
  moderationWarning: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  moderationWarningText: { flex: 1, fontSize: 12, lineHeight: 17 },
  moderationWarningClose: { alignItems: 'center', height: 28, justifyContent: 'center', width: 28 },
  chatTitle: { fontSize: 16, fontWeight: '800', maxWidth: '100%' },
  connectionText: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  headerAction: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44, paddingHorizontal: 5 },
  searchRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingVertical: 7 },
  searchInput: { borderRadius: 16, flex: 1, fontSize: 14, minHeight: 36, paddingHorizontal: 12, paddingVertical: 7 },
  searchCount: { fontSize: 11, minWidth: 24, textAlign: 'center' },
  messageListContainer: { flex: 1 },
  messageList: { padding: 14, paddingBottom: 8 },
  emptyMessageList: { flexGrow: 1, justifyContent: 'center' },
  dateDivider: { alignItems: 'center', flexDirection: 'row', gap: 9, marginBottom: 12, marginTop: 4 },
  dateDividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dateDividerText: { fontSize: 11, fontWeight: '600' },
  messageRow: { alignItems: 'flex-start', marginBottom: 9 },
  messageRowSelf: { alignItems: 'flex-end' },
  messageSenderRow: { alignItems: 'center', flexDirection: 'row', gap: 6, marginBottom: 3 },
  messageSenderAvatar: { borderRadius: 9, height: 18, width: 18 },
  messageSenderAvatarFallback: { alignItems: 'center', borderRadius: 9, height: 18, justifyContent: 'center', width: 18 },
  messageSenderAvatarText: { fontSize: 7, fontWeight: '900' },
  systemMessageRow: { alignItems: 'center' },
  messageBubble: { borderRadius: 15, maxWidth: '84%', minWidth: 84, paddingHorizontal: 12, paddingVertical: 8 },
  systemMessage: { maxWidth: '92%' },
  systemMessageTime: { alignSelf: 'center' },
  quotedReply: { borderLeftWidth: 3, borderRadius: 7, marginBottom: 6, paddingHorizontal: 8, paddingVertical: 5 },
  quotedReplySender: { fontSize: 11, fontWeight: '800' },
  quotedReplyText: { fontSize: 11, lineHeight: 15 },
  // Desktop hangs reactions under the bubble instead of inside it, so a long
  // reaction list never squeezes the message text.
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: -5, maxWidth: '84%', paddingHorizontal: 6 },
  reactionRowSelf: { justifyContent: 'flex-end' },
  reactionBubble: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  reactionText: { fontSize: 12 },
  senderName: { fontSize: 11, fontWeight: '800' },
  messageText: { fontSize: 14, lineHeight: 19 },
  attachmentCard: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 9, minWidth: 190, padding: 9 },
  inlineMediaCard: { borderRadius: 10, borderWidth: 1, maxWidth: 260, overflow: 'hidden', width: 240 },
  mediaNotice: { alignItems: 'center', gap: 4, justifyContent: 'center', minHeight: 110, padding: 12 },
  mediaNoticeText: { fontSize: 13, fontWeight: '600' },
  inlineMediaImage: { height: 170, width: '100%' },
  inlineMediaVideo: { height: 180, width: '100%' },
  mediaViewer: { backgroundColor: '#090a0d', flex: 1 },
  mediaViewerHeader: { alignItems: 'center', flexDirection: 'row', minHeight: 52, paddingHorizontal: 12 },
  mediaViewerTitle: { color: '#f2f3f7', flex: 1, fontSize: 14, fontWeight: '700' },
  mediaViewerClose: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  mediaViewerContent: { flex: 1 },
  fullScreenMedia: { height: '100%', width: '100%' },
  inlineMediaCaption: { paddingHorizontal: 9, paddingVertical: 8 },
  attachmentIcon: { fontSize: 24, fontWeight: '500' },
  attachmentCopy: { flex: 1 },
  attachmentName: { fontSize: 13, fontWeight: '800' },
  attachmentMeta: { fontSize: 10, marginTop: 2 },
  linkPreview: { borderRadius: 9, borderWidth: 1, gap: 2, marginTop: 7, padding: 8 },
  linkPreviewHost: { fontSize: 10, fontWeight: '700' },
  linkPreviewTitle: { fontSize: 13, fontWeight: '800' },
  linkPreviewDescription: { fontSize: 11, lineHeight: 15 },
  linkPreviewWarning: { fontSize: 11, fontWeight: '700' },
  linkWarning: { fontSize: 11, fontWeight: '700', marginTop: 6 },
  preferenceRow: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 10, padding: 11 },
  settingsSection: { gap: 8, marginTop: 6 },
  aboutCard: { borderRadius: 12, gap: 6, padding: 12 },
  aboutBack: { marginRight: 10, padding: 4 },
  aboutLead: { fontSize: 14, lineHeight: 21, marginBottom: 2 },
  aboutQuestion: { fontSize: 14, fontWeight: '600' },
  aboutText: { fontSize: 13, lineHeight: 19 },
  aboutVersion: { fontSize: 12, marginTop: 2, textAlign: 'center' },
  settingsSectionTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  preferenceCopy: { flex: 1 },
  preferenceState: { fontSize: 12, fontWeight: '900' },
  actionSectionTitle: { fontSize: 13, fontWeight: '900', marginTop: 2 },
  messageTime: { alignSelf: 'flex-end', fontSize: 10, marginTop: 4 },
  scrollToLatest: { alignItems: 'center', borderRadius: 18, bottom: 10, elevation: 3, height: 36, justifyContent: 'center', position: 'absolute', right: 14, width: 36 },
  inlineError: { fontSize: 12, paddingHorizontal: 14, paddingVertical: 5, textAlign: 'center' },
  reactionPicker: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8, paddingVertical: 6 },
  reactionPickerButton: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  reactionPickerEmoji: { fontSize: 22 },
  emojiPanel: { borderTopWidth: 1, gap: 7, maxHeight: 260, paddingHorizontal: 10, paddingVertical: 8 },
  emojiQuickRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-around' },
  emojiSearch: { borderRadius: 10, fontSize: 14, minHeight: 38, paddingHorizontal: 12, paddingVertical: 7 },
  emojiGridList: { flexGrow: 0, height: 150 },
  emojiGrid: { paddingBottom: 8 },
  emojiGridButton: { alignItems: 'center', flex: 1, height: 42, justifyContent: 'center' },
  emojiEmpty: { flex: 1, fontSize: 13, paddingVertical: 24, textAlign: 'center' },
  replyComposer: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 7 },
  replyComposerCopy: { flex: 1 },
  mentionSuggestions: { borderTopWidth: 1, paddingVertical: 6 },
  mentionSuggestionRow: { flexDirection: 'row', gap: 7, paddingHorizontal: 10 },
  mentionSuggestion: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 },
  mentionSuggestionText: { fontSize: 12, fontWeight: '800' },
  cancelReply: { alignItems: 'center', height: 28, justifyContent: 'center', width: 28 },
  cancelReplyText: { fontSize: 18, fontWeight: '700' },
  composer: { alignItems: 'flex-end', borderTopWidth: 1, flexDirection: 'row', gap: 8, padding: 10 },
  attachButton: { alignItems: 'center', borderRadius: 20, height: 42, justifyContent: 'center', width: 42 },
  attachButtonText: { fontSize: 27, fontWeight: '400', lineHeight: 29 },
  emojiButton: { alignItems: 'center', borderRadius: 20, height: 42, justifyContent: 'center', width: 42 },
  emojiButtonText: { fontSize: 15, fontWeight: '800' },
  composerInput: { borderRadius: 18, borderWidth: 1, flex: 1, fontSize: 15, maxHeight: 112, minHeight: 42, paddingHorizontal: 13, paddingVertical: 9 },
  sendButton: { alignItems: 'center', borderRadius: 20, height: 42, justifyContent: 'center', width: 42 },
  actionSheetRoot: { flex: 1, justifyContent: 'flex-end' },
  actionSheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  actionSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 18, paddingHorizontal: 18, paddingTop: 16 },
  actionSheetTitle: { fontSize: 16, fontWeight: '800' },
  actionSheetPreview: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  actionSheetReactionRow: { alignItems: 'center', borderRadius: 20, flexDirection: 'row', justifyContent: 'space-around', marginTop: 12, paddingHorizontal: 6, paddingVertical: 3 },
  actionSheetDivider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  actionSheetDetails: { fontSize: 14, lineHeight: 20, minHeight: 48, paddingVertical: 8 },
  actionSheetAction: { justifyContent: 'center', minHeight: 48, paddingHorizontal: 4 },
  actionSheetActionText: { fontSize: 16, fontWeight: '600' }
})
