import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import b4a from 'b4a'

import {
  createPeerChatMessageId,
  createPeerChatRoomKey,
  decryptPeerChatMessage,
  encryptPeerChatMessage,
  getSharedPeerChatRooms,
  MAX_PEERCHAT_MESSAGE_LENGTH,
  normalizePeerChatMessage,
  normalizePeerChatProfileName,
  normalizePeerChatRoomKey,
  normalizePeerChatRoomName,
  peerChatTopicHex
} from './protocol.mjs'
import { attachPeerChatTransport } from './transport.mjs'

const MAX_ROOMS = 50
const MAX_RETURNED_MESSAGES = 200
const MAX_SYNC_MESSAGES = 200
const MAX_SEEN_MESSAGE_IDS = 10_000
const MAX_FRAME_LENGTH = MAX_PEERCHAT_MESSAGE_LENGTH * 4
const LIVE_RATE_WINDOW_MS = 60_000
const MAX_LIVE_MESSAGES_PER_WINDOW = 120
const MAX_INITIAL_SYNC_MESSAGES_PER_CONNECTION = 500
const PERSIST_DELAY_MS = 500
const PING_INTERVAL_MS = 25_000

export class PeerChatService {
  constructor ({ sdk, storagePath }) {
    this.sdk = sdk
    this.storagePath = storagePath
    this.stateFilePath = `${storagePath}/peerchat-mobile.json`
    this.localId = sdk.publicKey
      ? b4a.toString(sdk.publicKey, 'hex').slice(0, 8).toLowerCase()
      : 'mobile'
    this.profile = { username: '' }
    this.rooms = new Map()
    this.feeds = new Map()
    this.joinedRooms = new Set()
    this.discoveryKeys = new Map()
    this.peers = new Map()
    this.seenIds = new Set()
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
      username: this.profile.username || ''
    }
  }

  setProfile ({ username }) {
    const normalized = normalizePeerChatProfileName(username)
    if (!normalized) {
      throw new Error('Name may only contain letters, numbers, and spaces (max 50 characters).')
    }

    this.profile = { username: normalized }
    this.schedulePersist()
    this.bumpVersion()

    for (const peer of this.peers.values()) this.sendProfile(peer)
    return this.getProfile()
  }

  async createRoom ({ name, username }) {
    this.ensureProfile(username)
    if (this.rooms.size >= MAX_ROOMS) throw new Error(`PeerChat supports up to ${MAX_ROOMS} rooms.`)

    const roomKey = createPeerChatRoomKey()
    const room = {
      roomKey,
      name: normalizePeerChatRoomName(name),
      isHost: true,
      createdAt: Date.now(),
      createdBy: this.localId,
      createdByName: this.profile.username,
      lastMessage: null
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
        isHost: false,
        createdAt: Date.now(),
        joinedAt: Date.now(),
        lastMessage: null
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
        const leftTime = left.lastMessage?.timestamp || left.createdAt
        const rightTime = right.lastMessage?.timestamp || right.createdAt
        return rightTime - leftTime
      })
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

  async sendMessage ({ roomKey, message }) {
    const normalizedRoomKey = normalizePeerChatRoomKey(roomKey)
    const room = this.rooms.get(normalizedRoomKey)
    if (!room) throw new Error('PeerChat room not found.')
    if (!this.profile.username) throw new Error('Set a PeerChat name before sending messages.')
    if (!this.feeds.has(normalizedRoomKey)) await this.joinRoomNetwork(normalizedRoomKey)

    const normalizedMessage = normalizePeerChatMessage(message)
    if (!normalizedMessage) throw new Error('Enter a message to send.')

    const encrypted = encryptPeerChatMessage(normalizedMessage, normalizedRoomKey)
    const entry = {
      id: createPeerChatMessageId(),
      sender: this.localId,
      sn: this.profile.username,
      ...encrypted,
      ts: Date.now()
    }

    this.trackMessageId(entry.id)
    await this.appendEntry(normalizedRoomKey, entry)
    this.relayToRoom(normalizedRoomKey, entry)

    return this.entryToMessage(entry, normalizedRoomKey)
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

    try {
      await this.sdk.leave(b4a.from(normalized, 'hex'))
    } catch {}

    this.rooms.delete(normalized)
    this.feeds.delete(normalized)
    this.joinedRooms.delete(normalized)
    this.discoveryKeys.delete(normalized)
    this.persistNow()
    this.bumpVersion()
    return { ok: true }
  }

  async close () {
    if (this.closed) return
    this.closed = true
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = null
    this.persistNow()

    this.sdk.swarm.off?.('connection', this.onConnection)
    this.sdk.localSwarm?.off?.('topics-change', this.onTopicsChange)
    for (const peer of this.peers.values()) {
      if (peer.pingTimer) clearInterval(peer.pingTimer)
      peer.transport?.close()
    }
    this.peers.clear()
  }

  ensureProfile (username) {
    if (username !== undefined) this.setProfile({ username })
    if (!this.profile.username) throw new Error('Set a PeerChat name first.')
  }

  async joinRoomNetwork (roomKey) {
    if (!this.joinedRooms.has(roomKey)) {
      const topic = b4a.from(roomKey, 'hex')
      const discoveryKey = peerChatTopicHex(topic)
      this.discoveryKeys.set(discoveryKey, roomKey)

      try {
        this.sdk.join(topic, { client: true, server: true })
        this.joinedRooms.add(roomKey)
        await this.sdk.swarm.flush()
      } catch (error) {
        this.discoveryKeys.delete(discoveryKey)
        this.joinedRooms.delete(roomKey)
        throw error
      }
    }

    if (this.feeds.has(roomKey)) return

    const feed = this.sdk.corestore.get({
      name: `chat-${roomKey}`,
      valueEncoding: 'json'
    })
    await feed.ready()
    this.feeds.set(roomKey, feed)

    const firstIndex = Math.max(0, feed.length - MAX_SEEN_MESSAGE_IDS)
    for (let index = firstIndex; index < feed.length; index += 1) {
      try {
        const entry = await feed.get(index)
        if (entry?.id) this.trackMessageId(entry.id)
      } catch {}
    }

    feed.on('append', () => {
      this.updateLastMessage(roomKey).catch(() => {})
      this.bumpVersion()
    })
  }

  handleConnection (connection, info = {}) {
    const sharedRooms = getSharedPeerChatRooms(info.topics, this.discoveryKeys)
    if (sharedRooms.length === 0 || this.closed) return

    const peer = {
      connection,
      id: connection.remotePublicKey
        ? b4a.toString(connection.remotePublicKey, 'hex').slice(0, 8).toLowerCase()
        : 'peer',
      rooms: sharedRooms,
      buffer: '',
      active: false,
      initialSyncCount: 0,
      liveRate: { count: 0, resetsAt: Date.now() + LIVE_RATE_WINDOW_MS },
      pendingMessages: 0,
      processing: Promise.resolve(),
      pingTimer: null,
      transport: null
    }

    const transport = attachPeerChatTransport(
      connection,
      (payload) => this.handlePeerPayload(peer, payload),
      {
        onOpen: () => this.activatePeer(peer),
        onClose: () => this.deactivatePeer(peer)
      }
    )
    if (!transport) return
    peer.transport = transport

    connection.on('error', () => {})
    connection.on('close', () => this.deactivatePeer(peer))
  }

  handleTopicsChange (connection, info = {}) {
    const peer = this.peers.get(connection)
    if (!peer) return

    const previousRooms = new Set(peer.rooms)
    peer.rooms = getSharedPeerChatRooms(info.topics, this.discoveryKeys)
    for (const roomKey of peer.rooms) {
      if (!previousRooms.has(roomKey)) this.shareRoom(peer, roomKey)
    }
    this.bumpVersion()
  }

  activatePeer (peer) {
    if (peer.active || peer.connection.destroyed || this.closed) return
    peer.active = true
    this.peers.set(peer.connection, peer)
    this.bumpVersion()

    this.sendProfile(peer)
    for (const roomKey of peer.rooms) this.shareRoom(peer, roomKey)

    peer.pingTimer = setInterval(() => {
      this.sendToPeer(peer, { type: 'ping' })
    }, PING_INTERVAL_MS)
  }

  deactivatePeer (peer) {
    if (!peer.active) return
    peer.active = false
    if (peer.pingTimer) clearInterval(peer.pingTimer)
    peer.pingTimer = null
    this.peers.delete(peer.connection)
    this.bumpVersion()
  }

  handlePeerPayload (peer, payload) {
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
        if (peer.pendingMessages >= MAX_INITIAL_SYNC_MESSAGES_PER_CONNECTION * 2) continue
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
      this.sendToPeer(peer, { type: 'pong' })
      return
    }
    if (message.type === 'pong' || message.type === 'sync-done') return

    if (message.type === 'profile') {
      const name = normalizePeerChatProfileName(message.username)
      if (name) peer.username = name
      return
    }

    const roomKey = normalizePeerChatRoomKey(message.roomKey)
    if (!roomKey || !peer.rooms.includes(roomKey) || !this.rooms.has(roomKey)) return

    if (message.type === 'request-room-meta') {
      this.sendRoomMeta(peer, roomKey)
      return
    }

    if (message.type === 'room-meta') {
      const room = this.rooms.get(roomKey)
      if (!room?.isHost) {
        const placeholder = `${roomKey.slice(0, 8)}...`
        const incomingName = normalizePeerChatRoomName(message.name, '')
        let changed = false
        if (room.name === placeholder && incomingName && incomingName !== placeholder) {
          room.name = incomingName
          changed = true
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
        if (changed) {
          this.schedulePersist()
          this.bumpVersion()
        }
      }
      return
    }

    if (message.type === 'join') {
      if (message.username) peer.username = normalizePeerChatProfileName(message.username) || peer.username
      this.sendRoomMeta(peer, roomKey)
      await this.syncHistoryToPeer(peer, roomKey)
      this.bumpVersion()
      return
    }

    if (message.type === 'leave' || message.type === 'sync-system' || message.type === 'reaction') return

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

    const entry = {
      id: message.id,
      sender: isSync && typeof message.sender === 'string'
        ? message.sender.slice(0, 200)
        : peer.id,
      sn: normalizePeerChatProfileName(message.sn) || peer.username || peer.id,
      ct: message.ct,
      iv: message.iv,
      tag: message.tag,
      ts: Number.isFinite(message.ts) ? Math.floor(message.ts) : Date.now()
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

  shareRoom (peer, roomKey) {
    this.sendRoomMeta(peer, roomKey)
    this.sendToPeer(peer, {
      type: 'join',
      roomKey,
      peerId: this.localId,
      username: this.profile.username || this.localId,
      bio: '',
      avatar: null,
      id: `${roomKey}-${this.localId}-join-${Date.now()}`,
      ts: Date.now()
    })
    this.syncHistoryToPeer(peer, roomKey).catch(() => {})
  }

  announceRoom (roomKey) {
    for (const peer of this.peers.values()) {
      if (peer.rooms.includes(roomKey)) this.shareRoom(peer, roomKey)
    }
  }

  sendProfile (peer) {
    if (!this.profile.username) return
    this.sendToPeer(peer, {
      type: 'profile',
      peerId: this.localId,
      username: this.profile.username,
      bio: '',
      avatar: null,
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
      bio: '',
      link: '',
      avatar: null,
      createdBy: room.createdBy || (room.isHost ? this.localId : ''),
      createdByName: room.createdByName || (room.isHost ? this.profile.username : '')
    })
  }

  async syncHistoryToPeer (peer, roomKey) {
    const feed = this.feeds.get(roomKey)
    if (!feed || peer.connection.destroyed) return

    const firstIndex = Math.max(0, feed.length - MAX_SYNC_MESSAGES)
    for (let index = firstIndex; index < feed.length; index += 1) {
      if (peer.connection.destroyed || !peer.rooms.includes(roomKey)) return
      try {
        const entry = await feed.get(index)
        if (!entry?.ct) continue
        const sent = this.sendToPeer(peer, { type: 'sync', roomKey, ...entry })
        if (!sent && !await waitForConnectionDrain(peer.connection)) return
      } catch {}
    }
    this.sendToPeer(peer, { type: 'sync-done' })
  }

  relayToRoom (roomKey, message) {
    for (const peer of this.peers.values()) {
      if (peer.rooms.includes(roomKey)) this.sendToPeer(peer, { ...message, roomKey })
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
    await feed.append(entry)
    await this.updateLastMessage(roomKey, entry)
    this.bumpVersion()
  }

  async updateLastMessage (roomKey, suppliedEntry = null) {
    const room = this.rooms.get(roomKey)
    const feed = this.feeds.get(roomKey)
    if (!room || !feed || feed.length === 0) return

    try {
      const entry = suppliedEntry || await feed.get(feed.length - 1)
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
    const firstIndex = Math.max(0, feed.length - MAX_RETURNED_MESSAGES)
    for (let index = firstIndex; index < feed.length; index += 1) {
      try {
        const entry = await feed.get(index)
        if (!entry?.ct) continue
        messages.push(this.entryToMessage(entry, roomKey))
      } catch {}
    }
    return messages.sort((left, right) => left.timestamp - right.timestamp)
  }

  entryToMessage (entry, roomKey) {
    return {
      id: String(entry.id || ''),
      sender: String(entry.sender || ''),
      senderName: normalizePeerChatProfileName(entry.sn) || String(entry.sender || ''),
      message: decryptPeerChatMessage(entry, roomKey),
      timestamp: Number.isFinite(entry.ts) ? entry.ts : Date.now(),
      self: String(entry.sender || '').toLowerCase() === this.localId
    }
  }

  publicRoom (room) {
    return {
      roomKey: room.roomKey,
      name: room.name,
      isHost: room.isHost === true,
      createdAt: room.createdAt || 0,
      lastMessage: room.lastMessage || null,
      peerCount: this.countRoomPeers(room.roomKey)
    }
  }

  countRoomPeers (roomKey) {
    const peerIds = new Set()
    for (const peer of this.peers.values()) {
      if (peer.rooms.includes(roomKey)) peerIds.add(peer.id)
    }
    return peerIds.size
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
      if (username) this.profile = { username }

      const rooms = Array.isArray(parsed?.rooms) ? parsed.rooms.slice(0, MAX_ROOMS) : []
      for (const value of rooms) {
        const roomKey = normalizePeerChatRoomKey(value?.roomKey)
        if (!roomKey) continue
        this.rooms.set(roomKey, {
          roomKey,
          name: normalizePeerChatRoomName(value?.name, `${roomKey.slice(0, 8)}...`),
          isHost: value?.isHost === true,
          createdAt: Number.isFinite(value?.createdAt) ? value.createdAt : Date.now(),
          joinedAt: Number.isFinite(value?.joinedAt) ? value.joinedAt : Date.now(),
          createdBy: typeof value?.createdBy === 'string' ? value.createdBy.slice(0, 200) : '',
          createdByName: normalizePeerChatProfileName(value?.createdByName),
          lastMessage: normalizePersistedLastMessage(value?.lastMessage)
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
    try {
      mkdirSync(this.storagePath, { recursive: true })
      writeFileSync(this.stateFilePath, JSON.stringify({
        version: 1,
        profile: this.profile,
        rooms: [...this.rooms.values()]
      }))
    } catch (error) {
      console.error('[peerchat] Unable to save local state:', error)
    }
  }
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
