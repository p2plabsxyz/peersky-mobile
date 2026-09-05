import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import b4a from 'b4a'

import {
  decodeMessagePayload,
  encodeMessagePayload,
  extractFirstHttpUrl,
  resolveLinkPreview,
  sanitizePreview
} from './link-preview.mjs'
import {
  checkPeerChatContent,
  createPeerChatModerator,
  DEFAULT_PEERCHAT_MODERATION,
  normalizePeerChatModeration
} from './moderation.mjs'
import {
  createPeerChatMessageId,
  createPeerChatRoomKey,
  decryptPeerChatMessage,
  derivePeerChatDirectRoomKey,
  derivePeerChatTopic,
  encryptPeerChatMessage,
  getPeerChatMessageByteLength,
  getSharedPeerChatRooms,
  MAX_PEERCHAT_FRAME_BYTES,
  MAX_PEERCHAT_MESSAGE_BYTES,
  normalizePeerChatAvatar,
  normalizePeerChatAttachment,
  normalizePeerChatBio,
  normalizePeerChatLink,
  normalizePeerChatMessage,
  normalizePeerChatPeerId,
  normalizePeerChatProfileName,
  normalizePeerChatReaction,
  normalizePeerChatReply,
  normalizePeerChatRoomKey,
  normalizePeerChatRoomName,
  normalizePeerChatTimestamp,
  peerChatTopicHex
} from './protocol.mjs'
import { attachPeerChatTransport } from './transport.mjs'

const MAX_ROOMS = 50
const MAX_RETURNED_MESSAGES = 200
const MAX_RETURNED_ENTRIES = 1000
const MAX_SYNC_MESSAGES = 200
const MAX_SEEN_MESSAGE_IDS = 10_000
const MAX_FRAME_LENGTH = MAX_PEERCHAT_FRAME_BYTES
export const MAX_PEERCHAT_STORED_MESSAGES_PER_ROOM = 5000
export const MAX_PEERCHAT_ROOM_STORAGE_BYTES = 16 * 1024 * 1024
export const MAX_PEERCHAT_TOTAL_STORAGE_BYTES = 128 * 1024 * 1024
const LIVE_RATE_WINDOW_MS = 60_000
const MAX_LIVE_MESSAGES_PER_WINDOW = 120
const MAX_CONTROL_MESSAGES_PER_WINDOW = 60
const MAX_INITIAL_SYNC_MESSAGES_PER_CONNECTION = 500
const MAX_PENDING_MESSAGES_PER_CONNECTION = 256
const MAX_RETURNED_ROOM_MEMBERS = 100
const MAX_PENDING_DIRECT_MESSAGES = 50
const PERSIST_DELAY_MS = 500
const PING_INTERVAL_MS = 25_000
const PEER_LIVENESS_TIMEOUT_MS = 60_000
const MAX_ANNOUNCED_TOPICS = 512

export class PeerChatService {
  constructor ({ sdk, storagePath }) {
    this.sdk = sdk
    this.storagePath = storagePath
    this.stateFilePath = `${storagePath}/peerchat-mobile.json`
    this.localId = sdk.publicKey
      ? b4a.toString(sdk.publicKey, 'hex').slice(0, 8).toLowerCase()
      : 'mobile'
    this.profile = { username: '', bio: '', avatar: null, linkPreview: true }
    this.rooms = new Map()
    this.pendingDirectMessages = new Map()
    this.moderator = createPeerChatModerator()
    this.feeds = new Map()
    this.feedListeners = new Map()
    this.pendingJoins = new Map()
    this.roomStorageBytes = new Map()
    this.totalStoredBytes = 0
    this.joinedRooms = new Set()
    this.discoveryKeys = new Map()
    this.peers = new Map()
    this.pendingPeers = new Map()
    this.seenIds = new Set()
    this.activeRoomKey = null
    this.version = 0
    this.persistTimer = null
    this.started = false
    this.closed = false
    this.onConnection = this.handleConnection.bind(this)
    this.onTopicsChange = this.handleTopicsChange.bind(this)
  }

  async start () {
    if (this.started) return this
    this.started = true
    this.loadState()

    this.sdk.swarm.on('connection', this.onConnection)
    this.sdk.localSwarm?.on('topics-change', this.onTopicsChange)

    for (const roomKey of this.rooms.keys()) {
      try {
        await this.joinRoomNetwork(roomKey)
      } catch (error) {
        console.warn(`[peerchat] Unable to rejoin ${roomKey.slice(0, 8)}: ${error.message}`)
      }
    }

    return this
  }

  getProfile () {
    return {
      id: this.localId,
      username: this.profile.username || '',
      bio: this.profile.bio || '',
      avatar: this.profile.avatar || null,
      linkPreview: this.profile.linkPreview !== false
    }
  }

  setProfile ({ username, bio, avatar, linkPreview }) {
    const normalized = normalizePeerChatProfileName(username)
    if (!normalized) {
      throw new Error('Name may only contain letters, numbers, and spaces (max 50 characters).')
    }

    const normalizedAvatar = avatar === undefined
      ? this.profile.avatar
      : normalizePeerChatAvatar(avatar)
    if (avatar != null && avatar !== '' && !normalizedAvatar) {
      throw new Error('Choose a supported PeerChat profile image under 192 KB.')
    }
    this.profile = {
      username: normalized,
      bio: bio === undefined ? this.profile.bio : normalizePeerChatBio(bio),
      avatar: normalizedAvatar,
      linkPreview: linkPreview === undefined ? this.profile.linkPreview !== false : linkPreview !== false
    }
    this.schedulePersist()
    this.bumpVersion()

    for (const peer of this.peers.values()) this.sendProfile(peer)
    return this.getProfile()
  }

  async createRoom ({ name, username, bio, link, avatar, moderation }) {
    this.ensureProfile(username)
    if (this.rooms.size >= MAX_ROOMS) throw new Error(`PeerChat supports up to ${MAX_ROOMS} rooms.`)

    const roomKey = createPeerChatRoomKey()
    const normalizedLink = normalizePeerChatLink(link)
    const normalizedAvatar = normalizePeerChatAvatar(avatar)
    if (typeof link === 'string' && link.trim() && !normalizedLink) {
      throw new Error('Room link must be a valid HTTP or HTTPS URL.')
    }
    if (avatar != null && avatar !== '' && !normalizedAvatar) {
      throw new Error('Choose a supported PeerChat room image under 192 KB.')
    }
    const room = {
      roomKey,
      name: normalizePeerChatRoomName(name),
      bio: normalizePeerChatBio(bio),
      link: normalizedLink,
      avatar: normalizedAvatar,
      isHost: true,
      createdAt: Date.now(),
      createdBy: this.localId,
      createdByName: this.profile.username,
      moderation: normalizePeerChatModeration(moderation),
      lastMessage: null,
      unreadCount: 0,
      unreadMentions: 0,
      lastReadTs: Date.now()
    }
    this.rooms.set(roomKey, room)
    try {
      await this.joinRoomNetwork(roomKey)
    } catch (error) {
      this.rooms.delete(roomKey)
      throw error
    }
    this.schedulePersist()
    this.bumpVersion()

    return this.publicRoom(room)
  }

