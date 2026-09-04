import { useCallback, useEffect, useRef, useState } from 'react'
import { File, Paths } from 'expo-file-system'
import * as DocumentPicker from 'expo-document-picker'
import { fetch as expoFetch } from 'expo/fetch'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Clipboard,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
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
import {
  filterPeerChatMembers,
  filterPeerChatMessages,
  filterPeerChatRooms,
  formatPeerChatDateLabel,
  formatPeerChatMessageDetails,
  getFirstUnreadMessageIndex,
  isPeerChatNearBottom,
  PEERCHAT_SEARCH_QUERY_MAX_CHARACTERS
} from './message-search.mjs'
import {
  createPeerChatAvatarDataUrl,
  MAX_PEERCHAT_AVATAR_FILE_BYTES
} from './avatar.mjs'
import {
  extractFirstHttpUrl,
  resolveLinkPreview
} from '../../backend/peerchat/link-preview.mjs'

import {
  RPC_HYPER_LIBRARY_UPLOAD,
  RPC_PEERCHAT_DM_ACCEPT,
  RPC_PEERCHAT_DM_CREATE,
  RPC_PEERCHAT_DM_REJECT,
  RPC_PEERCHAT_INIT,
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
  RPC_PEERCHAT_SNAPSHOT
} from '../../backend/rpc/commands.mjs'

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
  preview?: PeerChatLinkPreview | null
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
  isHost: boolean
  isPinned: boolean
  isMuted: boolean
  createdAt: number
  createdBy: string
  createdByName: string
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
}

type PeerChatScreenProps = {
  isDark: boolean
  onCallRpc: (command: number, data?: object) => Promise<PeerChatResponse>
  onOpenUrl: (url: string) => void
  onStatus: (message: string) => void
}

