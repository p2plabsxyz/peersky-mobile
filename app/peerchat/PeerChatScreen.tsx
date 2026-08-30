import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'

import {
  RPC_PEERCHAT_INIT,
  RPC_PEERCHAT_PROFILE_SET,
  RPC_PEERCHAT_ROOM_CREATE,
  RPC_PEERCHAT_ROOM_JOIN,
  RPC_PEERCHAT_ROOM_LEAVE,
  RPC_PEERCHAT_ROOMS,
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
  isHost: boolean
  createdAt: number
  lastMessage: PeerChatLastMessage | null
  peerCount: number
}

type PeerChatProfile = {
  id: string
  username: string
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
}

type PeerChatScreenProps = {
  isDark: boolean
  onCallRpc: (command: number, data?: object) => Promise<PeerChatResponse>
  onStatus: (message: string) => void
}

const POLL_INTERVAL_MS = 1500
const ROOM_LIST_POLL_INTERVAL_MS = 3000
const PEERCHAT_ICON = require('../../assets/images/peerchat.png')

type LandingAction = 'create' | 'join' | null

export function PeerChatScreen ({ isDark, onCallRpc, onStatus }: PeerChatScreenProps) {
  const colors = isDark ? darkColors : lightColors
  const callRpcRef = useRef(onCallRpc)
  const messageListRef = useRef<FlatList<PeerChatMessage> | null>(null)
  const versionRef = useRef(-1)
  const activeRoomRef = useRef<PeerChatRoom | null>(null)
  const pollInFlightRef = useRef(false)
  const roomListPollInFlightRef = useRef(false)
  const actionInFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const [isReady, setIsReady] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<PeerChatProfile | null>(null)
  const [profileName, setProfileName] = useState('')
  const [roomName, setRoomName] = useState('')
  const [joinKey, setJoinKey] = useState('')
  const [rooms, setRooms] = useState<PeerChatRoom[]>([])
  const [activeRoom, setActiveRoom] = useState<PeerChatRoom | null>(null)
  const [messages, setMessages] = useState<PeerChatMessage[]>([])
  const [composer, setComposer] = useState('')
  const [landingAction, setLandingAction] = useState<LandingAction>(null)

  useEffect(() => {
    callRpcRef.current = onCallRpc
  }, [onCallRpc])

  useEffect(() => {
    mountedRef.current = true
    return () => {
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
    if (!activeRoom) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setActiveRoom(null)
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
        setRooms(response.rooms || [])
        versionRef.current = Number.isSafeInteger(response.version) ? response.version as number : -1
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
    const response = await callRpc(RPC_PEERCHAT_PROFILE_SET, { username: profileName })
    if (!response.ok || !response.profile) {
      throw new Error(response.error || 'Unable to save PeerChat name.')
    }
    if (!mountedRef.current) return
    setProfile(response.profile)
    setProfileName(response.profile.username)
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

  function openRoom (room: PeerChatRoom) {
    versionRef.current = -1
    setMessages([])
    setActiveRoom(room)
    setError(null)
    onStatus(`Opened PeerChat room ${room.name}`)
  }

  function createRoom () {
    void runAction(async () => {
      await saveProfile()
      const response = await callRpc(RPC_PEERCHAT_ROOM_CREATE, {
        name: roomName
      })
      if (!response.ok || !response.room) {
        throw new Error(response.error || 'Unable to create PeerChat room.')
      }
      if (!mountedRef.current) return
      setRooms((current) => [response.room as PeerChatRoom, ...current])
      setRoomName('')
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

  function sendMessage () {
    const message = composer.trim()
    if (!activeRoom || !message || isBusy) return

    void runAction(async () => {
      const response = await callRpc(RPC_PEERCHAT_SEND, {
        roomKey: activeRoom.roomKey,
        message
      })
      if (!response.ok) throw new Error(response.error || 'Unable to send PeerChat message.')
      if (!mountedRef.current) return
      setComposer('')
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
            setActiveRoom(null)
            setMessages([])
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

  if (!isReady) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={[styles.helper, { color: colors.muted }]}>Starting PeerChat...</Text>
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
          <Pressable accessibilityRole='button' onPress={() => setActiveRoom(null)} style={styles.headerAction}>
            <Text style={[styles.headerActionText, { color: colors.accent }]}>Back</Text>
          </Pressable>
          <View style={styles.chatHeaderCopy}>
            <Text numberOfLines={1} style={[styles.chatTitle, { color: colors.text }]}>{activeRoom.name}</Text>
            <Text style={[styles.connectionText, { color: activeRoom.peerCount > 0 ? colors.success : colors.muted }]}>
              {activeRoom.peerCount > 0
                ? `${activeRoom.peerCount} peer${activeRoom.peerCount === 1 ? '' : 's'} connected`
                : 'Waiting for peers'}
            </Text>
          </View>
          <Pressable
            accessibilityRole='button'
            onPress={() => void shareRoom()}
            style={styles.headerAction}
          >
            <Text style={[styles.headerActionText, { color: colors.accent }]}>Share</Text>
          </Pressable>
        </View>

        <FlatList
          ref={messageListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={messages.length > 0 ? styles.messageList : styles.emptyMessageList}
          onContentSizeChange={() => messageListRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => (
            <View style={[styles.messageRow, item.self ? styles.messageRowSelf : null]}>
              <View style={[
                styles.messageBubble,
                { backgroundColor: item.self ? colors.selfBubble : colors.peerBubble }
              ]}>
                {!item.self && (
                  <Text style={[styles.senderName, { color: colors.accent }]}>{item.senderName}</Text>
                )}
                <Text selectable style={[styles.messageText, { color: colors.text }]}>{item.message}</Text>
                <Text style={[styles.messageTime, { color: colors.muted }]}>
                  {formatMessageTime(item.timestamp)}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={(
            <View style={styles.emptyState}>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No messages yet</Text>
              <Text style={[styles.helper, { color: colors.muted }]}>Share the room key, then start the conversation.</Text>
            </View>
          )}
        />

        {error && <Text style={[styles.inlineError, { color: colors.danger }]}>{error}</Text>}

        <View style={[styles.composer, { borderTopColor: colors.border }]}> 
          <TextInput
            value={composer}
            onChangeText={setComposer}
            placeholder='Message'
            placeholderTextColor={colors.muted}
            multiline
            maxLength={64 * 1024}
            style={[
              styles.composerInput,
              { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }
            ]}
          />
          <Pressable
            accessibilityRole='button'
            disabled={!composer.trim() || isBusy}
            onPress={sendMessage}
            style={[
              styles.sendButton,
              { backgroundColor: colors.accent },
              !composer.trim() || isBusy ? styles.disabled : null
            ]}
          >
            <Text style={styles.sendButtonText}>Send</Text>
          </Pressable>
        </View>
        <Pressable accessibilityRole='button' onPress={confirmLeaveRoom} style={styles.leaveAction}>
          <Text style={[styles.leaveText, { color: colors.danger }]}>Leave room</Text>
        </Pressable>
      </KeyboardAvoidingView>
    )
  }

  return (
    <FlatList
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.landingContent}
      data={rooms}
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
            {profile?.username !== profileName.trim() && (
              <Pressable
                accessibilityRole='button'
                disabled={!profileName.trim() || isBusy}
                onPress={() => void runAction(saveProfile)}
                style={[styles.profileSaveButton, { backgroundColor: colors.accent }, !profileName.trim() || isBusy ? styles.disabled : null]}
              >
                <Text style={styles.profileSaveText}>Save</Text>
              </Pressable>
            )}
          </View>

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
            <View style={[styles.actionPanel, { backgroundColor: colors.surface }]}>
              <TextInput
                value={roomName}
                onChangeText={setRoomName}
                maxLength={80}
                placeholder='Group name'
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.actionInput, { backgroundColor: colors.input, color: colors.text }]}
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
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent chats</Text>
            {rooms.length > 0 && <Text style={[styles.roomCount, { color: colors.muted }]}>{rooms.length}</Text>}
          </View>
        </View>
      )}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole='button'
          onPress={() => openRoom(item)}
          style={({ pressed }) => [
            styles.roomRow,
            { borderBottomColor: colors.border },
            pressed ? { backgroundColor: colors.input } : null
          ]}
        >
          <View style={[styles.roomAvatar, { backgroundColor: colors.accentSoft }]}> 
            <Text style={[styles.roomAvatarText, { color: colors.accent }]}>{getRoomInitials(item.name)}</Text>
          </View>
          <View style={styles.roomCopy}>
            <Text numberOfLines={1} style={[styles.roomTitle, { color: colors.text }]}>{item.name}</Text>
            <Text numberOfLines={1} style={[styles.roomPreview, { color: colors.muted }]}>
              {item.lastMessage
                ? `${item.lastMessage.senderName}: ${item.lastMessage.message}`
                : `${item.roomKey.slice(0, 10)}...`}
            </Text>
          </View>
          <View style={styles.roomMeta}>
            <Text style={[styles.roomTime, { color: colors.muted }]}>{formatRoomTime(item)}</Text>
            <Text style={[styles.roomPeerCount, { color: item.peerCount > 0 ? colors.success : colors.muted }]}>
              {item.peerCount > 0 ? `${item.peerCount} online` : 'Offline'}
            </Text>
          </View>
        </Pressable>
      )}
      ListEmptyComponent={(
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No rooms yet</Text>
          <Text style={[styles.helper, { color: colors.muted }]}>Create a room or join one shared from PeerSky Desktop.</Text>
        </View>
      )}
    />
  )
}

function getRoomInitials (name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'PC'
}

function formatMessageTime (timestamp: number) {
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
  landingContent: { paddingBottom: 28 },
  landingHeader: { gap: 12, paddingHorizontal: 16, paddingTop: 14 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  logo: { borderRadius: 10, height: 38, width: 38 },
  titleCopy: { flex: 1 },
  title: { fontSize: 21, fontWeight: '900' },
  helper: { fontSize: 13, lineHeight: 19 },
  profileRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  profileInput: { flex: 1 },
  profileSaveButton: { alignItems: 'center', borderRadius: 10, justifyContent: 'center', minHeight: 42, paddingHorizontal: 14 },
  profileSaveText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  input: { borderRadius: 10, borderWidth: 0, fontSize: 14, minHeight: 42, paddingHorizontal: 12, paddingVertical: 9 },
  roomKeyInput: { fontFamily: 'monospace', fontSize: 13 },
  quickActions: { flexDirection: 'row', gap: 10 },
  quickAction: { alignItems: 'center', borderRadius: 12, flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 48, paddingHorizontal: 10 },
  quickActionSymbol: { fontSize: 20, fontWeight: '500' },
  quickActionText: { fontSize: 14, fontWeight: '800' },
  actionPanel: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 8, padding: 8 },
  actionInput: { flex: 1 },
  actionSubmit: { alignItems: 'center', borderRadius: 9, justifyContent: 'center', minHeight: 42, minWidth: 72, paddingHorizontal: 14 },
  actionSubmitText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  error: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  sectionTitle: { fontSize: 16, fontWeight: '900' },
  roomCount: { fontSize: 12, fontWeight: '700' },
  roomRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 11, minHeight: 72, paddingHorizontal: 16, paddingVertical: 10 },
  roomAvatar: { alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  roomAvatarText: { fontSize: 14, fontWeight: '900' },
  roomCopy: { flex: 1, gap: 4 },
  roomTitle: { fontSize: 15, fontWeight: '800' },
  roomPreview: { fontSize: 12 },
  roomMeta: { alignItems: 'flex-end', gap: 5 },
  roomTime: { fontSize: 10 },
  roomPeerCount: { fontSize: 11, fontWeight: '700' },
  emptyState: { alignItems: 'center', gap: 5, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 36 },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  chatHeader: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 62, paddingHorizontal: 8 },
  chatHeaderCopy: { alignItems: 'center', flex: 1, paddingHorizontal: 5 },
  chatTitle: { fontSize: 16, fontWeight: '800', maxWidth: '100%' },
  connectionText: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  headerAction: { alignItems: 'center', minWidth: 58, paddingHorizontal: 7, paddingVertical: 11 },
  headerActionText: { fontSize: 13, fontWeight: '800' },
  messageList: { padding: 14, paddingBottom: 8 },
  emptyMessageList: { flexGrow: 1, justifyContent: 'center' },
  messageRow: { alignItems: 'flex-start', marginBottom: 9 },
  messageRowSelf: { alignItems: 'flex-end' },
  messageBubble: { borderRadius: 15, maxWidth: '84%', minWidth: 84, paddingHorizontal: 12, paddingVertical: 8 },
  senderName: { fontSize: 11, fontWeight: '800', marginBottom: 3 },
  messageText: { fontSize: 15, lineHeight: 20 },
  messageTime: { alignSelf: 'flex-end', fontSize: 10, marginTop: 4 },
  inlineError: { fontSize: 12, paddingHorizontal: 14, paddingVertical: 5, textAlign: 'center' },
  composer: { alignItems: 'flex-end', borderTopWidth: 1, flexDirection: 'row', gap: 8, padding: 10 },
  composerInput: { borderRadius: 18, borderWidth: 1, flex: 1, fontSize: 15, maxHeight: 112, minHeight: 42, paddingHorizontal: 13, paddingVertical: 9 },
  sendButton: { alignItems: 'center', borderRadius: 20, height: 42, justifyContent: 'center', paddingHorizontal: 16 },
  sendButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  leaveAction: { alignItems: 'center', paddingBottom: 7, paddingTop: 2 },
  leaveText: { fontSize: 11, fontWeight: '700' }
})