  async joinRoom ({ roomKey, username }) {
    this.ensureProfile(username)
    const normalized = normalizePeerChatRoomKey(roomKey)
    if (!normalized) throw new Error('Enter a valid 64-character PeerChat room key.')

    let room = this.rooms.get(normalized)
    const isNewRoom = !room
    if (!room) {
      if (this.rooms.size >= MAX_ROOMS) throw new Error(`PeerChat supports up to ${MAX_ROOMS} rooms.`)
      room = {
        roomKey: normalized,
        name: `${normalized.slice(0, 8)}...`,
        bio: '',
        link: '',
        avatar: null,
        isHost: false,
        createdAt: Date.now(),
        joinedAt: Date.now(),
        moderation: { ...DEFAULT_PEERCHAT_MODERATION },
        lastMessage: null,
        unreadCount: 0,
        unreadMentions: 0,
        lastReadTs: Date.now()
      }
      this.rooms.set(normalized, room)
    }

    try {
      await this.joinRoomNetwork(normalized)
    } catch (error) {
      if (isNewRoom) this.rooms.delete(normalized)
      throw error
    }
    this.schedulePersist()
    this.bumpVersion()
    this.announceRoom(normalized)

    return this.publicRoom(room)
  }

  listRooms () {
    return [...this.rooms.values()]
      .map((room) => this.publicRoom(room))
      .sort((left, right) => {
        if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1
        const leftTime = left.lastMessage?.timestamp || left.createdAt
        const rightTime = right.lastMessage?.timestamp || right.createdAt
        return rightTime - leftTime
      })
  }

  listPendingDirectMessages () {
    return [...this.pendingDirectMessages.values()]
      .sort((left, right) => right.receivedAt - left.receivedAt)
      .slice(0, MAX_PENDING_DIRECT_MESSAGES)
  }

  async createDirectMessage ({ peerId, username, bio, avatar } = {}) {
    this.ensureProfile()
    const normalizedPeerId = normalizePeerChatPeerId(peerId)
    if (!normalizedPeerId || normalizedPeerId === this.localId) throw new Error('Choose another online peer.')
    const peer = [...this.peers.values()].find((candidate) => candidate.id === normalizedPeerId)
    if (!peer) throw new Error('That peer is no longer connected.')

    const roomKey = derivePeerChatDirectRoomKey(this.localId, normalizedPeerId)
    let room = this.rooms.get(roomKey)
    const createdRoom = !room
    if (!room) {
      if (this.rooms.size >= MAX_ROOMS) throw new Error(`PeerChat supports up to ${MAX_ROOMS} rooms.`)
      room = this.createDirectRoom({
        roomKey,
        peerId: normalizedPeerId,
        username: normalizePeerChatProfileName(username) || peer.username || normalizedPeerId,
        bio: normalizePeerChatBio(bio ?? peer.bio),
        avatar: normalizePeerChatAvatar(avatar ?? peer.avatar),
        pendingAcceptance: true
      })
      this.rooms.set(roomKey, room)
    } else if (!room.isDM || room.dmWith !== normalizedPeerId) {
      throw new Error('PeerChat direct-message room is invalid.')
    }
    if (room.rejected) {
      room.rejected = false
      room.pendingAcceptance = true
    }
    try {
      await this.joinRoomNetwork(roomKey)
    } catch (error) {
      if (createdRoom) this.rooms.delete(roomKey)
      throw error
    }
    if (room.pendingAcceptance) this.sendDirectMessageControl(peer, 'dm-invite', room)
    this.schedulePersist()
    this.bumpVersion()
    return { room: this.publicRoom(room), rooms: this.listRooms(), version: this.version }
  }

  async acceptDirectMessage ({ roomKey } = {}) {
    const normalized = normalizePeerChatRoomKey(roomKey)
    const pending = this.pendingDirectMessages.get(normalized)
    if (!pending) throw new Error('PeerChat direct-message request not found.')
    if (this.rooms.size >= MAX_ROOMS) throw new Error(`PeerChat supports up to ${MAX_ROOMS} rooms.`)

    const room = this.createDirectRoom({
      roomKey: normalized,
      peerId: pending.fromId,
      username: pending.fromUsername,
      bio: pending.fromBio,
      avatar: pending.fromAvatar,
      createdAt: pending.receivedAt,
      pendingAcceptance: false
    })
    this.rooms.set(normalized, room)
    this.pendingDirectMessages.delete(normalized)
    try {
      await this.joinRoomNetwork(normalized)
    } catch (error) {
      this.rooms.delete(normalized)
      this.pendingDirectMessages.set(normalized, pending)
      throw error
    }
    const peer = [...this.peers.values()].find((candidate) => candidate.id === pending.fromId)
    if (peer) this.sendDirectMessageControl(peer, 'dm-accept', room)
    this.persistNow()
    this.bumpVersion()
    return { room: this.publicRoom(room), rooms: this.listRooms(), version: this.version }
  }

  rejectDirectMessage ({ roomKey } = {}) {
    const normalized = normalizePeerChatRoomKey(roomKey)
    const pending = this.pendingDirectMessages.get(normalized)
    if (!pending) throw new Error('PeerChat direct-message request not found.')
    this.pendingDirectMessages.delete(normalized)
    const peer = [...this.peers.values()].find((candidate) => candidate.id === pending.fromId)
    if (peer) this.sendDirectMessageControl(peer, 'dm-reject', { roomKey: normalized, dmWith: pending.fromId })
    this.persistNow()
    this.bumpVersion()
    return { pendingDirectMessages: this.listPendingDirectMessages(), version: this.version }
  }

  setRoomPinned ({ roomKey, pinned } = {}) {
    const normalized = normalizePeerChatRoomKey(roomKey)
    const room = this.rooms.get(normalized)
    if (!room) throw new Error('PeerChat room not found.')
    if (typeof pinned !== 'boolean') throw new Error('Invalid PeerChat pin state.')

    room.isPinned = pinned
    this.schedulePersist()
    this.bumpVersion()
    return { room: this.publicRoom(room), rooms: this.listRooms(), version: this.version }
  }

  setRoomMuted ({ roomKey, muted } = {}) {
    const normalized = normalizePeerChatRoomKey(roomKey)
    const room = this.rooms.get(normalized)
    if (!room) throw new Error('PeerChat room not found.')
    if (typeof muted !== 'boolean') throw new Error('Invalid PeerChat mute state.')

    room.isMuted = muted
    this.schedulePersist()
    this.bumpVersion()
    return { room: this.publicRoom(room), rooms: this.listRooms(), version: this.version }
  }

  updateRoom ({ roomKey, name, bio, link, avatar } = {}) {
    const normalized = normalizePeerChatRoomKey(roomKey)
    const room = this.rooms.get(normalized)
    if (!room) throw new Error('PeerChat room not found.')
    if (!room.isHost) throw new Error('Only the room host can edit room details.')

    const normalizedAvatar = avatar === undefined ? room.avatar || null : normalizePeerChatAvatar(avatar)
    if (avatar != null && avatar !== '' && !normalizedAvatar) {
      throw new Error('Choose a supported PeerChat room image under 192 KB.')
    }
    room.name = name === undefined ? room.name : normalizePeerChatRoomName(name)
    room.bio = bio === undefined ? room.bio || '' : normalizePeerChatBio(bio)
    if (link !== undefined) {
      room.link = normalizePeerChatLink(link)
      if (typeof link === 'string' && link.trim() && !room.link) {
        throw new Error('Room link must be a valid HTTP or HTTPS URL.')
      }
    }
    room.avatar = normalizedAvatar
    this.schedulePersist()
    this.bumpVersion()
    this.announceRoom(normalized)
    return { room: this.publicRoom(room), rooms: this.listRooms(), version: this.version }
  }

  setActiveRoom ({ roomKey } = {}) {
    const normalized = roomKey == null || roomKey === '' ? null : normalizePeerChatRoomKey(roomKey)
    if (roomKey != null && roomKey !== '' && !normalized) throw new Error('Invalid PeerChat room key.')
    if (normalized && !this.rooms.has(normalized)) throw new Error('PeerChat room not found.')

    this.activeRoomKey = normalized
    if (normalized) {
      const room = this.rooms.get(normalized)
      room.unreadCount = 0
      room.unreadMentions = 0
      room.lastReadTs = Date.now()
      this.schedulePersist()
    }
    this.bumpVersion()
    return { rooms: this.listRooms(), version: this.version }
  }