const POLL_INTERVAL_MS = 1500
const ROOM_LIST_POLL_INTERVAL_MS = 3000
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥']
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
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export function PeerChatScreen ({ isDark, onCallRpc, onOpenUrl, onStatus }: PeerChatScreenProps) {
  const colors = isDark ? darkColors : lightColors
  const callRpcRef = useRef(onCallRpc)
  const messageListRef = useRef<FlatList<PeerChatMessage> | null>(null)
  const versionRef = useRef(-1)
  const activeRoomRef = useRef<PeerChatRoom | null>(null)
  const pollInFlightRef = useRef(false)
  const roomListPollInFlightRef = useRef(false)
  const actionInFlightRef = useRef(false)
  const unreadScrollPendingRef = useRef(false)
  const isNearMessageBottomRef = useRef(true)
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
  const [profile, setProfile] = useState<PeerChatProfile | null>(null)
  const [profileName, setProfileName] = useState('')
  const [profileBio, setProfileBio] = useState('')
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null)
  const [linkPreviewsEnabled, setLinkPreviewsEnabled] = useState(true)
  const [roomName, setRoomName] = useState('')
  const [roomBio, setRoomBio] = useState('')
  const [roomLink, setRoomLink] = useState('')
  const [roomAvatar, setRoomAvatar] = useState<string | null>(null)
  const [joinKey, setJoinKey] = useState('')
  const [rooms, setRooms] = useState<PeerChatRoom[]>([])
  const [pendingDirectMessages, setPendingDirectMessages] = useState<PeerChatDirectInvite[]>([])
  const [activeRoom, setActiveRoom] = useState<PeerChatRoom | null>(null)
  const [messages, setMessages] = useState<PeerChatMessage[]>([])
  const [newMessagesAfter, setNewMessagesAfter] = useState<number | null>(null)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const [composer, setComposer] = useState('')
  const [replyTarget, setReplyTarget] = useState<PeerChatReply | null>(null)
  const [reactionTargetId, setReactionTargetId] = useState<string | null>(null)
  const [messageActionTarget, setMessageActionTarget] = useState<PeerChatMessage | null>(null)
  const [isMessageInfoVisible, setIsMessageInfoVisible] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [roomSearchQuery, setRoomSearchQuery] = useState('')
  const [showRoomInfo, setShowRoomInfo] = useState(false)
  const [editRoomName, setEditRoomName] = useState('')
  const [editRoomBio, setEditRoomBio] = useState('')
  const [editRoomLink, setEditRoomLink] = useState('')
  const [editRoomAvatar, setEditRoomAvatar] = useState<string | null>(null)
  const [memberSearchQuery, setMemberSearchQuery] = useState('')
  const [showComposerEmoji, setShowComposerEmoji] = useState(false)
  const [landingAction, setLandingAction] = useState<LandingAction>(null)
  const [restoredUiState, setRestoredUiState] = useState<PeerChatUiState | null>(null)
  const mentionCandidates = getMentionCandidates(
    composer,
    activeRoom?.members || [],
    messages,
    profile?.id || ''
  )
  const visibleMessages = filterPeerChatMessages(messages, isSearching ? searchQuery : '') as PeerChatMessage[]
  const firstUnreadIndex = isSearching ? -1 : getFirstUnreadMessageIndex(visibleMessages, newMessagesAfter)
  const visibleRooms = filterPeerChatRooms(rooms, roomSearchQuery) as PeerChatRoom[]
  const visibleMembers = filterPeerChatMembers(
    activeRoom?.members.filter((member) => !member.self) || [],
    memberSearchQuery
  ) as PeerChatMember[]

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
    }
  }, [])

  const callRpc = useCallback((command: number, data: object = {}) => {
    return callRpcRef.current(command, data)
  }, [])

  useEffect(() => {
    activeRoomRef.current = activeRoom
  }, [activeRoom])

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
      setMessages([])
      captureUnreadBoundary(restoredRoom)
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
      if (Array.isArray(response.messages)) setMessages(response.messages)
      if (Number.isSafeInteger(response.version)) versionRef.current = response.version as number
      setError(null)
    } catch (cause) {
      if (mountedRef.current && activeRoomRef.current?.roomKey === room.roomKey) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      pollInFlightRef.current = false
    }
  }, [callRpc])

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
        if (response.profile) {
          setProfile(response.profile)
        }
        setRooms(response.rooms || [])
        setPendingDirectMessages(response.pendingDirectMessages || [])
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
        setError(message)
        onStatus(message)
      }
    } finally {
      actionInFlightRef.current = false
      if (mountedRef.current) setIsBusy(false)
    }
  }

  function chooseAvatar (current: string | null, onChange: (avatar: string | null) => void) {
    if (isBusy) return
    const select = () => void runAction(async () => {
      const selection = await DocumentPicker.getDocumentAsync({
        type: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        copyToCacheDirectory: true,
        multiple: false
      })
      if (selection.canceled || !selection.assets[0]) return

      const asset = selection.assets[0]
      const file = new File(asset.uri)
      const size = asset.size ?? file.size
      if (!Number.isSafeInteger(size) || Number(size) < 1 || Number(size) > MAX_PEERCHAT_AVATAR_FILE_BYTES) {
        throw new Error('Choose an image smaller than 143 KB.')
      }
      const avatar = createPeerChatAvatarDataUrl({
        name: asset.name,
        mimeType: asset.mimeType,
        size,
        base64: await file.base64()
      })
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
    setMessages([])
    setReplyTarget(null)
    setReactionTargetId(null)
    setIsSearching(false)
    setSearchQuery('')
    setShowRoomInfo(false)
    setEditRoomName(room.name)
    setEditRoomBio(room.bio || '')
    setEditRoomLink(room.link || '')
    setEditRoomAvatar(room.avatar || null)
    setMemberSearchQuery('')
    setShowComposerEmoji(false)
    captureUnreadBoundary(room)
    setActiveRoom(room)
    setRooms((current) => current.map((item) => item.roomKey === room.roomKey
      ? { ...item, unreadCount: 0, unreadMentions: 0 }
      : item))
    setError(null)
    onStatus(`Opened PeerChat room ${room.name}`)
  }

  function captureUnreadBoundary (room: PeerChatRoom) {
    const timestamp = room.unreadCount > 0 && Number.isSafeInteger(room.lastReadTs) && room.lastReadTs > 0
      ? room.lastReadTs
      : null
    unreadScrollPendingRef.current = timestamp !== null
    isNearMessageBottomRef.current = timestamp === null
    setShowScrollToLatest(timestamp !== null)
    setNewMessagesAfter(timestamp)
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
        avatar: roomAvatar
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
      openRoom(response.room)
      onStatus('PeerChat room created')
    })
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
      openRoom(response.room)
      onStatus('PeerChat room joined')
    })
  }

  function showRoomActions (room: PeerChatRoom) {
    Alert.alert(
      room.name,
      'Manage this chat on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy key',
          onPress: () => {
            Clipboard.setString(room.roomKey)
            onStatus('PeerChat room key copied')
          }
        },
        {
          text: 'Options',
          onPress: () => showRoomPreferences(room)
        }
      ]
    )
  }

  function showRoomPreferences (room: PeerChatRoom) {
    Alert.alert(
      'Chat options',
      'These preferences apply on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: room.isMuted ? 'Unmute' : 'Mute',
          onPress: () => void updateRoomPreference(room, 'muted')
        },
        {
          text: room.isPinned ? 'Unpin' : 'Pin',
          onPress: () => void updateRoomPreference(room, 'pinned')
        }
      ]
    )
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
    const message = composer.trim()
    if (!activeRoom || !message || isBusy) return
    const selectedReply = replyTarget

    void runAction(async () => {
      const previewUrl = linkPreviewsEnabled ? extractFirstHttpUrl(message) : null
      const preview = previewUrl
        ? await resolveLinkPreview(previewUrl, { fetchFn: expoFetch, timeoutMs: 1500 })
        : null
      const response = await callRpc(RPC_PEERCHAT_SEND, {
        roomKey: activeRoom.roomKey,
        message,
        replyTo: selectedReply,
        preview
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
      onStatus('PeerChat message sent')
    })
  }

  function attachFile () {
    if (!activeRoom || isBusy) return
    void runAction(async () => {
      const selection = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false
      })
      if (selection.canceled || !selection.assets[0]) return

      const asset = selection.assets[0]
      const file = new File(asset.uri)
      const fileSize = asset.size ?? file.size
      if (!Number.isSafeInteger(fileSize) || !fileSize || fileSize > MAX_ATTACHMENT_BYTES) {
        throw new Error('Choose a file between 1 byte and 10 MB.')
      }

      const upload = await callRpc(RPC_HYPER_LIBRARY_UPLOAD, {
        name: asset.name,
        contentBase64: await file.base64(),
        visibility: 'public'
      })
      if (!upload.ok || !upload.item) throw new Error(upload.error || 'Unable to upload attachment.')

      const response = await callRpc(RPC_PEERCHAT_SEND, {
        roomKey: activeRoom.roomKey,
        message: upload.item.url,
        fileName: upload.item.name,
        fileSize: upload.item.byteLength ?? fileSize
      })
      if (!response.ok) throw new Error(response.error || 'Unable to send attachment.')
      versionRef.current = -1
      await refreshRoom(true)
      onStatus(`Sent ${upload.item.name}`)
    })
  }

  function confirmLeaveRoom () {
    if (!activeRoom) return
    Alert.alert(
      'Leave room?',
      `Remove ${activeRoom.name} from recent rooms on this device?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => void runAction(async () => {
            const response = await callRpc(RPC_PEERCHAT_ROOM_LEAVE, {
              roomKey: activeRoom.roomKey
            })
            if (!response.ok) throw new Error(response.error || 'Unable to leave PeerChat room.')
            if (!mountedRef.current) return
            setRooms((current) => current.filter((room) => room.roomKey !== activeRoom.roomKey))
            if (composerRoomKeyRef.current === activeRoom.roomKey) {
              composerRoomKeyRef.current = null
              setComposer('')
            }
            setActiveRoom(null)
            setMessages([])
            setReplyTarget(null)
            setReactionTargetId(null)
            setIsSearching(false)
            setSearchQuery('')
            onStatus('PeerChat room removed')
          })
        }
      ]
    )
  }

  async function shareRoom () {
    if (!activeRoom) return
    try {
      await Share.share({
        title: `Join ${activeRoom.name} on PeerChat`,
        message: activeRoom.roomKey
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

  function reactToMessage (message: PeerChatMessage) {
    setMessageActionTarget(null)
    setReplyTarget(null)
    setReactionTargetId(message.id)
  }

  function replyToMessage (message: PeerChatMessage) {
    setMessageActionTarget(null)
    setReactionTargetId(null)
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
      setReactionTargetId(null)
      versionRef.current = -1
      await refreshRoom(true)
    })
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

  if (activeRoom) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.screen, { backgroundColor: colors.background }]}
      >
        <View style={[styles.chatHeader, { borderBottomColor: colors.border }]}> 
          <Pressable
            accessibilityRole='button'
            onPress={() => {
              setReplyTarget(null)
              setReactionTargetId(null)
              setIsSearching(false)
              setSearchQuery('')
              setActiveRoom(null)
            }}
            style={styles.headerAction}
          >
            <Text style={[styles.headerActionText, { color: colors.accent }]}>Back</Text>
          </Pressable>
          <View style={styles.chatHeaderCopy}>
            {activeRoom.avatar
              ? <Image source={{ uri: activeRoom.avatar }} style={styles.chatHeaderAvatar} />
              : null}
            <View style={styles.chatHeaderText}>
              <Text numberOfLines={1} style={[styles.chatTitle, { color: colors.text }]}>{activeRoom.name}</Text>
              <Text style={[
                styles.connectionText,
                { color: activeRoom.connectionState === 'connected' ? colors.success : colors.muted }
              ]}>
                {formatRoomConnection(activeRoom)}
              </Text>
            </View>
          </View>
          <View style={styles.chatHeaderActions}>
            <Pressable
              accessibilityRole='button'
              onPress={() => setShowRoomInfo((current) => !current)}
              style={styles.headerAction}
            >
              <Text style={[styles.headerActionText, { color: colors.accent }]}>Info</Text>
            </Pressable>
            <Pressable
              accessibilityRole='button'
              onPress={() => {
                setIsSearching((current) => !current)
                if (isSearching) setSearchQuery('')
              }}
              style={styles.headerAction}
            >
              <Text style={[styles.headerActionText, { color: colors.accent }]}>{isSearching ? 'Close' : 'Find'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole='button'
              onPress={() => void shareRoom()}
              style={styles.headerAction}
            >
              <Text style={[styles.headerActionText, { color: colors.accent }]}>Share</Text>
            </Pressable>
          </View>
        </View>

        {showRoomInfo && (
          <ScrollView
            keyboardShouldPersistTaps='handled'
            style={[styles.roomInfoPanel, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
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
              </View>
            )}
            {activeRoom.members.some((member) => !member.self) && (
              <View style={styles.memberList}>
                <Text style={[styles.roomInfoTitle, { color: colors.text }]}>People</Text>
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
                    accessibilityHint='Starts a private conversation'
                    accessibilityRole='button'
                    key={member.id}
                    onPress={() => startDirectMessage(member)}
                    style={[styles.memberRow, { backgroundColor: colors.input }]}
                  >
                    {member.avatar
                      ? <Image source={{ uri: member.avatar }} style={styles.memberAvatar} />
                      : (
                        <View style={[styles.memberAvatarFallback, { backgroundColor: colors.accentSoft }]}>
                          <Text style={[styles.memberAvatarText, { color: colors.accent }]}>{getRoomInitials(member.username)}</Text>
                        </View>
                        )}
                    <View style={styles.memberCopy}>
                      <Text style={[styles.memberName, { color: colors.text }]}>{member.username}</Text>
                      {!!member.bio && <Text numberOfLines={1} style={[styles.attachmentMeta, { color: colors.muted }]}>{member.bio}</Text>}
                    </View>
                    <Text style={[styles.memberMessage, { color: colors.accent }]}>Message</Text>
                  </Pressable>
                ))}
                {visibleMembers.length === 0 && (
                  <Text style={[styles.helper, { color: colors.muted }]}>No matching people.</Text>
                )}
              </View>
            )}
          </ScrollView>
        )}

        {activeRoom.isDM && activeRoom.pendingAcceptance && (
          <Text style={[styles.dmStatus, { color: colors.muted, backgroundColor: colors.surface }]}>Waiting for this peer to accept your message request.</Text>
        )}
        {activeRoom.isDM && activeRoom.rejected && (
          <Text style={[styles.dmStatus, { color: colors.danger, backgroundColor: colors.surface }]}>This peer declined the message request.</Text>
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
          data={visibleMessages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={visibleMessages.length > 0 ? styles.messageList : styles.emptyMessageList}
          onContentSizeChange={() => {
            if (isSearching) return
            if (unreadScrollPendingRef.current && firstUnreadIndex >= 0) {
              unreadScrollPendingRef.current = false
              isNearMessageBottomRef.current = false
              setShowScrollToLatest(true)
              messageListRef.current?.scrollToIndex({ animated: false, index: firstUnreadIndex, viewPosition: 0 })
            } else if (isNearMessageBottomRef.current) {
              messageListRef.current?.scrollToEnd({ animated: false })
            }
          }}
          onScroll={({ nativeEvent }) => {
            if (isSearching || unreadScrollPendingRef.current) return
            const nearBottom = isPeerChatNearBottom({
              contentHeight: nativeEvent.contentSize.height,
              viewportHeight: nativeEvent.layoutMeasurement.height,
              offsetY: nativeEvent.contentOffset.y
            })
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
            const previousDateLabel = index > 0
              ? formatPeerChatDateLabel(visibleMessages[index - 1].timestamp)
              : ''
            return (
              <>
              {index === firstUnreadIndex && (
                <View accessibilityRole='text' style={styles.unreadDivider}>
                  <View style={[styles.unreadDividerLine, { backgroundColor: colors.accent }]} />
                  <Text style={[styles.unreadDividerText, { color: colors.accent }]}>New messages</Text>
                  <View style={[styles.unreadDividerLine, { backgroundColor: colors.accent }]} />
                </View>
              )}
              {!!dateLabel && dateLabel !== previousDateLabel && (
                <View accessibilityRole='text' style={styles.dateDivider}>
                  <View style={[styles.dateDividerLine, { backgroundColor: colors.border }]} />
                  <Text style={[styles.dateDividerText, { color: colors.muted }]}>{dateLabel}</Text>
                  <View style={[styles.dateDividerLine, { backgroundColor: colors.border }]} />
                </View>
              )}
              <View style={[styles.messageRow, item.self ? styles.messageRowSelf : null]}>
              <Pressable
                accessibilityHint='Long press for message actions'
                accessibilityRole='button'
                onLongPress={() => showMessageActions(item)}
                style={[
                  styles.messageBubble,
                  { backgroundColor: item.self ? colors.selfBubble : colors.peerBubble }
                ]}
              >
                {!item.self && (
                  <Text style={[styles.senderName, { color: colors.accent }]}>{item.senderName}</Text>
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
                    <Pressable
                      accessibilityHint='Opens this Hyperdrive attachment'
                      accessibilityRole='link'
                      onPress={() => onOpenUrl(item.message)}
                      style={[styles.attachmentCard, { backgroundColor: colors.input, borderColor: colors.border }]}
                    >
                      <Text style={[styles.attachmentIcon, { color: colors.accent }]}>+</Text>
                      <View style={styles.attachmentCopy}>
                        <Text numberOfLines={1} style={[styles.attachmentName, { color: colors.text }]}>{item.fileName}</Text>
                        <Text style={[styles.attachmentMeta, { color: colors.muted }]}>{formatFileSize(item.fileSize)}</Text>
                      </View>
                    </Pressable>
                    )
                  : (
                    <>
                      <Text selectable style={[styles.messageText, { color: colors.text }]}>
                        {renderMessageText(item.message, profile?.username || '', colors.accent)}
                      </Text>
                      {item.preview && (
                        <Pressable
                          accessibilityHint='Opens the linked page'
                          accessibilityRole='link'
                          onPress={() => onOpenUrl(item.preview?.url || '')}
                          style={[styles.linkPreview, { backgroundColor: colors.input, borderColor: colors.border }]}
                        >
                          <Text numberOfLines={1} style={[styles.linkPreviewHost, { color: colors.accent }]}>
                            {item.preview.host || item.preview.url}
                          </Text>
                          {!!item.preview.title && (
                            <Text numberOfLines={2} style={[styles.linkPreviewTitle, { color: colors.text }]}>{item.preview.title}</Text>
                          )}
                          {!!item.preview.description && (
                            <Text numberOfLines={2} style={[styles.linkPreviewDescription, { color: colors.muted }]}>{item.preview.description}</Text>
                          )}
                        </Pressable>
                      )}
                    </>
                    )}
                {item.reactions && item.reactions.length > 0 && (
                  <View style={styles.reactionRow}>
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
                            backgroundColor: reaction.self ? colors.accentSoft : colors.input,
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
                <Text style={[styles.messageTime, { color: colors.muted }]}>
                  {formatMessageTime(item.timestamp)}
                </Text>
              </Pressable>
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
                messageListRef.current?.scrollToEnd({ animated: true })
              }}
              style={[styles.scrollToLatest, { backgroundColor: colors.accent }]}
            >
              <Text style={styles.scrollToLatestText}>Latest</Text>
            </Pressable>
          )}
        </View>

        {error && <Text style={[styles.inlineError, { color: colors.danger }]}>{error}</Text>}

        {reactionTargetId && (
          <View style={[styles.reactionPicker, { borderTopColor: colors.border, backgroundColor: colors.input }]}>
            {QUICK_REACTIONS.map((emoji) => (
              <Pressable
                accessibilityLabel={`React with ${emoji}`}
                accessibilityRole='button'
                disabled={isBusy}
                key={emoji}
                onPress={() => sendReaction(reactionTargetId, emoji)}
                style={[styles.reactionPickerButton, isBusy ? styles.disabled : null]}
              >
                <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityLabel='Close reaction picker'
              accessibilityRole='button'
              hitSlop={8}
              onPress={() => setReactionTargetId(null)}
              style={styles.cancelReply}
            >
              <Text style={[styles.cancelReplyText, { color: colors.muted }]}>x</Text>
            </Pressable>
          </View>
        )}
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
          <View style={[styles.reactionPicker, { borderTopColor: colors.border, backgroundColor: colors.input }]}>
            {QUICK_REACTIONS.map((emoji) => (
              <Pressable
                accessibilityLabel={`Insert ${emoji}`}
                accessibilityRole='button'
                key={emoji}
                onPress={() => setComposer((current) => `${current}${emoji}`)}
                style={styles.reactionPickerButton}
              >
                <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={[styles.composer, { borderTopColor: colors.border }]}> 
          <Pressable
            accessibilityLabel='Choose emoji'
            accessibilityRole='button'
            disabled={isBusy || activeRoom.pendingAcceptance || activeRoom.rejected}
            onPress={() => setShowComposerEmoji((current) => !current)}
            style={[styles.emojiButton, { backgroundColor: colors.input }]}
          >
            <Text style={[styles.emojiButtonText, { color: colors.accent }]}>:)</Text>
          </Pressable>
          <Pressable
            accessibilityLabel='Attach file'
            accessibilityRole='button'
            disabled={isBusy || activeRoom.pendingAcceptance || activeRoom.rejected}
            onPress={attachFile}
            style={[
              styles.attachButton,
              { backgroundColor: colors.input },
              isBusy || activeRoom.pendingAcceptance || activeRoom.rejected ? styles.disabled : null
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
            editable={!activeRoom.pendingAcceptance && !activeRoom.rejected}
            maxLength={64 * 1024}
            style={[
              styles.composerInput,
              { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }
            ]}
          />
          <Pressable
            accessibilityRole='button'
            disabled={!composer.trim() || isBusy || activeRoom.pendingAcceptance || activeRoom.rejected}
            onPress={sendMessage}
            style={[
              styles.sendButton,
              { backgroundColor: colors.accent },
              !composer.trim() || isBusy || activeRoom.pendingAcceptance || activeRoom.rejected ? styles.disabled : null
            ]}
          >
            <Text style={styles.sendButtonText}>Send</Text>
          </Pressable>
        </View>
        <Pressable accessibilityRole='button' onPress={confirmLeaveRoom} style={styles.leaveAction}>
          <Text style={[styles.leaveText, { color: colors.danger }]}>Leave room</Text>
        </Pressable>
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
                      <Pressable accessibilityRole='button' onPress={() => reactToMessage(messageActionTarget)} style={styles.actionSheetAction}>
                        <Text style={[styles.actionSheetActionText, { color: colors.text }]}>React</Text>
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
      </KeyboardAvoidingView>
    )
  }

  return (
    <FlatList
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.landingContent}
      data={visibleRooms}
      keyExtractor={(item) => item.roomKey}
      ListHeaderComponent={(
        <View style={styles.landingHeader}>
          <View style={styles.titleRow}>
            <Image source={PEERCHAT_ICON} style={styles.logo} />
            <View style={styles.titleCopy}>
              <Text style={[styles.title, { color: colors.text }]}>PeerChat</Text>
              <Text style={[styles.helper, { color: colors.muted }]}>Private peer-to-peer conversations</Text>
            </View>
          </View>

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
            {profile?.username !== profileName.trim() ||
            (profile?.bio || '') !== profileBio.trim() ||
            (profile?.avatar || null) !== profileAvatar ||
            profile?.linkPreview !== linkPreviewsEnabled ? (
              <Pressable
                accessibilityRole='button'
                disabled={!profileName.trim() || isBusy}
                onPress={() => void runAction(saveProfile)}
                style={[styles.profileSaveButton, { backgroundColor: colors.accent }, !profileName.trim() || isBusy ? styles.disabled : null]}
              >
                <Text style={styles.profileSaveText}>Save</Text>
              </Pressable>
              ) : null}
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
            style={[styles.preferenceRow, { backgroundColor: colors.surface }]}
          >
            <View style={styles.preferenceCopy}>
              <Text style={[styles.memberName, { color: colors.text }]}>Link previews</Text>
              <Text style={[styles.attachmentMeta, { color: colors.muted }]}>Fetch page details only when you send a link</Text>
            </View>
            <Text style={[styles.preferenceState, { color: linkPreviewsEnabled ? colors.accent : colors.muted }]}>
              {linkPreviewsEnabled ? 'On' : 'Off'}
            </Text>
          </Pressable>

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
                <Text style={[styles.pinnedLabel, { color: colors.accent, backgroundColor: colors.accentSoft }]}>PINNED</Text>
              )}
              {item.isMuted && (
                <Text style={[styles.pinnedLabel, { color: colors.muted, backgroundColor: colors.input }]}>MUTED</Text>
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
  )
}

function getRoomInitials (name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'PC'
}

function renderMessageText (message: string, username: string, mentionColor: string) {
  if (!username) return message
  const mention = `@${username}`
  const lowerMessage = message.toLocaleLowerCase()
  const lowerMention = mention.toLocaleLowerCase()
  const parts = []
  let cursor = 0
  let index = lowerMessage.indexOf(lowerMention)
  while (index !== -1) {
    if (index > cursor) parts.push(message.slice(cursor, index))
    parts.push(
      <Text key={`${index}-${parts.length}`} style={{ color: mentionColor, fontWeight: '800' }}>
        {message.slice(index, index + mention.length)}
      </Text>
    )
    cursor = index + mention.length
    index = lowerMessage.indexOf(lowerMention, cursor)
  }
  if (cursor < message.length) parts.push(message.slice(cursor))
  return parts.length > 0 ? parts : message
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
      self: false
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
  return `${composer.slice(0, atIndex)}@${username} `
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
  landingContent: { paddingBottom: 28 },
  landingHeader: { gap: 12, paddingHorizontal: 16, paddingTop: 14 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  logo: { borderRadius: 10, height: 38, width: 38 },
  titleCopy: { flex: 1 },
  title: { fontSize: 21, fontWeight: '900' },
  helper: { fontSize: 13, lineHeight: 19 },
  profileRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  profileAvatar: { borderRadius: 21, height: 42, width: 42 },
  profileAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  profileInput: { flex: 1 },
  bioInput: { maxHeight: 92, minHeight: 52, textAlignVertical: 'top' },
  profileSaveButton: { alignItems: 'center', borderRadius: 10, justifyContent: 'center', minHeight: 42, paddingHorizontal: 14 },
  profileSaveText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  input: { borderRadius: 10, borderWidth: 0, fontSize: 14, minHeight: 42, paddingHorizontal: 12, paddingVertical: 9 },
  roomKeyInput: { fontFamily: 'monospace', fontSize: 13 },
  quickActions: { flexDirection: 'row', gap: 10 },
  quickAction: { alignItems: 'center', borderRadius: 12, flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 48, paddingHorizontal: 10 },
  quickActionSymbol: { fontSize: 20, fontWeight: '500' },
  quickActionText: { fontSize: 14, fontWeight: '800' },
  actionPanel: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 8, padding: 8 },
  createActionPanel: { alignItems: 'stretch', flexDirection: 'column' },
  createActionInput: { width: '100%' },
  actionInput: { flex: 1 },
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
  pinnedLabel: { borderRadius: 5, fontSize: 8, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 5, paddingVertical: 2 },
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
  chatHeaderText: { alignItems: 'center', flex: 1 },
  chatHeaderActions: { flexDirection: 'row' },
  roomInfoPanel: { borderBottomWidth: 1, maxHeight: '55%' },
  roomInfo: { gap: 8, padding: 10 },
  roomProvenance: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  roomInfoTitle: { fontSize: 15, fontWeight: '800' },
  roomInfoLink: { fontSize: 12, textDecorationLine: 'underline' },
  roomInfoSave: { alignItems: 'center', alignSelf: 'flex-end', borderRadius: 9, minHeight: 38, justifyContent: 'center', paddingHorizontal: 14 },
  avatarEditor: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 8, minHeight: 38 },
  avatarEditorImage: { borderRadius: 18, height: 36, width: 36 },
  memberList: { gap: 6, marginTop: 2 },
  memberRow: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 8, minHeight: 46, paddingHorizontal: 9, paddingVertical: 6 },
  memberAvatar: { borderRadius: 16, height: 32, width: 32 },
  memberAvatarFallback: { alignItems: 'center', borderRadius: 16, height: 32, justifyContent: 'center', width: 32 },
  memberAvatarText: { fontSize: 10, fontWeight: '900' },
  memberCopy: { flex: 1 },
  memberName: { fontSize: 13, fontWeight: '800' },
  memberMessage: { fontSize: 12, fontWeight: '800' },
  dmStatus: { fontSize: 12, paddingHorizontal: 12, paddingVertical: 8, textAlign: 'center' },
  chatTitle: { fontSize: 16, fontWeight: '800', maxWidth: '100%' },
  connectionText: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  headerAction: { alignItems: 'center', minWidth: 52, paddingHorizontal: 5, paddingVertical: 11 },
  headerActionText: { fontSize: 13, fontWeight: '800' },
  searchRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingVertical: 7 },
  searchInput: { borderRadius: 16, flex: 1, fontSize: 14, minHeight: 36, paddingHorizontal: 12, paddingVertical: 7 },
  searchCount: { fontSize: 11, minWidth: 24, textAlign: 'center' },
  messageListContainer: { flex: 1 },
  messageList: { padding: 14, paddingBottom: 8 },
  emptyMessageList: { flexGrow: 1, justifyContent: 'center' },
  unreadDivider: { alignItems: 'center', flexDirection: 'row', gap: 9, marginBottom: 14, marginTop: 5 },
  unreadDividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  unreadDividerText: { fontSize: 11, fontWeight: '700' },
  dateDivider: { alignItems: 'center', flexDirection: 'row', gap: 9, marginBottom: 12, marginTop: 4 },
  dateDividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dateDividerText: { fontSize: 11, fontWeight: '600' },
  messageRow: { alignItems: 'flex-start', marginBottom: 9 },
  messageRowSelf: { alignItems: 'flex-end' },
  messageBubble: { borderRadius: 15, maxWidth: '84%', minWidth: 84, paddingHorizontal: 12, paddingVertical: 8 },
  quotedReply: { borderLeftWidth: 3, borderRadius: 7, marginBottom: 6, paddingHorizontal: 8, paddingVertical: 5 },
  quotedReplySender: { fontSize: 11, fontWeight: '800' },
  quotedReplyText: { fontSize: 11, lineHeight: 15 },
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  reactionBubble: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  reactionText: { fontSize: 12 },
  senderName: { fontSize: 11, fontWeight: '800', marginBottom: 3 },
  messageText: { fontSize: 15, lineHeight: 20 },
  attachmentCard: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 9, minWidth: 190, padding: 9 },
  attachmentIcon: { fontSize: 24, fontWeight: '500' },
  attachmentCopy: { flex: 1 },
  attachmentName: { fontSize: 13, fontWeight: '800' },
  attachmentMeta: { fontSize: 10, marginTop: 2 },
  linkPreview: { borderRadius: 9, borderWidth: 1, gap: 2, marginTop: 7, padding: 8 },
  linkPreviewHost: { fontSize: 10, fontWeight: '700' },
  linkPreviewTitle: { fontSize: 13, fontWeight: '800' },
  linkPreviewDescription: { fontSize: 11, lineHeight: 15 },
  preferenceRow: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 10, padding: 11 },
  preferenceCopy: { flex: 1 },
  preferenceState: { fontSize: 12, fontWeight: '900' },
  messageTime: { alignSelf: 'flex-end', fontSize: 10, marginTop: 4 },
  scrollToLatest: { alignItems: 'center', borderRadius: 18, bottom: 10, elevation: 3, justifyContent: 'center', minHeight: 36, paddingHorizontal: 14, position: 'absolute', right: 14 },
  scrollToLatestText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  inlineError: { fontSize: 12, paddingHorizontal: 14, paddingVertical: 5, textAlign: 'center' },
  reactionPicker: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8, paddingVertical: 6 },
  reactionPickerButton: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  reactionPickerEmoji: { fontSize: 22 },
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
  sendButton: { alignItems: 'center', borderRadius: 20, height: 42, justifyContent: 'center', paddingHorizontal: 16 },
  sendButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  leaveAction: { alignItems: 'center', paddingBottom: 7, paddingTop: 2 },
  leaveText: { fontSize: 11, fontWeight: '700' },
  actionSheetRoot: { flex: 1, justifyContent: 'flex-end' },
  actionSheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  actionSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 18, paddingHorizontal: 18, paddingTop: 16 },
  actionSheetTitle: { fontSize: 16, fontWeight: '800' },
  actionSheetPreview: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  actionSheetDivider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  actionSheetDetails: { fontSize: 14, lineHeight: 20, minHeight: 48, paddingVertical: 8 },
  actionSheetAction: { justifyContent: 'center', minHeight: 48, paddingHorizontal: 4 },
  actionSheetActionText: { fontSize: 16, fontWeight: '600' }
})