  async getSnapshot ({ roomKey, version }) {
    const normalized = normalizePeerChatRoomKey(roomKey)
    const room = this.rooms.get(normalized)
    if (!room) throw new Error('PeerChat room not found.')
    if (!this.feeds.has(normalized)) await this.joinRoomNetwork(normalized)

    const unchanged = Number.isSafeInteger(version) && version === this.version
    return {
      version: this.version,
      profile: this.getProfile(),
      room: this.publicRoom(room),
      rooms: this.listRooms(),
      messages: unchanged ? null : await this.readMessages(normalized)
    }
  }

  async sendMessage ({ roomKey, message, replyTo, fileName, fileSize, preview }) {
    const normalizedRoomKey = normalizePeerChatRoomKey(roomKey)
    const room = this.rooms.get(normalizedRoomKey)
    if (!room) throw new Error('PeerChat room not found.')
    if (room.isDM && room.pendingAcceptance) throw new Error('Wait for the peer to accept this message request.')
    if (room.isDM && room.rejected) throw new Error('This peer declined the message request.')
    if (!this.profile.username) throw new Error('Set a PeerChat name before sending messages.')
    if (!this.feeds.has(normalizedRoomKey)) await this.joinRoomNetwork(normalizedRoomKey)

    const normalizedMessage = normalizePeerChatMessage(message)
    if (!normalizedMessage) {
      if (typeof message === 'string' && getPeerChatMessageByteLength(message.trim()) > MAX_PEERCHAT_MESSAGE_BYTES) {
        throw new Error(`PeerChat messages must be at most ${MAX_PEERCHAT_MESSAGE_BYTES} UTF-8 bytes.`)
      }
      throw new Error('Enter a message to send.')
    }

    const moderation = this.moderator.checkMessage(
      this.localId,
      normalizedRoomKey,
      normalizedMessage,
      {
        allowKick: false,
        checkSpam: false,
        settings: room.moderation
      }
    )
    if (!moderation.allowed) {
      throw new Error(`Message blocked: ${moderation.reason}. Please rephrase it.`)
    }

    let normalizedPreview = this.sanitizeModeratedPreview(preview, room.moderation)
    if (!normalizedPreview && this.profile.linkPreview !== false) {
      const previewUrl = extractFirstHttpUrl(normalizedMessage)
      if (previewUrl && !checkPeerChatContent(previewUrl, room.moderation).flagged) {
        const resolved = await resolveLinkPreview(previewUrl)
        normalizedPreview = this.sanitizeModeratedPreview(resolved, room.moderation)
      }
    }
    const encodedPayload = encodeMessagePayload(normalizedMessage, normalizedPreview)
    const plaintext = getPeerChatMessageByteLength(encodedPayload) <= MAX_PEERCHAT_MESSAGE_BYTES
      ? encodedPayload
      : normalizedMessage
    const encrypted = encryptPeerChatMessage(plaintext, normalizedRoomKey)
    const normalizedReply = normalizePeerChatReply(replyTo)
    const attachment = normalizePeerChatAttachment({
      message: normalizedMessage,
      fileName,
      fileSize
    })
    const entry = {
      id: createPeerChatMessageId(),
      sender: this.localId,
      sn: this.profile.username,
      ...encrypted,
      ...(normalizedReply && { replyTo: normalizedReply }),
      ...(attachment || {}),
      ts: Date.now()
    }

    this.trackMessageId(entry.id)
    await this.appendEntry(normalizedRoomKey, entry)
    this.relayToRoom(normalizedRoomKey, entry)

    return this.entryToMessage(entry, normalizedRoomKey)
  }

  async reactToMessage ({ roomKey, msgId, emoji }) {
    const normalizedRoomKey = normalizePeerChatRoomKey(roomKey)
    if (!this.rooms.has(normalizedRoomKey)) throw new Error('PeerChat room not found.')
    if (!this.profile.username) throw new Error('Set a PeerChat name before reacting.')
    if (!this.feeds.has(normalizedRoomKey)) await this.joinRoomNetwork(normalizedRoomKey)

    const entry = normalizePeerChatReaction({
      type: 'reaction',
      id: createPeerChatMessageId(),
      msgId,
      emoji,
      sender: this.localId,
      sn: this.profile.username,
      ts: Date.now()
    })
    if (!entry) throw new Error('Invalid PeerChat reaction.')

    this.trackMessageId(entry.id)
    await this.appendEntry(normalizedRoomKey, entry)
    this.relayToRoom(normalizedRoomKey, entry)
    return entry
  }

  async leaveRoom ({ roomKey }) {
    const normalized = normalizePeerChatRoomKey(roomKey)
    if (!this.rooms.has(normalized)) throw new Error('PeerChat room not found.')

    this.relayToRoom(normalized, {
      type: 'leave',
      roomKey: normalized,
      peerId: this.localId,
      username: this.profile.username || this.localId,
      id: `${normalized}-${this.localId}-left-${Date.now()}`,
      ts: Date.now()
    })

    const pendingJoin = this.pendingJoins.get(normalized)
    if (pendingJoin) await pendingJoin.catch(() => {})

    try {
      await this.sdk.leave(derivePeerChatTopic(normalized))
    } catch {}

    this.rooms.delete(normalized)
    this.moderator.clearRoom(normalized)
    if (this.activeRoomKey === normalized) this.activeRoomKey = null
    await this.releaseFeed(normalized)
    this.joinedRooms.delete(normalized)
    this.discoveryKeys.delete(peerChatTopicHex(derivePeerChatTopic(normalized)))
    this.persistNow()
    this.bumpVersion()
    return { ok: true }
  }

  async close () {
    if (this.closed) return
    this.closed = true
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = null

    this.sdk.swarm.off?.('connection', this.onConnection)
    this.sdk.localSwarm?.off?.('topics-change', this.onTopicsChange)
    const peers = new Set([...this.peers.values(), ...this.pendingPeers.values()])
    for (const peer of peers) {
      if (peer.pingTimer) clearInterval(peer.pingTimer)
      peer.transport?.close?.()
    }
    this.peers.clear()
    this.pendingPeers.clear()

    const pendingJoins = [...this.pendingJoins.values()]
    if (pendingJoins.length > 0) await Promise.allSettled(pendingJoins)
    this.pendingJoins.clear()

    for (const roomKey of [...this.feeds.keys()]) await this.releaseFeed(roomKey)
    for (const roomKey of this.joinedRooms) {
      try {
        await this.sdk.leave(derivePeerChatTopic(roomKey))
      } catch {}
    }
    this.joinedRooms.clear()
    this.discoveryKeys.clear()
    this.moderator.clear()
    this.persistNow()
  }

  ensureProfile (username) {
    if (username !== undefined) this.setProfile({ username })
    if (!this.profile.username) throw new Error('Set a PeerChat name first.')
  }

  async joinRoomNetwork (roomKey) {
    if (this.closed) throw new Error('PeerChat service is closed.')
    const pending = this.pendingJoins.get(roomKey)
    if (pending) return pending

    const join = this.openRoomNetwork(roomKey).finally(() => {
      if (this.pendingJoins.get(roomKey) === join) this.pendingJoins.delete(roomKey)
    })
    this.pendingJoins.set(roomKey, join)
    return join
  }

  async openRoomNetwork (roomKey) {
    if (!this.joinedRooms.has(roomKey)) {
      const topic = derivePeerChatTopic(roomKey)
      const discoveryKey = peerChatTopicHex(topic)
      this.discoveryKeys.set(discoveryKey, roomKey)

      try {
        this.sdk.join(topic, { client: true, server: true })
        this.joinedRooms.add(roomKey)
        for (const peer of this.peers.values()) this.shareTopics(peer)
        await this.sdk.swarm.flush()
      } catch (error) {
        this.discoveryKeys.delete(discoveryKey)
        this.joinedRooms.delete(roomKey)
        throw error
      }
    }

    if (this.closed) throw new Error('PeerChat service is closed.')
    if (this.feeds.has(roomKey)) return

    const feed = this.sdk.corestore.get({
      name: `chat-${roomKey}`,
      valueEncoding: 'json'
    })
    await feed.ready()
    if (this.closed) {
      if (feed.close) await feed.close().catch(() => {})
      throw new Error('PeerChat service is closed.')
    }
    this.feeds.set(roomKey, feed)
    this.registerFeedStorage(roomKey, feed)

    const firstIndex = Math.max(0, feed.length - MAX_SYNC_MESSAGES)
    for (let index = firstIndex; index < feed.length; index += 1) {
      try {
        const entry = await feed.get(index)
        if (entry?.id) this.trackMessageId(entry.id)
      } catch {}
    }

    const onAppend = () => {
      this.updateLastMessage(roomKey).catch(() => {})
      this.bumpVersion()
    }
    this.feedListeners.set(roomKey, onAppend)
    feed.on('append', onAppend)
  }

  handleConnection (connection, info = {}) {
    const sharedRooms = getSharedPeerChatRooms(info.topics, this.discoveryKeys)
    const hasTopics = Array.isArray(info.topics)
      ? info.topics.length > 0
      : !!info.topics?.length
    // Inbound/server connections can omit info.topics. The Protomux protocol
    // and the derived-topic handshake identify mutual PeerChat rooms safely.
    if (this.closed || (sharedRooms.length === 0 && (hasTopics || this.discoveryKeys.size === 0))) return

    const peer = {
      connection,
      id: connection.remotePublicKey
        ? b4a.toString(connection.remotePublicKey, 'hex').slice(0, 8).toLowerCase()
        : 'peer',
      rooms: sharedRooms,
      handshake: false,
      buffer: '',
      active: false,
      initialSyncCount: 0,
      liveRate: { count: 0, resetsAt: Date.now() + LIVE_RATE_WINDOW_MS },
      controlRate: { count: 0, resetsAt: Date.now() + LIVE_RATE_WINDOW_MS },
      pendingMessages: 0,
      processing: Promise.resolve(),
      pingTimer: null,
      lastReceivedAt: Date.now(),
      syncedRooms: new Set(),
      syncingRooms: new Map(),
      transport: null
    }
    this.pendingPeers.set(connection, peer)

    const transport = attachPeerChatTransport(
      connection,
      (payload) => this.handlePeerPayload(peer, payload),
      {
        onOpen: () => setImmediate(() => {
          if (peer.transport !== transport) return
          transport.ready()
            .then((opened) => {
              if (opened) this.activatePeer(peer)
            })
            .catch(() => {})
        }),
        onClose: () => this.deactivatePeer(peer)
      }
    )
    if (!transport) {
      this.pendingPeers.delete(connection)
      return
    }
    peer.transport = transport

    connection.on('error', () => {})
    connection.on('close', () => this.deactivatePeer(peer))
  }

  handleTopicsChange (connection, info = {}) {
    const peer = this.peers.get(connection) || this.pendingPeers.get(connection)
    if (!peer) return

    const previousRooms = new Set(peer.rooms)
    peer.rooms = getSharedPeerChatRooms(info.topics, this.discoveryKeys)
    if (this.pendingPeers.has(connection)) return
    for (const roomKey of peer.rooms) {
      if (!previousRooms.has(roomKey)) this.shareRoom(peer, roomKey)
    }
    this.bumpVersion()
  }

  activatePeer (peer) {
    if (peer.active || peer.connection.destroyed || this.closed) return
    peer.active = true
    this.pendingPeers.delete(peer.connection)
    this.peers.set(peer.connection, peer)
    this.bumpVersion()

    this.shareTopics(peer)
    this.sendProfile(peer)
    for (const roomKey of peer.rooms) this.shareRoom(peer, roomKey)
    for (const room of this.rooms.values()) {
      if (room.isDM && room.pendingAcceptance && room.dmWith === peer.id) {
        this.sendDirectMessageControl(peer, 'dm-invite', room)
      }
    }

    peer.pingTimer = setInterval(() => {
      if (!this.checkPeerLiveness(peer)) return
      this.shareTopics(peer)
    }, PING_INTERVAL_MS)
  }

  checkPeerLiveness (peer, now = Date.now()) {
    if (
      peer.connection.destroyed ||
      now - peer.lastReceivedAt >= PEER_LIVENESS_TIMEOUT_MS ||
      !this.sendToPeer(peer, { type: 'ping' })
    ) {
      this.disconnectPeer(peer)
      return false
    }
    return true
  }

  disconnectPeer (peer) {
    this.deactivatePeer(peer)
    try {
      peer.transport?.close?.()
    } catch {}
    try {
      peer.connection.destroy?.()
    } catch {}
  }

  deactivatePeer (peer) {
    this.pendingPeers.delete(peer.connection)
    if (!peer.active) return
    peer.active = false
    if (peer.pingTimer) clearInterval(peer.pingTimer)
    peer.pingTimer = null
    this.peers.delete(peer.connection)
    this.bumpVersion()
  }

  handlePeerPayload (peer, payload) {
    peer.lastReceivedAt = Date.now()
    const chunk = String(payload)
    if (peer.buffer.length + chunk.length > MAX_FRAME_LENGTH) {
      peer.buffer = ''
      return
    }

    peer.buffer += chunk
    const lines = peer.buffer.split('\n')
    peer.buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line || line.length > MAX_FRAME_LENGTH) continue
      try {
        const message = JSON.parse(line)
        if (peer.pendingMessages >= MAX_PENDING_MESSAGES_PER_CONNECTION) continue
        peer.pendingMessages += 1
        peer.processing = peer.processing
          .then(() => this.handlePeerMessage(peer, message))
          .catch(() => {})
          .finally(() => {
            peer.pendingMessages -= 1
          })
      } catch {}
    }
  }

  async handlePeerMessage (peer, message) {
    if (!message || typeof message !== 'object') return
    if (message.type === 'ping') {
      if (!this.consumeControlRate(peer)) return
      this.sendToPeer(peer, { type: 'pong' })
      return
    }
    if (message.type === 'pong' || message.type === 'sync-done') return

    if (message.type === 'topics') {
      if (!this.consumeControlRate(peer) || !Array.isArray(message.topics)) return
      peer.handshake = true
      const sharedRooms = getSharedPeerChatRooms(
        message.topics.slice(0, MAX_ANNOUNCED_TOPICS),
        this.discoveryKeys
      )
      const previousRooms = new Set(peer.rooms)
      for (const roomKey of sharedRooms) {
        if (previousRooms.has(roomKey)) continue
        peer.rooms.push(roomKey)
        this.shareRoom(peer, roomKey)
      }
      if (peer.rooms.length !== previousRooms.size) this.bumpVersion()
      return
    }

    if (message.type === 'profile') {
      if (!this.consumeControlRate(peer)) return
      const name = normalizePeerChatProfileName(message.username)
      if (name && name !== peer.username) {
        peer.username = name
        this.bumpVersion()
      }
      const bio = normalizePeerChatBio(message.bio)
      const avatar = normalizePeerChatAvatar(message.avatar)
      if (bio !== peer.bio || avatar !== peer.avatar) {
        peer.bio = bio
        peer.avatar = avatar
        this.bumpVersion()
      }
      return
    }

    if (message.type === 'dm-invite') {
      if (!this.consumeControlRate(peer)) return
      this.receiveDirectMessageInvite(peer, message)
      return
    }

    if (message.type === 'dm-accept' || message.type === 'dm-reject') {
      if (!this.consumeControlRate(peer)) return
      const directRoomKey = normalizePeerChatRoomKey(message.roomKey)
      const expectedRoomKey = derivePeerChatDirectRoomKey(this.localId, peer.id)
      const directRoom = this.rooms.get(directRoomKey)
      if (directRoomKey !== expectedRoomKey || !directRoom?.isDM || directRoom.dmWith !== peer.id) return
      if (message.type === 'dm-accept') {
        directRoom.pendingAcceptance = false
        directRoom.name = normalizePeerChatProfileName(message.fromUsername) || directRoom.name
        directRoom.bio = normalizePeerChatBio(message.fromBio)
        directRoom.avatar = normalizePeerChatAvatar(message.fromAvatar)
      } else {
        directRoom.pendingAcceptance = false
        directRoom.rejected = true
      }
      this.schedulePersist()
      this.bumpVersion()
      return
    }

    const roomKey = normalizePeerChatRoomKey(message.roomKey)
    if (!roomKey || !peer.rooms.includes(roomKey) || !this.rooms.has(roomKey)) return
    if (this.moderator.isKicked(peer.id, roomKey)) return

    if (message.type === 'request-room-meta') {
      if (!this.consumeControlRate(peer)) return
      this.sendRoomMeta(peer, roomKey)
      return
    }

    if (message.type === 'room-meta') {
      if (!this.consumeControlRate(peer)) return
      const room = this.rooms.get(roomKey)
      if (!room?.isHost) {
        const placeholder = `${roomKey.slice(0, 8)}...`
        const incomingName = normalizePeerChatRoomName(message.name, '')
        let changed = false
        if (room.name === placeholder && incomingName && incomingName !== placeholder) {
          room.name = incomingName
          changed = true
        }
        if (!room.bio) {
          const bio = normalizePeerChatBio(message.bio)
          if (bio) {
            room.bio = bio
            changed = true
          }
        }
        if (!room.link) {
          const link = normalizePeerChatLink(message.link)
          if (link) {
            room.link = link
            changed = true
          }
        }
        if (!room.avatar) {
          const avatar = normalizePeerChatAvatar(message.avatar)
          if (avatar) {
            room.avatar = avatar
            changed = true
          }
        }
        if (!room.createdBy && typeof message.createdBy === 'string') {
          room.createdBy = message.createdBy.slice(0, 200)
          changed = true
        }
        if (!room.createdByName) {
          const creatorName = normalizePeerChatProfileName(message.createdByName)
          if (creatorName) {
            room.createdByName = creatorName
            changed = true
          }
        }
        if (message.moderation) {
          const moderation = normalizePeerChatModeration(message.moderation)
          if (JSON.stringify(moderation) !== JSON.stringify(room.moderation)) {
            room.moderation = moderation
            changed = true
          }
        }
        if (changed) {
          this.schedulePersist()
          this.bumpVersion()
        }
      }
      return
    }

    if (message.type === 'join') {
      if (!this.consumeControlRate(peer)) return
      if (message.username) peer.username = normalizePeerChatProfileName(message.username) || peer.username
      this.sendRoomMeta(peer, roomKey)
      await this.syncHistoryToPeerOnce(peer, roomKey)
      this.bumpVersion()
      return
    }

    if (message.type === 'leave' || message.type === 'sync-system') return

    const isReaction = message.type === 'reaction' || message.type === 'sync-reaction'
    if (isReaction) {
      const isSyncReaction = message.type === 'sync-reaction'
      if (isSyncReaction) {
        if (peer.initialSyncCount >= MAX_INITIAL_SYNC_MESSAGES_PER_CONNECTION) return
        peer.initialSyncCount += 1
      } else if (!this.consumeLiveRate(peer)) {
        return
      }

      const room = this.rooms.get(roomKey)
      if (
        isSyncReaction &&
        !room.isHost &&
        room.joinedAt &&
        Number.isFinite(message.ts) &&
        message.ts < room.joinedAt
      ) {
        return
      }

      const entry = normalizePeerChatReaction({
        ...message,
        sender: isSyncReaction ? message.sender : peer.id,
        sn: message.sn || peer.username || peer.id
      })
      if (!entry || !this.trackMessageId(entry.id)) return
      await this.appendEntry(roomKey, entry)
      return
    }

    const isSync = message.type === 'sync'
    if (isSync) {
      if (peer.initialSyncCount >= MAX_INITIAL_SYNC_MESSAGES_PER_CONNECTION) return
      peer.initialSyncCount += 1
    } else if (!this.consumeLiveRate(peer)) {
      return
    }

    const room = this.rooms.get(roomKey)
    if (
      isSync &&
      !room.isHost &&
      room.joinedAt &&
      Number.isFinite(message.ts) &&
      message.ts < room.joinedAt
    ) {
      return
    }

    if (typeof message.id !== 'string' || message.id.length > 128 || !this.trackMessageId(message.id)) return

    let plaintext
    try {
      plaintext = decryptPeerChatMessage(message, roomKey)
    } catch {
      return
    }
    if (!plaintext) return

    const decodedPayload = decodeMessagePayload(plaintext)
    const normalizedMessage = normalizePeerChatMessage(decodedPayload.text)
    if (!normalizedMessage) return
    const moderation = isSync
      ? checkPeerChatContent(normalizedMessage, room.moderation)
      : this.moderator.checkMessage(peer.id, roomKey, normalizedMessage, {
        settings: room.moderation
      })
    if (moderation.flagged || moderation.allowed === false) {
      await this.appendModerationNotice(roomKey, message.id, peer, {
        action: moderation.action || 'warn',
        reason: moderation.reason
      }, message.ts)
      return
    }

    const safePreview = this.sanitizeModeratedPreview(decodedPayload.preview, room.moderation)
    const safePlaintext = encodeMessagePayload(normalizedMessage, safePreview)
    const safeEncrypted = safePlaintext === plaintext
      ? { ct: message.ct, iv: message.iv, tag: message.tag }
      : encryptPeerChatMessage(safePlaintext, roomKey)

    const normalizedReply = normalizePeerChatReply(message.replyTo)
    const attachment = normalizePeerChatAttachment({
      message: normalizedMessage,
      fileName: message.fileName,
      fileSize: message.fileSize
    })
    const entry = {
      id: message.id,
      sender: isSync && typeof message.sender === 'string'
        ? message.sender.slice(0, 200)
        : peer.id,
      sn: normalizePeerChatProfileName(message.sn) || peer.username || peer.id,
      ...safeEncrypted,
      ...(normalizedReply && { replyTo: normalizedReply }),
      ...(attachment || {}),
      ts: normalizePeerChatTimestamp(message.ts)
    }
    await this.appendEntry(roomKey, entry)
  }

  consumeLiveRate (peer) {
    const now = Date.now()
    if (now >= peer.liveRate.resetsAt) {
      peer.liveRate = { count: 1, resetsAt: now + LIVE_RATE_WINDOW_MS }
      return true
    }
    if (peer.liveRate.count >= MAX_LIVE_MESSAGES_PER_WINDOW) return false
    peer.liveRate.count += 1
    return true
  }

  consumeControlRate (peer) {
    const now = Date.now()
    if (now >= peer.controlRate.resetsAt) {
      peer.controlRate = { count: 1, resetsAt: now + LIVE_RATE_WINDOW_MS }
      return true
    }
    if (peer.controlRate.count >= MAX_CONTROL_MESSAGES_PER_WINDOW) return false
    peer.controlRate.count += 1
    return true
  }

  shareRoom (peer, roomKey) {
    this.sendRoomMeta(peer, roomKey)
    this.sendToPeer(peer, {
      type: 'join',
      roomKey,
      peerId: this.localId,
      username: this.profile.username || this.localId,
      bio: this.profile.bio || '',
      avatar: this.profile.avatar || null,
      id: `${roomKey}-${this.localId}-join-${Date.now()}`,
      ts: Date.now()
    })
    this.syncHistoryToPeerOnce(peer, roomKey).catch(() => {})
  }

  announceRoom (roomKey) {
    for (const peer of this.peers.values()) {
      this.shareTopics(peer)
      if (peer.rooms.includes(roomKey)) this.shareRoom(peer, roomKey)
    }
  }

  shareTopics (peer) {
    this.sendToPeer(peer, {
      type: 'topics',
      topics: [...this.discoveryKeys.keys()].slice(0, MAX_ANNOUNCED_TOPICS)
    })
  }

  sendProfile (peer) {
    if (!this.profile.username) return
    this.sendToPeer(peer, {
      type: 'profile',
      peerId: this.localId,
      username: this.profile.username,
      bio: this.profile.bio || '',
      avatar: this.profile.avatar || null,
      rooms: peer.rooms
    })
  }

  sendRoomMeta (peer, roomKey) {
    const room = this.rooms.get(roomKey)
    if (!room || (!room.isHost && room.name === `${roomKey.slice(0, 8)}...`)) return
    this.sendToPeer(peer, {
      type: 'room-meta',
      roomKey,
      name: room.name,
      bio: room.bio || '',
      link: room.link || '',
      avatar: room.avatar || null,
      createdBy: room.createdBy || (room.isHost ? this.localId : ''),
      createdByName: room.createdByName || (room.isHost ? this.profile.username : ''),
      moderation: normalizePeerChatModeration(room.moderation)
    })
  }

  sanitizeModeratedPreview (preview, settings) {
    const normalized = sanitizePreview(preview)
    if (!normalized) return null
    const text = [normalized.url, normalized.title, normalized.description].filter(Boolean).join(' ')
    return checkPeerChatContent(text, settings).flagged ? null : normalized
  }

  async appendModerationNotice (roomKey, sourceId, peer, moderation, timestamp) {
    const peerName = normalizePeerChatProfileName(peer?.username) || normalizePeerChatPeerId(peer?.id) || 'Peer'
    const action = moderation.action || 'warn'
    const text = action === 'kick'
      ? `${peerName} was temporarily removed (${moderation.reason})`
      : action === 'final-warn'
        ? `Final warning for ${peerName} (${moderation.reason})`
        : `${peerName}: message filtered (${moderation.reason})`
    await this.appendEntry(roomKey, {
      id: `mod-${String(sourceId || Date.now()).slice(0, 128)}-${Date.now()}`,
      type: 'system',
      moderationNotice: true,
      message: text,
      ts: normalizePeerChatTimestamp(timestamp)
    })
  }

  receiveDirectMessageInvite (peer, message) {
    const roomKey = normalizePeerChatRoomKey(message.roomKey)
    const toId = normalizePeerChatPeerId(message.toId)
    let expectedRoomKey
    try {
      expectedRoomKey = derivePeerChatDirectRoomKey(this.localId, peer.id)
    } catch {
      return
    }
    if (!roomKey || roomKey !== expectedRoomKey || (toId && toId !== this.localId)) return

    const existing = this.rooms.get(roomKey)
    if (existing?.isDM && existing.dmWith === peer.id) {
      this.sendDirectMessageControl(peer, 'dm-accept', existing)
      return
    }
    if (this.pendingDirectMessages.has(roomKey) || this.pendingDirectMessages.size >= MAX_PENDING_DIRECT_MESSAGES) return

    this.pendingDirectMessages.set(roomKey, {
      roomKey,
      fromId: peer.id,
      fromUsername: normalizePeerChatProfileName(message.fromUsername) || peer.username || peer.id,
      fromBio: normalizePeerChatBio(message.fromBio),
      fromAvatar: normalizePeerChatAvatar(message.fromAvatar),
      receivedAt: Date.now()
    })
    this.persistNow()
    this.bumpVersion()
  }

  createDirectRoom ({ roomKey, peerId, username, bio, avatar, createdAt = Date.now(), pendingAcceptance }) {
    return {
      roomKey,
      name: username,
      bio: bio || '',
      link: '',
      avatar: avatar || null,
      isHost: false,
      isDM: true,
      dmWith: peerId,
      pendingAcceptance: pendingAcceptance === true,
      rejected: false,
      createdAt,
      joinedAt: createdAt,
      createdBy: this.localId,
      createdByName: this.profile.username,
      lastMessage: null,
      unreadCount: 0,
      unreadMentions: 0,
      lastReadTs: Date.now()
    }
  }

  sendDirectMessageControl (peer, type, room) {
    return this.sendToPeer(peer, {
      type,
      roomKey: room.roomKey,
      fromId: this.localId,
      fromUsername: this.profile.username || this.localId,
      fromAvatar: this.profile.avatar || null,
      fromBio: this.profile.bio || '',
      ...(type === 'dm-invite' && { toId: room.dmWith })
    })
  }

  async syncHistoryToPeer (peer, roomKey) {
    const feed = this.feeds.get(roomKey)
    if (!feed || peer.connection.destroyed) return false

    const firstIndex = Math.max(0, feed.length - MAX_SYNC_MESSAGES)
    for (let index = firstIndex; index < feed.length; index += 1) {
      if (peer.connection.destroyed || !peer.rooms.includes(roomKey)) return false
      try {
        const entry = await feed.get(index)
        if (!entry?.ct && entry?.type !== 'reaction') continue
        const type = entry.type === 'reaction' ? 'sync-reaction' : 'sync'
        const sent = this.sendToPeer(peer, { ...entry, type, roomKey })
        if (!sent && !await waitForConnectionDrain(peer.connection)) return false
      } catch {
        return false
      }
    }
    const sent = this.sendToPeer(peer, { type: 'sync-done' })
    if (!sent && !await waitForConnectionDrain(peer.connection)) return false
    return !peer.connection.destroyed
  }

  async syncHistoryToPeerOnce (peer, roomKey) {
    peer.syncedRooms ||= new Set()
    peer.syncingRooms ||= new Map()
    if (peer.syncedRooms.has(roomKey)) return
    const pending = peer.syncingRooms.get(roomKey)
    if (pending) return pending

    const sync = this.syncHistoryToPeer(peer, roomKey)
      .then((completed) => {
        if (completed) peer.syncedRooms.add(roomKey)
        return completed
      })
      .finally(() => {
        peer.syncingRooms.delete(roomKey)
        this.bumpVersion()
      })
    peer.syncingRooms.set(roomKey, sync)
    return sync
  }

  relayToRoom (roomKey, message) {
    for (const peer of this.peers.values()) {
      if (peer.rooms.includes(roomKey) && !this.sendToPeer(peer, { ...message, roomKey })) {
        this.disconnectPeer(peer)
      }
    }
  }

  sendToPeer (peer, message) {
    try {
      if (!peer.transport) return false
      return peer.transport.send(`${JSON.stringify(message)}\n`)
    } catch {
      return false
    }
  }

  async appendEntry (roomKey, entry) {
    const feed = this.feeds.get(roomKey)
    if (!feed) throw new Error('PeerChat room is not ready.')
    const entryBytes = getPeerChatMessageByteLength(JSON.stringify(entry))
    const roomBytes = this.roomStorageBytes.get(roomKey) || 0
    const projectedRoomBytes = roomBytes + entryBytes + 1
    if (
      feed.length >= MAX_PEERCHAT_STORED_MESSAGES_PER_ROOM ||
      projectedRoomBytes > MAX_PEERCHAT_ROOM_STORAGE_BYTES ||
      this.totalStoredBytes + entryBytes + 1 > MAX_PEERCHAT_TOTAL_STORAGE_BYTES
    ) {
      throw new Error('PeerChat storage limit reached. Leave unused rooms or clear P2P data.')
    }
    await feed.append(entry)
    const measuredRoomBytes = Number.isSafeInteger(feed.byteLength) && feed.byteLength >= roomBytes
      ? feed.byteLength
      : projectedRoomBytes
    this.roomStorageBytes.set(roomKey, measuredRoomBytes)
    this.totalStoredBytes += measuredRoomBytes - roomBytes
    await this.updateLastMessage(roomKey, entry)
    this.updateUnreadState(roomKey, entry)
    this.bumpVersion()
  }

  updateUnreadState (roomKey, entry) {
    const room = this.rooms.get(roomKey)
    if (!room || this.activeRoomKey === roomKey) return

    const sender = String(entry?.sender || '').toLowerCase()
    if (!sender || sender === this.localId) return
    const timestamp = normalizePeerChatTimestamp(entry?.ts)
    if (timestamp <= (room.lastReadTs || 0)) return

    if (entry?.type === 'reaction') {
      if (!entry.emoji) return
      room.unreadCount = Math.min(MAX_PEERCHAT_STORED_MESSAGES_PER_ROOM, (room.unreadCount || 0) + 1)
      this.schedulePersist()
      return
    }
    if (!entry?.ct) return

    const message = this.entryToMessage(entry, roomKey).message
    room.unreadCount = Math.min(MAX_PEERCHAT_STORED_MESSAGES_PER_ROOM, (room.unreadCount || 0) + 1)
    const username = this.profile.username
    if (username && message.toLocaleLowerCase().includes(`@${username.toLocaleLowerCase()}`)) {
      room.unreadMentions = Math.min(room.unreadCount, (room.unreadMentions || 0) + 1)
    }
    this.schedulePersist()
  }

  async updateLastMessage (roomKey, suppliedEntry = null) {
    const room = this.rooms.get(roomKey)
    const feed = this.feeds.get(roomKey)
    if (!room || !feed || feed.length === 0) return

    try {
      const entry = suppliedEntry || await feed.get(feed.length - 1)
      if (entry?.type === 'reaction' && entry.emoji) {
        const sender = String(entry.sender || '').slice(0, 200)
        room.lastMessage = {
          sender,
          senderName: sender.toLowerCase() === this.localId
            ? 'You'
            : normalizePeerChatProfileName(entry.sn) || normalizePeerChatRoomName(sender, 'Peer'),
          message: `reacted ${entry.emoji}`,
          timestamp: normalizePeerChatTimestamp(entry.ts)
        }
        this.schedulePersist()
        return
      }
      if (!entry?.ct) return
      const message = this.entryToMessage(entry, roomKey)
      room.lastMessage = {
        sender: message.sender,
        senderName: message.senderName,
        message: message.message.slice(0, 120),
        timestamp: message.timestamp
      }
      this.schedulePersist()
    } catch {}
  }

  async readMessages (roomKey) {
    const feed = this.feeds.get(roomKey)
    if (!feed) return []

    const messages = []
    const reactions = new Map()
    const firstIndex = Math.max(0, feed.length - MAX_RETURNED_ENTRIES)
    for (let index = firstIndex; index < feed.length; index += 1) {
      try {
        const entry = await feed.get(index)
        if (entry?.type === 'reaction') {
          this.collectReaction(reactions, entry)
          continue
        }
        if (entry?.type === 'system' && entry?.moderationNotice === true) {
          messages.push(this.entryToSystemMessage(entry))
          continue
        }
        if (!entry?.ct) continue
        messages.push(this.entryToMessage(entry, roomKey))
      } catch {}
    }
    return messages
      .slice(-MAX_RETURNED_MESSAGES)
      .map((message) => ({
        ...message,
        reactions: this.summarizeReactions(reactions.get(message.id))
      }))
      .sort((left, right) => left.timestamp - right.timestamp)
  }

  collectReaction (reactions, suppliedEntry) {
    const entry = normalizePeerChatReaction(suppliedEntry)
    if (!entry) return

    let bySender = reactions.get(entry.msgId)
    if (!bySender) {
      bySender = new Map()
      reactions.set(entry.msgId, bySender)
    }
    const previous = bySender.get(entry.sender)
    if (!previous || previous.ts <= entry.ts) bySender.set(entry.sender, entry)
  }

  summarizeReactions (bySender) {
    if (!bySender) return []
    const grouped = new Map()
    for (const entry of bySender.values()) {
      if (!entry.emoji) continue
      let reaction = grouped.get(entry.emoji)
      if (!reaction) {
        reaction = { emoji: entry.emoji, count: 0, self: false }
        grouped.set(entry.emoji, reaction)
      }
      reaction.count += 1
      if (entry.sender.toLowerCase() === this.localId) reaction.self = true
    }
    return [...grouped.values()]
  }

  entryToMessage (entry, roomKey) {
    const sender = String(entry.sender || '').slice(0, 200)
    const decrypted = decryptPeerChatMessage(entry, roomKey)
    const payload = decodeMessagePayload(decrypted)
    const message = normalizePeerChatMessage(payload.text)
    if (!message) throw new Error('Invalid PeerChat message payload')
    return {
      id: String(entry.id || ''),
      sender,
      senderName: normalizePeerChatProfileName(entry.sn) || normalizePeerChatRoomName(sender, 'Peer'),
      message,
      ...(payload.preview && { preview: payload.preview }),
      ...(normalizePeerChatAttachment({
        message,
        fileName: entry.fileName,
        fileSize: entry.fileSize
      }) || {}),
      replyTo: normalizePeerChatReply(entry.replyTo),
      timestamp: normalizePeerChatTimestamp(entry.ts),
      self: sender.toLowerCase() === this.localId
    }
  }

  entryToSystemMessage (entry) {
    return {
      id: String(entry.id || ''),
      sender: '',
      senderName: 'PeerChat',
      message: String(entry.message || '').slice(0, 500),
      timestamp: normalizePeerChatTimestamp(entry.ts),
      self: false,
      system: true
    }
  }

  publicRoom (room) {
    const peerCount = this.countRoomPeers(room.roomKey)
    return {
      roomKey: room.roomKey,
      name: room.name,
      bio: room.bio || '',
      link: room.link || '',
      avatar: room.avatar || null,
      isDM: room.isDM === true,
      dmWith: room.dmWith || null,
      pendingAcceptance: room.pendingAcceptance === true,
      rejected: room.rejected === true,
      isHost: room.isHost === true,
      isPinned: room.isPinned === true,
      isMuted: room.isMuted === true,
      createdAt: normalizePeerChatReadTimestamp(room.createdAt),
      createdBy: normalizePeerChatPeerId(room.createdBy),
      createdByName: normalizePeerChatProfileName(room.createdByName),
      moderation: normalizePeerChatModeration(room.moderation),
      lastMessage: room.lastMessage || null,
      unreadCount: room.unreadCount || 0,
      unreadMentions: room.unreadMentions || 0,
      lastReadTs: normalizePeerChatReadTimestamp(room.lastReadTs),
      members: this.listRoomMembers(room.roomKey),
      peerCount,
      connectionState: this.getRoomConnectionState(room.roomKey, peerCount)
    }
  }

  getRoomConnectionState (roomKey, peerCount = this.countRoomPeers(roomKey)) {
    if (this.pendingJoins.has(roomKey) || !this.joinedRooms.has(roomKey) || !this.feeds.has(roomKey)) {
      return 'connecting'
    }
    for (const peer of this.peers.values()) {
      if (peer.rooms.includes(roomKey) && peer.syncingRooms?.has(roomKey)) return 'syncing'
    }
    return peerCount > 0 ? 'connected' : 'waiting'
  }

  countRoomPeers (roomKey) {
    const peerIds = new Set()
    for (const peer of this.peers.values()) {
      if (peer.rooms.includes(roomKey)) peerIds.add(peer.id)
    }
    return peerIds.size
  }

  listRoomMembers (roomKey) {
    const members = new Map()
    if (this.profile.username) {
      members.set(this.localId, {
        id: this.localId,
        username: this.profile.username,
        bio: this.profile.bio || '',
        avatar: this.profile.avatar || null,
        self: true,
        online: true
      })
    }
    for (const peer of this.peers.values()) {
      if (!peer.rooms.includes(roomKey) || members.has(peer.id)) continue
      const username = normalizePeerChatProfileName(peer.username)
      if (!username) continue
      members.set(peer.id, {
        id: peer.id,
        username,
        bio: peer.bio || '',
        avatar: peer.avatar || null,
        self: false,
        online: true
      })
      if (members.size >= MAX_RETURNED_ROOM_MEMBERS) break
    }
    return [...members.values()]
  }

  trackMessageId (id) {
    if (this.seenIds.has(id)) return false
    this.seenIds.add(id)
    if (this.seenIds.size > MAX_SEEN_MESSAGE_IDS) {
      this.seenIds.delete(this.seenIds.values().next().value)
    }
    return true
  }

  bumpVersion () {
    this.version = this.version >= Number.MAX_SAFE_INTEGER ? 1 : this.version + 1
  }

  loadState () {
    try {
      if (!existsSync(this.stateFilePath)) return
      const parsed = JSON.parse(readFileSync(this.stateFilePath, 'utf8'))
      const username = normalizePeerChatProfileName(parsed?.profile?.username)
      if (username) {
        this.profile = {
          username,
          bio: normalizePeerChatBio(parsed?.profile?.bio),
          avatar: normalizePeerChatAvatar(parsed?.profile?.avatar),
          linkPreview: parsed?.profile?.linkPreview !== false
        }
      }

      const rooms = Array.isArray(parsed?.rooms) ? parsed.rooms.slice(0, MAX_ROOMS) : []
      for (const value of rooms) {
        const roomKey = normalizePeerChatRoomKey(value?.roomKey)
        if (!roomKey) continue
        const dmWith = normalizePeerChatPeerId(value?.dmWith)
        const isDM = value?.isDM === true && Boolean(dmWith)
        this.rooms.set(roomKey, {
          roomKey,
          name: normalizePeerChatRoomName(value?.name, `${roomKey.slice(0, 8)}...`),
          bio: normalizePeerChatBio(value?.bio),
          link: normalizePeerChatLink(value?.link),
          avatar: normalizePeerChatAvatar(value?.avatar),
          isDM,
          dmWith: isDM ? dmWith : null,
          pendingAcceptance: isDM && value?.pendingAcceptance === true,
          rejected: isDM && value?.rejected === true,
          isHost: value?.isHost === true,
          isPinned: value?.isPinned === true,
          isMuted: value?.isMuted === true,
          createdAt: Number.isFinite(value?.createdAt) ? value.createdAt : Date.now(),
          joinedAt: Number.isFinite(value?.joinedAt) ? value.joinedAt : Date.now(),
          createdBy: typeof value?.createdBy === 'string' ? value.createdBy.slice(0, 200) : '',
          createdByName: normalizePeerChatProfileName(value?.createdByName),
          moderation: isDM
            ? { ...DEFAULT_PEERCHAT_MODERATION }
            : normalizePeerChatModeration(value?.moderation),
          lastMessage: normalizePersistedLastMessage(value?.lastMessage),
          unreadCount: normalizeUnreadCount(value?.unreadCount),
          unreadMentions: Math.min(
            normalizeUnreadCount(value?.unreadCount),
            normalizeUnreadCount(value?.unreadMentions)
          ),
          lastReadTs: normalizePeerChatReadTimestamp(value?.lastReadTs)
        })
      }

      const pendingDirectMessages = Array.isArray(parsed?.pendingDirectMessages)
        ? parsed.pendingDirectMessages.slice(0, MAX_PENDING_DIRECT_MESSAGES)
        : []
      for (const value of pendingDirectMessages) {
        const roomKey = normalizePeerChatRoomKey(value?.roomKey)
        const fromId = normalizePeerChatPeerId(value?.fromId)
        if (!roomKey || !fromId || roomKey !== derivePeerChatDirectRoomKey(this.localId, fromId)) continue
        this.pendingDirectMessages.set(roomKey, {
          roomKey,
          fromId,
          fromUsername: normalizePeerChatProfileName(value?.fromUsername) || fromId,
          fromBio: normalizePeerChatBio(value?.fromBio),
          fromAvatar: normalizePeerChatAvatar(value?.fromAvatar),
          receivedAt: Number.isFinite(value?.receivedAt) ? value.receivedAt : Date.now()
        })
      }
    } catch (error) {
      console.error('[peerchat] Unable to load local state:', error)
    }
  }

  schedulePersist () {
    if (this.persistTimer || this.closed) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistNow()
    }, PERSIST_DELAY_MS)
  }

  persistNow () {
    const temporaryPath = `${this.stateFilePath}.tmp`
    try {
      mkdirSync(this.storagePath, { recursive: true })
      writeFileSync(temporaryPath, JSON.stringify({
        version: 1,
        profile: this.profile,
        rooms: [...this.rooms.values()],
        pendingDirectMessages: this.listPendingDirectMessages()
      }), { mode: 0o600 })
      renameSync(temporaryPath, this.stateFilePath)
    } catch (error) {
      try { rmSync(temporaryPath, { force: true }) } catch {}
      console.error('[peerchat] Unable to save local state:', error)
    }
  }

  registerFeedStorage (roomKey, feed) {
    if (this.roomStorageBytes.has(roomKey)) return
    const byteLength = Number.isSafeInteger(feed.byteLength) && feed.byteLength > 0
      ? feed.byteLength
      : 0
    this.roomStorageBytes.set(roomKey, byteLength)
    this.totalStoredBytes += byteLength
  }

  async releaseFeed (roomKey) {
    const feed = this.feeds.get(roomKey)
    const listener = this.feedListeners.get(roomKey)
    if (feed && listener) feed.off?.('append', listener)
    this.feedListeners.delete(roomKey)
    this.feeds.delete(roomKey)
    if (feed?.close) await feed.close().catch(() => {})
  }
}

function normalizeUnreadCount (value) {
  if (!Number.isSafeInteger(value) || value < 0) return 0
  return Math.min(value, MAX_PEERCHAT_STORED_MESSAGES_PER_ROOM)
}

function normalizePeerChatReadTimestamp (value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function normalizePersistedLastMessage (value) {
  if (!value || typeof value !== 'object') return null
  const message = typeof value.message === 'string' ? value.message.slice(0, 120) : ''
  if (!message) return null
  return {
    sender: typeof value.sender === 'string' ? value.sender.slice(0, 200) : '',
    senderName: normalizePeerChatProfileName(value.senderName),
    message,
    timestamp: Number.isFinite(value.timestamp) ? value.timestamp : 0
  }
}

function waitForConnectionDrain (connection, timeoutMs = 5000) {
  if (connection.destroyed) return Promise.resolve(false)

  return new Promise((resolve) => {
    let settled = false
    const finish = (drained) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      connection.off?.('drain', onDrain)
      connection.off?.('close', onClose)
      resolve(drained)
    }
    const onDrain = () => finish(true)
    const onClose = () => finish(false)
    const timer = setTimeout(() => finish(false), timeoutMs)
    connection.once('drain', onDrain)
    connection.once('close', onClose)
  })
}
