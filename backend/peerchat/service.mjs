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
  earliestPeerChatRoomCreatedAt,
  createPeerChatMessageId,
  createPeerChatRoomKey,
  decryptPeerChatMessage,
  derivePeerChatTopic,
  encryptPeerChatMessage,
  getPeerChatMessageByteLength,
  getSharedPeerChatRooms,
  MAX_PEERCHAT_AVATAR_LENGTH,
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
import { RPC_APP_PEERCHAT_CHANGED } from '../rpc/commands.mjs'
import { notifyApp } from '../rpc/notify.mjs'
import { attachPeerChatTransport } from './transport.mjs'
import { createPeerPresence } from './presence.mjs'
import { collapsePeerChatMembers } from './members.mjs'
import {
  acceptsPeerChatCreatorKey,
  addPeerChatRoomBan,
  isPeerChatPeerBanned,
  isPeerChatRoomCreator,
  normalizePeerChatCreatorKey,
  normalizePeerChatRoomBans,
  removePeerChatRoomBan,
  resolvePeerChatCreatorKey
} from './room-moderation.mjs'
import { PRE_JOINED_PEERCHAT_ROOM_KEY } from './rooms.mjs'
import {
  checkProfileProof,
  createLink,
  displayName,
  linkId,
  makeProfileProof,
  makeTransfer,
  mergeLabels,
  nextLabel,
  normalizeLabel,
  normalizeDeviceKey,
  normalizeLink,
  normalizeMemberName,
  normalizeSharedRooms,
  normalizeTransfer
} from './device-link.mjs'
import { checkRoomProof, roomProof } from './room-proof.mjs'

const MAX_ROOMS = 50
const MAX_BLOCKED_PEERS = 500
const MAX_LEFT_ROOMS = 1000
// A person's own devices. Links are made for a few, so this is generous.
const MAX_SIBLINGS = 16
// Desktop keys its member list by peer id. Packed by size rather than by
// count: one frame carrying everyone's data-url picture passes the frame cap
// once roughly nine of them have one, and an oversized line is dropped whole.
const MEMBERS_LIST_MAX_BYTES = 192 * 1024
const PEERCHAT_NOTIFY_DEBOUNCE_MS = 40
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
const MAX_TOPIC_FRAMES_PER_WINDOW = 120
const MAX_INITIAL_SYNC_MESSAGES_PER_CONNECTION = 500
const MAX_PENDING_MESSAGES_PER_CONNECTION = 256
const MAX_RETURNED_ROOM_MEMBERS = 100
const MAX_PENDING_DIRECT_MESSAGES = 50
const PERSIST_DELAY_MS = 500
const PING_INTERVAL_MS = 25_000
const PEER_LIVENESS_TIMEOUT_MS = 60_000
const MAX_ANNOUNCED_TOPICS = 512

// A room's key never goes over the wire. Frames name a room by its topic,
// which only means something to someone who already holds the key. The two
// exceptions hand a key over on purpose: a direct-message invite, sent to the
// one person it is with, and the rooms one person's devices pass between
// themselves. PeerChat on the desktop does the same in writeToConnection.
const KEY_HANDOFF_TYPES = new Set(['dm-invite', 'link-rooms'])

function wireTopic (roomKey) {
  return peerChatTopicHex(derivePeerChatTopic(roomKey))
}

function toWire (frame) {
  if (!frame || typeof frame !== 'object' || KEY_HANDOFF_TYPES.has(frame.type)) return frame
  const out = { ...frame }
  if ('roomKey' in out) {
    const roomKey = normalizePeerChatRoomKey(out.roomKey)
    if (roomKey) out.room = wireTopic(roomKey)
    delete out.roomKey
  }
  if (out.type === 'profile' && Array.isArray(out.rooms)) {
    out.rooms = out.rooms.map(normalizePeerChatRoomKey).filter(Boolean).map(wireTopic)
  }
  return out
}

// The other way: a room a peer names by topic is one of ours or nothing, and a
// key it names outright is ignored outside the two handoffs.
function fromWire (frame, discoveryKeys) {
  if (!frame || typeof frame !== 'object') return null
  if (KEY_HANDOFF_TYPES.has(frame.type) || frame.type === 'topics') return frame
  delete frame.roomKey
  if ('room' in frame) {
    const roomKey = typeof frame.room === 'string' ? discoveryKeys.get(frame.room.toLowerCase()) : ''
    if (!roomKey) return null
    frame.roomKey = roomKey
    delete frame.room
  }
  if (frame.type === 'profile' && Array.isArray(frame.rooms)) {
    frame.rooms = frame.rooms
      .map((topic) => (typeof topic === 'string' ? discoveryKeys.get(topic.toLowerCase()) : ''))
      .filter(Boolean)
  }
  return frame
}

// The one full key behind a short id among connected peers, or '' when there
// is none or more than one. A short id is 32 bits, so a key can be ground to
// match someone's. Where two keys share one, neither gets anything meant for
// that person. The desktop has the same in routing.js.
function soleKeyFor (peers, shortId) {
  const wanted = normalizePeerChatPeerId(shortId)
  if (!wanted) return ''
  const keys = new Set()
  for (const peer of peers) {
    if (peer.connection?.destroyed || peer.id !== wanted || !peer.key) continue
    keys.add(peer.key)
  }
  return keys.size === 1 ? [...keys][0] : ''
}

export class PeerChatService {
  constructor ({ sdk, storagePath, incomingPath = '' }) {
    this.sdk = sdk
    this.storagePath = storagePath
    this.stateFilePath = `${storagePath}/peerchat-mobile.json`
    // Where a restore leaves PeerChat from another of this person's devices.
    this.incomingPath = incomingPath
    this.localKey = sdk.publicKey ? b4a.toString(sdk.publicKey, 'hex').toLowerCase() : ''
    this.localId = sdk.publicKey
      ? b4a.toString(sdk.publicKey, 'hex').slice(0, 8).toLowerCase()
      : 'mobile'
    // at: when the name, bio or picture last changed. This person's other
    // devices take the newest.
    this.profile = { username: '', bio: '', avatar: null, linkPreview: true, at: 0 }
    // This device's fixed label after the name, and the link this person's
    // devices share. See device-link.mjs.
    this.device = { label: '' }
    this.link = null
    // Peers whose profile carried a proof made with the link: this person's
    // other devices. Kept, so their messages are still this person's after a
    // restart, before they have been seen again.
    this.siblings = new Set()
    // Rooms this phone left or was removed from, by when. Another of the
    // person's devices offering one back is ignored until it is joined again
    // here, so leaving a room on one device sticks.
    this.leftRooms = new Map()
    this.rooms = new Map()
    this.pendingDirectMessages = new Map()
    // Blocking someone hides everything they send, in every room, and stops
    // their direct messages and requests. It all stays on disk, so unblocking
    // brings it back.
    this.blockedPeers = new Map()
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
    this.presence = createPeerPresence()
    this.presenceTimer = null
    this.seenIds = new Set()
    this.activeRoomKey = null
    this.version = 0
    this.persistTimer = null
    this.notifyTimer = null
    this.started = false
    this.closed = false
    this.onConnection = this.handleConnection.bind(this)
  }

  async start () {
    if (this.started) return this
    this.started = true
    this.loadState()
    this.takeIncomingTransfer()

    // Nothing listens for the swarm's topic changes. Anyone can announce a
    // topic, so being found under one opens nothing, and our proofs already go
    // out when a connection opens, when we join a room, when a peer opens one
    // with us, and on every ping. The LAN swarm reports a change on every mDNS
    // sighting, and answering each with a frame of proofs ran through the other
    // side's control budget, which then dropped the proof for a new room.
    this.sdk.swarm.on('connection', this.onConnection)

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
      linkPreview: this.profile.linkPreview !== false,
      device: this.device.label || '',
      displayName: this.myName()
    }
  }

  // The name everyone sees: the profile name and this device's label.
  myName () {
    return displayName(this.profile.username, this.device.label)
  }

  hasRoom (roomKey) {
    return this.rooms.has(normalizePeerChatRoomKey(roomKey))
  }

  setProfile ({ username, bio, avatar, linkPreview }) {
    const normalized = normalizePeerChatProfileName(username)
    if (!normalized) {
      throw new Error('Name may only contain letters, numbers, and spaces (max 50 characters).')
    }
    const isRename = normalized.toLowerCase() !== (this.profile.username || '').toLowerCase()
    if (isRename && this.isUsernameTaken(normalized)) {
      throw new Error('Username is already taken. Please choose a different one.')
    }

    const normalizedAvatar = avatar === undefined
      ? this.profile.avatar
      : normalizePeerChatAvatar(avatar)
    if (avatar != null && avatar !== '' && !normalizedAvatar) {
      throw new Error('Choose a supported PeerChat profile image under 192 KB.')
    }
    const next = {
      username: normalized,
      bio: bio === undefined ? this.profile.bio : normalizePeerChatBio(bio),
      avatar: normalizedAvatar,
      linkPreview: linkPreview === undefined ? this.profile.linkPreview !== false : linkPreview !== false
    }
    const changed = next.username !== this.profile.username ||
      (next.bio || '') !== (this.profile.bio || '') ||
      (next.avatar || null) !== (this.profile.avatar || null)
    this.profile = { ...next, at: changed ? Date.now() : this.profile.at || 0 }
    this.schedulePersist()
    this.bumpVersion()

    for (const peer of this.peers.values()) this.sendProfile(peer)
    return this.getProfile()
  }

  async completeOnboarding ({ username, bio, avatar, linkPreview } = {}) {
    if (this.profile.username) throw new Error('PeerChat profile is already set.')
    const normalizedUsername = normalizePeerChatProfileName(username)
    if (!normalizedUsername) {
      throw new Error('Name may only contain letters, numbers, and spaces (max 50 characters).')
    }

    try {
      await this.joinRoomWithoutProfile(PRE_JOINED_PEERCHAT_ROOM_KEY)
    } catch {}

    if (this.isUsernameTaken(normalizedUsername)) {
      throw new Error('Username is already taken. Please choose a different one.')
    }

    const profile = this.setProfile({ username: normalizedUsername, bio, avatar, linkPreview })
    const welcomeRoom = this.rooms.get(PRE_JOINED_PEERCHAT_ROOM_KEY)
    if (welcomeRoom) welcomeRoom.lastMessage = null
    this.schedulePersist()

    return { profile, rooms: this.listRooms() }
  }

  async createRoom ({ name, username, bio, link, avatar, moderation }) {
    this.ensureProfile(username)
    if (this.rooms.size >= MAX_ROOMS) throw new Error(`PeerChat supports up to ${MAX_ROOMS} rooms.`)

    const roomKey = createPeerChatRoomKey()
    const now = Date.now()
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
      createdAt: now,
      joinedAt: now,
      createdBy: this.localId,
      // The whole key, because the eight characters above are a label and a
      // removal has to be checked against something that cannot be ground out.
      creatorKey: this.localKey,
      createdByName: this.myName(),
      moderation: normalizePeerChatModeration(moderation),
      bans: [],
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
    this.offerRoomToSiblings(roomKey)
    this.schedulePersist()
    this.bumpVersion()

    return this.publicRoom(room)
  }

  async joinRoom ({ roomKey, username }) {
    this.ensureProfile(username)
    return this.joinRoomWithoutProfile(roomKey)
  }

  async joinRoomWithoutProfile (roomKey) {
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
    this.leftRooms.delete(normalized)
    this.offerRoomToSiblings(normalized)
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

  getUnreadTotal () {
    let total = 0
    for (const room of this.rooms.values()) {
      total += normalizeUnreadCount(room.unreadCount)
      if (total >= Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
    }
    return total
  }

  listPendingDirectMessages () {
    return [...this.pendingDirectMessages.values()]
      .sort((left, right) => right.receivedAt - left.receivedAt)
      .slice(0, MAX_PENDING_DIRECT_MESSAGES)
  }

  async createDirectMessage ({ peerId, username, bio, avatar } = {}) {
    this.ensureProfile()
    const normalizedPeerId = normalizePeerChatPeerId(peerId)
    if (!normalizedPeerId || normalizedPeerId === this.localId) throw new Error('Choose another peer.')
    if (this.isPeerBlocked(normalizedPeerId)) throw new Error('Unblock this person before messaging them.')

    // An offline peer is allowed. activatePeer re-sends the invite the moment
    // they connect, so the room opens now and waits rather than failing. The
    // invite carries the key, so it goes to the one key behind the short id;
    // with two keys sharing it, it waits until only one is there.
    const peer = this.peerWithKey(soleKeyFor(this.peers.values(), normalizedPeerId))
    const known = peer || this.findKnownMember(normalizedPeerId)

    // One conversation per person, found by who it is with. The key used to be
    // sha256 of the two peer ids, and those are public: anybody who knew both
    // could derive it, join the topic and read the whole conversation along
    // with its media. A room key is a secret, so it is minted like any other
    // room's and handed to them on the connection instead.
    const roomKey = this.findDirectRoomKey(normalizedPeerId) || createPeerChatRoomKey()
    let room = this.rooms.get(roomKey)
    const createdRoom = !room
    if (!room) {
      if (this.rooms.size >= MAX_ROOMS) throw new Error(`PeerChat supports up to ${MAX_ROOMS} rooms.`)
      room = this.createDirectRoom({
        roomKey,
        peerId: normalizedPeerId,
        username: normalizeMemberName(username) || known?.username || normalizedPeerId,
        bio: normalizePeerChatBio(bio ?? known?.bio),
        avatar: normalizePeerChatAvatar(avatar ?? known?.avatar),
        pendingAcceptance: true
      })
      this.rooms.set(roomKey, room)
    } else if (!room.isDM || room.dmWith !== normalizedPeerId) {
      throw new Error('PeerChat direct-message room is invalid.')
    }
    // Asking again clears both. A block that could never be retried would make
    // the other side's unblock meaningless, and if they are still blocking us
    // the answer comes straight back.
    if (room.rejected || room.blockedByPeer) {
      room.rejected = false
      room.blockedByPeer = false
      room.pendingAcceptance = true
    }
    try {
      await this.joinRoomNetwork(roomKey)
    } catch (error) {
      if (createdRoom) this.rooms.delete(roomKey)
      throw error
    }
    const target = this.peerWithKey(room.dmWithKey) || peer
    if (room.pendingAcceptance && target) this.sendDirectMessageInvite(target, room)
    this.schedulePersist()
    this.bumpVersion()
    return { room: this.publicRoom(room), rooms: this.listRooms(), version: this.version }
  }

  async acceptDirectMessage ({ roomKey } = {}) {
    const normalized = normalizePeerChatRoomKey(roomKey)
    const pending = this.pendingDirectMessages.get(normalized)
    if (!pending) throw new Error('PeerChat direct-message request not found.')
    if (this.rooms.size >= MAX_ROOMS) throw new Error(`PeerChat supports up to ${MAX_ROOMS} rooms.`)

    // Bound to the key the invite came from. A request kept from before keys
    // were recorded falls back to the only key behind the short id.
    const fromKey = pending.fromKey || soleKeyFor(this.peers.values(), pending.fromId)
    const room = this.createDirectRoom({
      roomKey: normalized,
      peerId: pending.fromId,
      peerKey: fromKey,
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
    const peer = this.peerWithKey(fromKey)
    if (peer) this.sendDirectMessageControl(peer, 'dm-accept', room)
    this.leftRooms.delete(normalized)
    this.offerRoomToSiblings(normalized)
    this.persistNow()
    this.bumpVersion()
    return { room: this.publicRoom(room), rooms: this.listRooms(), version: this.version }
  }

  rejectDirectMessage ({ roomKey } = {}) {
    const normalized = normalizePeerChatRoomKey(roomKey)
    const pending = this.pendingDirectMessages.get(normalized)
    if (!pending) throw new Error('PeerChat direct-message request not found.')
    this.pendingDirectMessages.delete(normalized)
    const peer = this.peerWithKey(pending.fromKey || soleKeyFor(this.peers.values(), pending.fromId))
    if (peer) this.sendDirectMessageControl(peer, 'dm-reject', { roomKey: normalized, dmWith: pending.fromId })
    this.persistNow()
    this.bumpVersion()
    return { pendingDirectMessages: this.listPendingDirectMessages(), version: this.version }
  }

  // Checked against everyone we can see: connected peers and the people already
  // recorded in our rooms.
  isUsernameTaken (username) {
    const wanted = normalizePeerChatProfileName(username).toLowerCase()
    if (!wanted) return false

    for (const peer of this.peers.values()) {
      if (normalizePeerChatPeerId(peer.id) === this.localId || this.siblings.has(peer.id)) continue
      if (normalizeMemberName(peer.username).toLowerCase() === wanted) return true
    }
    for (const room of this.rooms.values()) {
      for (const member of room.members || []) {
        if (member.id === this.localId || this.siblings.has(member.id)) continue
        if (normalizeMemberName(member.username).toLowerCase() === wanted) return true
      }
    }
    return false
  }

  // Whatever we last saw of a peer, so a direct room opened while they are
  // offline still carries their name rather than a hex id.
  findKnownMember (peerId) {
    for (const room of this.rooms.values()) {
      const member = (room.members || []).find((entry) => entry.id === peerId)
      if (member?.username) return member
    }
    return null
  }

  isPeerBlocked (peerId) {
    const id = normalizePeerChatPeerId(peerId)
    return Boolean(id) && this.blockedPeers.has(id)
  }

  listBlockedPeers () {
    return [...this.blockedPeers.values()].sort((left, right) => right.blockedAt - left.blockedAt)
  }

  async blockPeer ({ peerId, username } = {}) {
    const id = normalizePeerChatPeerId(peerId)
    if (!id) throw new Error('PeerChat peer not found.')
    if (id === this.localId) throw new Error('You cannot block yourself.')

    const existing = this.blockedPeers.get(id)
    this.blockedPeers.set(id, {
      peerId: id,
      username: normalizeMemberName(username) || existing?.username || id,
      blockedAt: existing?.blockedAt ?? Date.now()
    })
    while (this.blockedPeers.size > MAX_BLOCKED_PEERS) {
      this.blockedPeers.delete(this.blockedPeers.keys().next().value)
    }

    // Drop any request they already had waiting.
    for (const [key, pending] of this.pendingDirectMessages) {
      if (pending.fromId === id) this.pendingDirectMessages.delete(key)
    }

    await this.refreshLastMessages()
    this.persistNow()
    this.bumpVersion()
    return {
      blockedPeers: this.listBlockedPeers(),
      pendingDirectMessages: this.listPendingDirectMessages(),
      version: this.version
    }
  }

  async unblockPeer ({ peerId } = {}) {
    const id = normalizePeerChatPeerId(peerId)
    if (!id || !this.blockedPeers.delete(id)) throw new Error('PeerChat peer is not blocked.')
    await this.refreshLastMessages()
    this.persistNow()
    this.bumpVersion()
    return { blockedPeers: this.listBlockedPeers(), version: this.version }
  }

  // A room's preview line, worked out again after a block or an unblock.
  async refreshLastMessages () {
    for (const roomKey of this.rooms.keys()) {
      if (this.feeds.has(roomKey)) await this.updateLastMessage(roomKey)
    }
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
    // Read first: this is where authors are lifted out of the feed, and the
    // room payload below has to include them.
    const messages = unchanged ? null : await this.readMessages(normalized)
    return {
      version: this.version,
      profile: this.getProfile(),
      room: this.publicRoom(room),
      rooms: this.listRooms(),
      messages
    }
  }

  async sendMessage ({ roomKey, message, replyTo, fileName, fileSize, fileEnc, preview, forwarded }) {
    const normalizedRoomKey = normalizePeerChatRoomKey(roomKey)
    const room = this.rooms.get(normalizedRoomKey)
    if (!room) throw new Error('PeerChat room not found.')
    if (room.isDM && room.pendingAcceptance) throw new Error('Wait for the peer to accept this message request.')
    if (room.isDM && room.rejected) throw new Error('This peer declined the message request.')
    if (room.isDM && room.blockedByPeer) throw new Error('This peer blocked your direct messages.')
    if (room.isDM && this.isPeerBlocked(room.dmWith)) throw new Error('Unblock this person before messaging them.')
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
      fileSize,
      fileEnc
    })
    const entry = {
      id: createPeerChatMessageId(),
      sender: this.localId,
      sn: this.myName(),
      ...encrypted,
      ...(normalizedReply && { replyTo: normalizedReply }),
      ...(attachment || {}),
      // Sent on from another chat: shown as forwarded on every side. A build
      // without this shows it as an ordinary message.
      ...(forwarded === true && { fwd: true }),
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
      sn: this.myName(),
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
      username: this.myName() || this.localId,
      id: `${wireTopic(normalized)}-${this.localId}-left-${Date.now()}`,
      ts: Date.now()
    })

    await this.dropRoomLocally(normalized)
    return { ok: true }
  }

  /**
   * Leaves every room the normal way, so each one hears this device go, and
   * hands back which rooms they were for their data to be removed afterwards.
   */
  async leaveAllRooms () {
    const roomKeys = [...this.rooms.keys()]
    for (const roomKey of roomKeys) {
      await this.leaveRoom({ roomKey }).catch(() => {})
    }
    return roomKeys
  }

  /**
   * Forget a room on this device: its topic, its feed, its record.
   *
   * No leave announcement, because callers either send their own or are
   * dropping a room nobody else ever joined. The record goes first and the
   * topic after, so a caller that does not wait still sees the room gone on
   * the very next line.
   */
  async dropRoomLocally (roomKey) {
    const normalized = normalizePeerChatRoomKey(roomKey)
    if (!normalized) return

    this.rooms.delete(normalized)
    this.markRoomLeft(normalized)
    this.moderator.clearRoom(normalized)
    this.presence.forgetRoom(normalized)
    if (this.activeRoomKey === normalized) this.activeRoomKey = null
    this.joinedRooms.delete(normalized)
    this.discoveryKeys.delete(peerChatTopicHex(derivePeerChatTopic(normalized)))
    this.persistNow()
    this.bumpVersion()

    const pendingJoin = this.pendingJoins.get(normalized)
    if (pendingJoin) await pendingJoin.catch(() => {})
    try {
      await this.sdk.leave(derivePeerChatTopic(normalized))
    } catch {}
    await this.releaseFeed(normalized)
  }

  async close () {
    if (this.closed) return
    this.closed = true
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = null
    if (this.notifyTimer) clearTimeout(this.notifyTimer)
    this.notifyTimer = null
    if (this.presenceTimer) clearTimeout(this.presenceTimer)
    this.presenceTimer = null
    this.presence.clear()

    this.sdk.swarm.off?.('connection', this.onConnection)
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
    // The feed before anyone hears we are in the room. A peer starts sending
    // the moment our proof reaches it, and whatever came in while there was
    // nowhere to keep it was lost for good, its id already marked as seen. The
    // first message of a new direct conversation, sent the instant it was
    // accepted, never showed up.
    const opened = await this.openRoomFeed(roomKey)
    if (this.closed) throw new Error('PeerChat service is closed.')
    // Left while the feed was opening.
    if (!this.rooms.has(roomKey) || this.joinedRooms.has(roomKey)) return

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
      // The next try starts again from the feed.
      if (opened) await this.releaseFeed(roomKey)
      throw error
    }
  }

  // True when this call opened it.
  async openRoomFeed (roomKey) {
    if (this.feeds.has(roomKey)) return false

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
    return true
  }

  handleConnection (connection, info = {}) {
    const sharedRooms = getSharedPeerChatRooms(info.topics, this.discoveryKeys)
    const hasTopics = Array.isArray(info.topics)
      ? info.topics.length > 0
      : !!info.topics?.length
    // Found under one of our topics, or arriving without any (inbound ones
    // can). Either way it starts in no room: anyone can announce a topic, so
    // rooms open one by one as the peer proves it holds their keys.
    if (this.closed || (sharedRooms.length === 0 && (hasTopics || this.discoveryKeys.size === 0))) return

    const peer = {
      connection,
      id: connection.remotePublicKey
        ? b4a.toString(connection.remotePublicKey, 'hex').slice(0, 8).toLowerCase()
        : 'peer',
      // The whole key the handshake established. Nothing a peer says about
      // itself can change this, which is what makes it worth checking against.
      key: connection.remotePublicKey
        ? b4a.toString(connection.remotePublicKey, 'hex').toLowerCase()
        : '',
      rooms: [],
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

  activatePeer (peer) {
    if (peer.active || peer.connection.destroyed || this.closed) return
    peer.active = true
    this.pendingPeers.delete(peer.connection)
    this.peers.set(peer.connection, peer)
    this.rememberPeerPresence(peer)
    this.bumpVersion()

    // Our proofs, and any invite waiting on this person. Nothing about a room,
    // and not even our name: anyone who announced one of our topics can get
    // this far. A room opens when the peer proves it holds the key, and our
    // profile and everything about the room go then (the topics handler).
    this.shareTopics(peer)
    for (const room of this.rooms.values()) {
      if (room.isDM && room.pendingAcceptance) this.sendDirectMessageInvite(peer, room)
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
      (!this.sendToPeer(peer, { type: 'ping' }) && this.isPeerGone(peer))
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
    this.holdPeerPresence(peer)
    this.bumpVersion()
  }

  rememberPeerPresence (peer) {
    const peerId = normalizePeerChatPeerId(peer.id)
    if (!peerId) return
    for (const roomKey of peer.rooms) this.presence.markPresent(roomKey, peerId)
  }

  // A dropped connection is usually a redial, so the room keeps them for a
  // moment rather than reporting someone left and came back.
  holdPeerPresence (peer) {
    for (const roomKey of peer.rooms) this.holdPeerPresenceInRoom(peer, roomKey)
  }

  holdPeerPresenceInRoom (peer, roomKey) {
    const peerId = normalizePeerChatPeerId(peer.id)
    if (!peerId) return
    this.presence.markAbsent(roomKey, peerId)
    this.schedulePresencePrune()
  }

  // Nothing else happens when a held peer finally drops off, so without this
  // the count would stay as it was until some unrelated event moved it.
  schedulePresencePrune () {
    if (this.presenceTimer || this.closed) return
    const expiresAt = this.presence.nextExpiryAt()
    if (expiresAt === null) return

    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null
      if (this.closed) return
      if (this.presence.prune()) this.bumpVersion()
      this.schedulePresencePrune()
    }, Math.max(0, expiresAt - Date.now()))
    this.presenceTimer.unref?.()
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
        const message = fromWire(JSON.parse(line), this.discoveryKeys)
        if (!message) continue
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
      // Proofs have their own budget. Counted with the rest, a desktop in many
      // rooms used it up on connecting, and the proof for a new room was the
      // one dropped, leaving that room shut on this connection.
      if (!this.consumeTopicRate(peer) || !Array.isArray(message.rooms)) return
      peer.handshake = true
      const added = []
      for (const entry of message.rooms.slice(0, MAX_ANNOUNCED_TOPICS)) {
        const topic = typeof entry?.topic === 'string' ? entry.topic.toLowerCase() : ''
        // Unknown topics resolve to nothing, and a known one opens only with a
        // proof made with its key for this connection.
        const roomKey = this.discoveryKeys.get(topic)
        if (!roomKey || peer.rooms.includes(roomKey) || added.includes(roomKey)) continue
        if (!checkRoomProof(roomKey, peer.connection.handshakeHash, peer.key, entry.proof)) continue
        added.push(roomKey)
      }
      if (!added.length) return
      peer.rooms.push(...added)
      // Our proofs before anything of ours about these rooms, or the other side
      // drops our join as coming from outside the room. Every time, not once:
      // one of these may be a room we joined after our last proofs went out.
      // The other side ignores rooms already open, so it settles.
      this.shareTopics(peer)
      this.sendProfile(peer)
      for (const roomKey of added) this.shareRoom(peer, roomKey)
      if (peer.active) this.rememberPeerPresence(peer)
      this.bumpVersion()
      return
    }

    if (message.type === 'profile') {
      if (!this.consumeControlRate(peer)) return
      if (message.link && this.link && this.profile.username &&
          checkProfileProof(this.link, message.link, message.avatar || null, peer.key)) {
        const first = !peer.sibling
        peer.sibling = true
        if (!this.siblings.has(peer.id) && this.siblings.size < MAX_SIBLINGS) {
          this.siblings.add(peer.id)
          this.schedulePersist()
        }
        this.takeSiblingProfile(message.link, message.avatar || null)
        // Every room this phone is in, once per connection.
        if (first) this.sendRoomsToSibling(peer, this.sharedRoomEntries())
      }
      let changed = false
      const name = normalizeMemberName(message.username)
      if (name && name !== peer.username) {
        peer.username = name
        changed = true
      }
      const bio = normalizePeerChatBio(message.bio)
      const avatar = normalizePeerChatAvatar(message.avatar)
      if (bio !== peer.bio || avatar !== peer.avatar) {
        peer.bio = bio
        peer.avatar = avatar
        changed = true
      }
      for (const roomKey of peer.rooms) {
        const room = this.rooms.get(roomKey)
        if (!room) continue
        if (this.directMessageFrom(room, peer)) {
          room.bio = bio
          room.avatar = avatar
        }
        if (this.rememberRoomMember(room, peer)) changed = true
      }
      if (changed) {
        this.schedulePersist()
        this.bumpVersion()
      }
      return
    }

    if (message.type === 'dm-invite') {
      if (!this.consumeControlRate(peer)) return
      this.receiveDirectMessageInvite(peer, message)
      return
    }

    // Rooms another of this person's devices is in. Only from a peer that
    // proved it is one on this connection; anything else is dropped.
    if (message.type === 'link-rooms') {
      if (!this.consumeControlRate(peer)) return
      if (!peer.sibling || !this.link || !Array.isArray(message.rooms)) return
      await this.takeSiblingRooms(message.rooms)
      return
    }

    if (message.type === 'dm-blocked') {
      if (!this.consumeControlRate(peer)) return
      const blockedRoomKey = normalizePeerChatRoomKey(message.roomKey)
      const blockedRoom = this.rooms.get(blockedRoomKey)
      if (!this.directMessageFrom(blockedRoom, peer)) return
      // Its own flag rather than reusing rejected: a decline can be retried, a
      // block cannot, and the two read differently to the person seeing it.
      blockedRoom.pendingAcceptance = false
      blockedRoom.blockedByPeer = true
      this.schedulePersist()
      this.bumpVersion()
      return
    }

    if (message.type === 'dm-accept' || message.type === 'dm-reject') {
      if (!this.consumeControlRate(peer)) return
      const directRoomKey = normalizePeerChatRoomKey(message.roomKey)
      const directRoom = this.rooms.get(directRoomKey)
      // The room has to be a conversation with the peer this arrived from.
      // Their identity comes from the handshake, which cannot be claimed.
      if (!directRoomKey || !this.directMessageFrom(directRoom, peer)) return
      if (message.type === 'dm-accept') {
        if (!directRoom.dmWithKey && peer.key) directRoom.dmWithKey = peer.key
        directRoom.pendingAcceptance = false
        directRoom.rejected = false
        directRoom.blockedByPeer = false
        directRoom.name = normalizeMemberName(message.fromUsername) || directRoom.name
        directRoom.bio = normalizePeerChatBio(message.fromBio)
        directRoom.avatar = normalizePeerChatAvatar(message.fromAvatar)
        this.offerRoomToSiblings(directRoomKey)
      } else {
        directRoom.pendingAcceptance = false
        directRoom.rejected = true
      }
      this.schedulePersist()
      this.bumpVersion()
      return
    }

    // Only a room this peer proved it holds the key to on this connection. A
    // join used to count as proof when it named the room by its key, but frames
    // name rooms by topic now, which anyone can know. Both sides send their
    // proofs before their joins, so a join never arrives ahead of its proof.
    const roomKey = normalizePeerChatRoomKey(message.roomKey)
    if (!roomKey || !peer.rooms.includes(roomKey) || !this.rooms.has(roomKey)) return
    if (this.moderator.isKicked(peer.id, roomKey)) return

    // Removed by whoever made the room. Nothing they send counts, including
    // the removal list itself, so this sits above the handlers below.
    if (this.isPeerRemovedFromRoom(roomKey, peer)) return

    // The removal list, from the creator and nobody else. It carries no
    // message id and no encrypted body, so an older build drops it at its
    // first check rather than making anything of it.
    if (message.type === 'room-bans') {
      if (!this.consumeControlRate(peer)) return
      this.receiveRoomBans(roomKey, peer, message.bans)
      return
    }

    // A block only closes direct messages. Shared rooms keep working, so this
    // check is scoped to the one-to-one room rather than the peer.
    const incomingRoom = this.rooms.get(roomKey)
    if (incomingRoom.isDM && incomingRoom.dmWith === peer.id && this.isPeerBlocked(peer.id)) return

    if (message.type === 'request-room-meta') {
      if (!this.consumeControlRate(peer)) return
      this.sendRoomMeta(peer, roomKey)
      return
    }

    if (message.type === 'members-list') {
      if (!this.consumeControlRate(peer)) return
      if (this.mergeMembersList(roomKey, message.members)) {
        this.schedulePersist()
        this.bumpVersion()
      }
      return
    }

    if (message.type === 'room-meta') {
      if (!this.consumeControlRate(peer)) return
      const room = this.rooms.get(roomKey)
      // A direct message's name, bio and picture are the other person's, and
      // come from their profile. Their room-meta describes this room as they
      // see it, which is after us: a missing picture taken from it put our own
      // picture on their chat whenever they had none, until their next profile
      // put it back. The desktop has always skipped these.
      if (room?.isDM) return
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
        // The room cannot have been created after the first person in it, so
        // the earliest anyone reports wins. Without this every device showed
        // the day it joined.
        const earliestCreatedAt = earliestPeerChatRoomCreatedAt(room.createdAt, message.createdAt)
        if (earliestCreatedAt && earliestCreatedAt !== room.createdAt) {
          room.createdAt = earliestCreatedAt
          changed = true
        }
        if (!room.createdBy && typeof message.createdBy === 'string') {
          room.createdBy = message.createdBy.slice(0, 200)
          changed = true
        }
        // Only from the creator, and only once. The connection is what proves
        // it: whoever is announcing has to be the key they are announcing.
        if (acceptsPeerChatCreatorKey({
          roomKey,
          storedKey: room.creatorKey,
          createdBy: room.createdBy,
          announcedKey: message.creatorKey,
          connectionKey: peer.key
        })) {
          room.creatorKey = normalizePeerChatCreatorKey(message.creatorKey)
          changed = true
        }
        if (!room.createdByName) {
          const creatorName = normalizeMemberName(message.createdByName)
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
      const room = this.rooms.get(roomKey)
      // Whether the room already counted them as a member, asked before
      // remembering them, so the notice below is for a first arrival rather
      // than for every reconnect.
      const wasMember = Boolean(
        (room?.members || []).find((member) => member.id === peer.id)?.joinedAt
      )
      if (message.username) peer.username = normalizeMemberName(message.username) || peer.username
      if (Object.hasOwn(message, 'bio')) peer.bio = normalizePeerChatBio(message.bio)
      if (Object.hasOwn(message, 'avatar')) peer.avatar = normalizePeerChatAvatar(message.avatar)
      if (this.rememberRoomMember(room, peer, message.ts)) this.schedulePersist()
      await this.appendJoinNotice(roomKey, peer, message, wasMember)
      this.sendRoomMeta(peer, roomKey)
      // Not awaited. Sending our history waits on their side to drain, and
      // while it waited nothing else they sent was read: a live message
      // behind a long history was dropped once the queue filled.
      this.syncHistoryToPeerOnce(peer, roomKey).catch(() => {})
      this.bumpVersion()
      return
    }

    // They left this room. The connection stays, for every other room the two
    // of you share, and they prove this one again if they come back.
    if (message.type === 'leave') {
      if (normalizePeerChatPeerId(message.peerId) === peer.id) {
        peer.rooms = peer.rooms.filter((key) => key !== roomKey)
        this.holdPeerPresenceInRoom(peer, roomKey)
        this.bumpVersion()
      }
      return
    }
    if (message.type === 'sync-system') return

    const isReaction = message.type === 'reaction' || message.type === 'sync-reaction'
    if (isReaction) {
      const isSyncReaction = message.type === 'sync-reaction'
      if (isSyncReaction) {
        if (peer.initialSyncCount >= MAX_INITIAL_SYNC_MESSAGES_PER_CONNECTION) return
        peer.initialSyncCount += 1
      } else if (!this.consumeLiveRate(peer)) {
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

    // A removed person's old messages can still reach us through somebody
    // else's history sync, which is how they kept appearing after a removal.
    if (isSync && this.isPeerIdRemovedFromRoom(roomKey, normalizePeerChatPeerId(message.sender))) return

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
      fileSize: message.fileSize,
      fileEnc: message.fileEnc
    })
    const entry = {
      id: message.id,
      sender: isSync && typeof message.sender === 'string'
        ? message.sender.slice(0, 200)
        : peer.id,
      sn: normalizeMemberName(message.sn) || peer.username || peer.id,
      ...safeEncrypted,
      ...(normalizedReply && { replyTo: normalizedReply }),
      ...(attachment || {}),
      ...(message.fwd === true && { fwd: true }),
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

  consumeTopicRate (peer) {
    const now = Date.now()
    if (!peer.topicRate || now >= peer.topicRate.resetsAt) {
      peer.topicRate = { count: 1, resetsAt: now + LIVE_RATE_WINDOW_MS }
      return true
    }
    if (peer.topicRate.count >= MAX_TOPIC_FRAMES_PER_WINDOW) return false
    peer.topicRate.count += 1
    return true
  }

  // Everyone who has been in the room, not just whoever we have seen ourselves.
  // Without this a phone only ever lists the handful of peers it is connected
  // to, while desktop shows the whole room.
  shareMembers (peer, roomKey) {
    const room = this.rooms.get(roomKey)
    const members = room?.members || []
    if (members.length === 0) return

    let batch = {}
    let bytes = 0
    const flush = () => {
      if (Object.keys(batch).length === 0) return
      this.sendToPeer(peer, { type: 'members-list', roomKey, members: batch })
      batch = {}
      bytes = 0
    }

    for (const member of members) {
      if (!member.id || !member.username) continue
      let entry = {
        username: member.username,
        bio: member.bio || '',
        avatar: member.avatar || null,
        ...(Number.isFinite(member.joinedAt) && { joinedAt: member.joinedAt })
      }
      let size = member.id.length + JSON.stringify(entry).length
      if (size > MEMBERS_LIST_MAX_BYTES) {
        // One picture too big to travel on its own. Send the person without it
        // rather than dropping them from the room.
        entry = { ...entry, avatar: null }
        size = member.id.length + JSON.stringify(entry).length
      }
      if (bytes + size > MEMBERS_LIST_MAX_BYTES) flush()
      batch[member.id] = entry
      bytes += size
    }
    flush()
  }

  mergeMembersList (roomKey, incoming) {
    const room = this.rooms.get(roomKey)
    if (!room || !incoming || typeof incoming !== 'object') return false

    const members = Array.isArray(room.members) ? [...room.members] : []
    let changed = false

    for (const [rawId, value] of Object.entries(incoming)) {
      const id = normalizePeerChatPeerId(rawId)
      const username = normalizeMemberName(value?.username)
      if (!id || !username || id === this.localId) continue
      // Somebody removed is not in the room, so a list relayed by anyone who
      // has not heard yet cannot put them back into it.
      if (this.isPeerIdRemovedFromRoom(roomKey, id)) continue

      const index = members.findIndex((member) => member.id === id)
      if (index >= 0) {
        // Someone lifted out of the feed arrives with a name and nothing else.
        // Fill the gaps from a peer that knows them, but never overwrite what
        // we have seen from that person directly.
        const existing = members[index]
        const avatar = existing.avatar || normalizePeerChatAvatar(value?.avatar)
        const bio = existing.bio || normalizePeerChatBio(value?.bio)
        if (avatar === existing.avatar && bio === existing.bio) continue
        members[index] = { ...existing, avatar, bio }
        changed = true
        continue
      }

      if (members.length >= MAX_RETURNED_ROOM_MEMBERS - 1) break
      // joinedAt is deliberately not taken from a third party. It decides which
      // history a peer is sent, and only that peer gets to announce it.
      members.push({
        id,
        username,
        bio: normalizePeerChatBio(value?.bio),
        avatar: normalizePeerChatAvatar(value?.avatar)
      })
      changed = true
    }

    if (!changed) return false
    room.members = members
    return true
  }

  shareRoom (peer, roomKey) {
    // Room metadata before the removals, because it carries the creator key
    // and a removal is only believed from the connection whose key that is.
    // Sent first, the list arrived before there was anything to check it
    // against and was dropped, so somebody who left and rejoined found the
    // room open again.
    this.sendRoomMeta(peer, roomKey)
    this.sendRoomBans(peer, roomKey)

    // One connection carries every room two people share, so a removal stops
    // that room and leaves the rest alone. Dropping the connection instead
    // took them offline everywhere the two of you met.
    if (this.isPeerRemovedFromRoom(roomKey, peer)) return

    this.shareMembers(peer, roomKey)
    this.sendToPeer(peer, {
      type: 'join',
      roomKey,
      peerId: this.localId,
      username: this.myName() || this.localId,
      bio: this.profile.bio || '',
      avatar: this.profile.avatar || null,
      // By topic, like the room itself: an id is sent as it is.
      id: `${wireTopic(roomKey)}-${this.localId}-join-${Date.now()}`,
      ts: roomJoinTime(this.rooms.get(roomKey))
    })
    this.syncHistoryToPeerOnce(peer, roomKey).catch(() => {})
  }

  announceRoom (roomKey) {
    for (const peer of this.peers.values()) {
      this.shareTopics(peer)
      if (peer.rooms.includes(roomKey)) this.shareRoom(peer, roomKey)
    }
  }

  // Every room this phone is in, by topic, each with a proof that it holds the
  // key, made for this connection alone. The other side opens a room to us
  // when the proof checks out, and nothing else does it: anyone watching the
  // DHT knows the topics.
  shareTopics (peer) {
    const { handshakeHash, publicKey } = peer.connection
    const rooms = []
    for (const [topic, roomKey] of this.discoveryKeys) {
      const proof = roomProof(roomKey, handshakeHash, publicKey)
      if (proof) rooms.push({ topic, proof })
      if (rooms.length === MAX_ANNOUNCED_TOPICS) break
    }
    this.sendToPeer(peer, { type: 'topics', rooms })
  }

  sendProfile (peer) {
    if (!this.profile.username) return
    const proof = makeProfileProof(this.link, this.profile, this.localKey)
    this.sendToPeer(peer, {
      type: 'profile',
      peerId: this.localId,
      username: this.myName(),
      bio: this.profile.bio || '',
      avatar: this.profile.avatar || null,
      rooms: peer.rooms,
      // This device's label, and a proof only this person's other devices
      // can check. Apps without either ignore them.
      ...(proof && { device: this.device.label || '', link: proof })
    })
  }

  // A profile from another of this person's devices: the labels it knows, and
  // its name, bio and picture when they were set after ours.
  takeSiblingProfile (proof, avatar) {
    const labels = mergeLabels(this.link.labels, proof.labels)
    const labelsChanged = labels.join() !== mergeLabels(this.link.labels).join()
    if (labelsChanged) this.link = { ...this.link, labels }
    const newer = proof.at > (this.profile.at || 0)
    if (newer) this.adoptProfile({ username: proof.name, bio: proof.bio, avatar, at: proof.at })
    if (!labelsChanged && !newer) return
    this.schedulePersist()
    if (!newer) return
    this.bumpVersion()
    for (const peer of this.peers.values()) this.sendProfile(peer)
  }

  adoptProfile ({ username, bio, avatar, at }) {
    this.profile = {
      ...this.profile,
      username,
      bio: normalizePeerChatBio(bio),
      avatar: normalizePeerChatAvatar(avatar),
      at: Number.isSafeInteger(at) && at > 0 ? at : 0
    }
  }

  /**
   * A room as another of this person's devices takes it, with its key. Null
   * for one not worth having there: one this phone was removed from, and a
   * direct conversation the other person has not accepted, declined or
   * blocked, which would only send them a second request.
   */
  sharedRoomEntry (room) {
    if (!room || this.isRemovedFromRoom(room.roomKey)) return null
    if (room.isDM && (room.pendingAcceptance || room.rejected || room.blockedByPeer || !room.dmWith)) return null
    return {
      roomKey: room.roomKey,
      name: room.name,
      bio: room.bio,
      link: room.link,
      isDM: room.isDM === true,
      dmWith: room.dmWith || '',
      createdAt: room.createdAt,
      joinedAt: room.joinedAt || 0,
      createdBy: room.createdBy || (room.isHost ? this.localId : ''),
      createdByName: room.createdByName || '',
      creatorKey: room.creatorKey || ''
    }
  }

  sharedRoomEntries () {
    return [...this.rooms.values()].map((room) => this.sharedRoomEntry(room)).filter(Boolean)
  }

  /**
   * For a transfer to another of this person's devices: the link, the label
   * the other device takes, the profile and every room with its key. The link
   * is made here the first time, which makes this phone the device the name
   * was made on. Null until a name is set.
   */
  exportTransfer ({ targetType = 'desktop' } = {}) {
    if (!this.profile.username) return null
    if (!this.link) this.link = createLink('mobile')
    const rooms = this.sharedRoomEntries()
    // Kept as given, so the next desktop is not given the same label.
    const label = nextLabel(this.link, targetType === 'mobile' ? 'mobile' : 'desktop')
    this.link = { ...this.link, labels: mergeLabels(this.link.labels, [label]) }
    this.persistNow()
    return makeTransfer({ link: this.link, label, profile: this.profile, rooms })
  }

  /**
   * Puts a transfer from another of this person's devices in place and returns
   * the rooms it added. A phone holding another link, or none, takes the
   * person's link, name and the label it was given. One already holding this
   * link keeps its label and takes the name only when it is newer.
   */
  applyTransfer (transfer) {
    const sameLink = Boolean(this.link) && linkId(this.link) === linkId(transfer.link)
    if (!sameLink) {
      // Devices proven with the old link are not this person's any more.
      this.siblings.clear()
      this.link = { ...transfer.link, labels: mergeLabels(transfer.link.labels, [transfer.label]) }
      this.device = { label: transfer.label }
      if (transfer.profile) this.adoptProfile(transfer.profile)
    } else {
      this.link = { ...this.link, labels: mergeLabels(this.link.labels, transfer.link.labels) }
      if (transfer.profile && transfer.profile.at > (this.profile.at || 0)) this.adoptProfile(transfer.profile)
    }

    const added = this.addRooms(transfer.rooms)
    this.schedulePersist()
    this.bumpVersion()
    return added
  }

  /**
   * Adds rooms from another of this person's devices and returns the new ones.
   * A room left here stays left.
   */
  addRooms (rooms) {
    const added = []
    for (const room of rooms) {
      const existing = this.rooms.get(room.roomKey)
      if (existing) {
        if (room.creatorKey && !existing.creatorKey) existing.creatorKey = room.creatorKey
        continue
      }
      if (this.leftRooms.has(room.roomKey)) continue
      if (this.rooms.size >= MAX_ROOMS) break
      const now = Date.now()
      this.rooms.set(room.roomKey, {
        roomKey: room.roomKey,
        name: normalizePeerChatRoomName(room.name, `${room.roomKey.slice(0, 8)}...`),
        bio: normalizePeerChatBio(room.bio),
        link: normalizePeerChatLink(room.link),
        avatar: null,
        isDM: room.isDM,
        dmWith: room.isDM ? room.dmWith : null,
        pendingAcceptance: false,
        rejected: false,
        isHost: Boolean(room.creatorKey) && room.creatorKey === this.localKey,
        isPinned: false,
        isMuted: false,
        createdAt: room.createdAt || now,
        // Joined as of when the person joined, so peers send this phone the
        // history since then.
        joinedAt: room.joinedAt || room.createdAt || now,
        createdBy: room.createdBy,
        creatorKey: room.creatorKey,
        bans: [],
        createdByName: normalizeMemberName(room.createdByName),
        moderation: { ...DEFAULT_PEERCHAT_MODERATION },
        lastMessage: null,
        unreadCount: 0,
        unreadMentions: 0,
        lastReadTs: now,
        members: []
      })
      added.push(room.roomKey)
    }
    return added
  }

  // Rooms go only to a peer whose profile proved, on its own connection, that
  // it is another of this person's devices.
  sendRoomsToSibling (peer, rooms) {
    if (!rooms.length || !peer?.sibling) return
    this.sendToPeer(peer, { type: 'link-rooms', rooms })
  }

  // A room joined here goes to this person's other devices that are online.
  // The rest get it with every room the next time they connect.
  offerRoomToSiblings (roomKey) {
    const entry = this.sharedRoomEntry(this.rooms.get(roomKey))
    if (!entry) return
    for (const peer of this.peers.values()) {
      if (peer.sibling && !peer.connection.destroyed) this.sendRoomsToSibling(peer, [entry])
    }
  }

  async takeSiblingRooms (list) {
    const added = this.addRooms(normalizeSharedRooms(list))
    if (!added.length) return
    for (const roomKey of added) {
      try {
        await this.joinRoomNetwork(roomKey)
        this.announceRoom(roomKey)
      } catch (error) {
        console.warn(`[peerchat] Unable to join ${roomKey.slice(0, 8)} from your other device: ${error.message}`)
      }
    }
    this.schedulePersist()
    this.bumpVersion()
  }

  markRoomLeft (roomKey) {
    this.leftRooms.set(roomKey, Date.now())
    if (this.leftRooms.size > MAX_LEFT_ROOMS) {
      const oldest = [...this.leftRooms.entries()].sort((a, b) => a[1] - b[1])[0][0]
      this.leftRooms.delete(oldest)
    }
  }

  // A transfer a restore left here. Taken once, before the rooms are joined:
  // the file goes whether or not it could be used.
  takeIncomingTransfer () {
    if (!this.incomingPath || !existsSync(this.incomingPath)) return
    try {
      const transfer = normalizeTransfer(
        JSON.parse(readFileSync(this.incomingPath, 'utf8')),
        { maxAvatar: MAX_PEERCHAT_AVATAR_LENGTH }
      )
      if (transfer) {
        this.applyTransfer(transfer)
        this.persistNow()
      }
    } catch (error) {
      console.warn(`[peerchat] Unable to take PeerChat from another device: ${error.message}`)
    }
    try { rmSync(this.incomingPath, { force: true }) } catch {}
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
      createdAt: normalizePeerChatReadTimestamp(room.createdAt),
      createdBy: room.createdBy || (room.isHost ? this.localId : ''),
      // Announced by the creator alone. A peer passing this along cannot prove
      // it, so the other side will not take it from them.
      creatorKey: room.isHost ? this.localKey : '',
      createdByName: room.createdByName || (room.isHost ? this.myName() : ''),
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
    const peerName = normalizeMemberName(peer?.username) || normalizePeerChatPeerId(peer?.id) || 'Peer'
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
    if (this.isPeerBlocked(peer.id)) {
      // Tell them rather than dropping it silently. They keep seeing us in
      // shared rooms; only direct messages are closed.
      this.sendToPeer(peer, {
        type: 'dm-blocked',
        roomKey: normalizePeerChatRoomKey(message.roomKey),
        dmWith: this.localId
      })
      return
    }
    const roomKey = normalizePeerChatRoomKey(message.roomKey)
    const toId = normalizePeerChatPeerId(message.toId)
    if (!roomKey || (toId && toId !== this.localId)) return

    const existing = this.rooms.get(roomKey)
    if (this.directMessageFrom(existing, peer)) {
      this.sendDirectMessageControl(peer, 'dm-accept', existing)
      return
    }
    // A key we already hold as something other than a conversation with this
    // person, or as one bound to another key, is not theirs to name.
    if (existing) return

    // Both of us pressed Message before either invite landed, so there are two
    // keys for one conversation. Keys are random, so the lower one is an answer
    // both sides reach alone: whoever holds the other drops it, and a room
    // nobody has accepted has nothing in it to lose.
    const ours = this.findDirectRoomKey(peer.id)
    if (ours) {
      if (!this.rooms.get(ours)?.pendingAcceptance || ours < roomKey) {
        this.sendDirectMessageInvite(peer, this.rooms.get(ours))
        return
      }
      this.dropRoomLocally(ours).catch(() => {})
    }

    if (this.pendingDirectMessages.has(roomKey) || this.pendingDirectMessages.size >= MAX_PENDING_DIRECT_MESSAGES) return

    this.pendingDirectMessages.set(roomKey, {
      roomKey,
      fromId: peer.id,
      // The key it came from, which the answer goes back to and the
      // conversation is bound to once accepted.
      fromKey: peer.key,
      fromUsername: normalizeMemberName(message.fromUsername) || peer.username || peer.id,
      fromBio: normalizePeerChatBio(message.fromBio),
      fromAvatar: normalizePeerChatAvatar(message.fromAvatar),
      receivedAt: Date.now()
    })
    this.persistNow()
    this.bumpVersion()
  }

  /** The room this device already keeps for a conversation with one person. */
  findDirectRoomKey (peerId) {
    const wanted = normalizePeerChatPeerId(peerId)
    if (!wanted) return ''
    for (const [roomKey, room] of this.rooms) {
      if (room.isDM && room.dmWith === wanted) return roomKey
    }
    return ''
  }

  createDirectRoom ({ roomKey, peerId, peerKey = '', username, bio, avatar, createdAt = Date.now(), pendingAcceptance }) {
    return {
      roomKey,
      name: username,
      bio: bio || '',
      link: '',
      avatar: avatar || null,
      isHost: false,
      isDM: true,
      dmWith: peerId,
      // The whole key of the person it is with, once known. Frames about the
      // conversation go to that key and are taken from it alone.
      ...(peerKey && { dmWithKey: peerKey }),
      pendingAcceptance: pendingAcceptance === true,
      rejected: false,
      createdAt,
      joinedAt: createdAt,
      createdBy: this.localId,
      createdByName: this.myName(),
      lastMessage: null,
      unreadCount: 0,
      unreadMentions: 0,
      lastReadTs: Date.now()
    }
  }

  // An invite carries the conversation's key, so it goes to one key: the one
  // the conversation is bound to, or before that the only key connected behind
  // the short id it was written for, which it is then bound to.
  sendDirectMessageInvite (peer, room) {
    if (!room?.isDM || room.dmWith !== peer.id) return false
    const key = room.dmWithKey || soleKeyFor(this.peers.values(), room.dmWith)
    if (!key || key !== peer.key) return false
    if (!room.dmWithKey) {
      room.dmWithKey = key
      this.schedulePersist()
    }
    return this.sendDirectMessageControl(peer, 'dm-invite', room)
  }

  // Whether a frame about a conversation came from the person it is with: the
  // key it is bound to, or, before it is bound, the short id it was written for.
  directMessageFrom (room, peer) {
    if (!room?.isDM || room.dmWith !== peer.id) return false
    return !room.dmWithKey || room.dmWithKey === peer.key
  }

  // The connected peer holding a key, for frames that go to one person only.
  peerWithKey (key) {
    if (!key) return null
    return [...this.peers.values()].find((candidate) => candidate.key === key && !candidate.connection.destroyed) || null
  }

  sendDirectMessageControl (peer, type, room) {
    return this.sendToPeer(peer, {
      type,
      roomKey: room.roomKey,
      fromId: this.localId,
      fromUsername: this.myName() || this.localId,
      fromAvatar: this.profile.avatar || null,
      fromBio: this.profile.bio || '',
      ...(type === 'dm-invite' && { toId: room.dmWith })
    })
  }

  async syncHistoryToPeer (peer, roomKey) {
    const feed = this.feeds.get(roomKey)
    if (!feed || peer.connection.destroyed) return false
    // Out of the room is out of its history too.
    if (this.isPeerRemovedFromRoom(roomKey, peer)) return false

    // Send only what this peer missed. Someone who just joined starts with an
    // empty room rather than inheriting a stranger's backlog, while a member
    // coming back still gets everything since they were last here. Until they
    // tell us when they joined, send nothing, and leave it not done: their
    // join, which can come after this, sends what they missed.
    const since = this.peerJoinedAt(roomKey, peer.id)
    if (since === null) return false

    const firstIndex = Math.max(0, feed.length - MAX_SYNC_MESSAGES)
    for (let index = firstIndex; index < feed.length; index += 1) {
      if (peer.connection.destroyed || !peer.rooms.includes(roomKey)) return false
      try {
        const entry = await feed.get(index)
        if (!entry?.ct && entry?.type !== 'reaction') continue
        if (Number.isFinite(entry?.ts) && entry.ts < since) continue
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
        if (completed || peer.connection.destroyed || !peer.rooms.includes(roomKey)) {
          peer.syncedRooms.add(roomKey)
        }
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
      if (!peer.rooms.includes(roomKey)) continue
      if (this.isPeerRemovedFromRoom(roomKey, peer)) continue
      if (!this.sendToPeer(peer, { ...message, roomKey }) && this.isPeerGone(peer)) this.disconnectPeer(peer)
    }
  }

  // A send that returns false onto a full buffer is queued, not lost, and goes
  // out when the buffer drains. Dropping the connection then threw the queued
  // frame away with it, which is how the first message after connecting went
  // missing: it was sent while the profile and history were still going out.
  isPeerGone (peer) {
    return !peer.transport || peer.transport.closed === true || peer.connection.destroyed === true
  }

  sendToPeer (peer, message) {
    try {
      if (!peer.transport) return false
      return peer.transport.send(`${JSON.stringify(toWire(message))}\n`)
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
    // What you wrote on another of your devices is not news to you.
    if (!sender || this.isOwnDevice(sender) || this.isPeerBlocked(sender)) return
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
    if (suppliedEntry && this.isPeerBlocked(suppliedEntry.sender)) return

    try {
      const entry = suppliedEntry || await this.lastVisibleEntry(feed)
      if (!entry) {
        room.lastMessage = null
        this.schedulePersist()
        return
      }
      if (entry?.type === 'reaction' && entry.emoji) {
        const sender = String(entry.sender || '').slice(0, 200)
        room.lastMessage = {
          sender,
          senderName: sender.toLowerCase() === this.localId
            ? 'You'
            : normalizeMemberName(entry.sn) || normalizePeerChatRoomName(sender, 'Peer'),
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

  // The newest entry that is not from someone blocked, looked for as far back
  // as a room's history is ever read.
  async lastVisibleEntry (feed) {
    const firstIndex = Math.max(0, feed.length - MAX_RETURNED_ENTRIES)
    for (let index = feed.length - 1; index >= firstIndex; index -= 1) {
      try {
        const entry = await feed.get(index)
        if (!this.isPeerBlocked(entry?.sender)) return entry
      } catch {}
    }
    return null
  }

  async readMessages (roomKey) {
    const feed = this.feeds.get(roomKey)
    if (!feed) return []

    const messages = []
    const reactions = new Map()
    const authors = new Map()
    const firstIndex = Math.max(0, feed.length - MAX_RETURNED_ENTRIES)
    for (let index = firstIndex; index < feed.length; index += 1) {
      try {
        const entry = await feed.get(index)
        this.collectEntryAuthor(authors, entry)
        if (this.isPeerBlocked(entry?.sender)) continue
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
    this.rememberFeedAuthors(roomKey, authors)
    return messages
      .slice(-MAX_RETURNED_MESSAGES)
      .map((message) => ({
        ...message,
        reactions: this.summarizeReactions(reactions.get(message.id))
      }))
      .sort((left, right) => left.timestamp - right.timestamp)
  }

  collectEntryAuthor (authors, entry) {
    const id = normalizePeerChatPeerId(entry?.sender)
    const username = normalizeMemberName(entry?.sn)
    if (!id || !username || id === this.localId || authors.has(id)) return
    authors.set(id, username)
  }

  // Desktop lists everyone who has ever spoken in the room, not just the peers
  // that happen to be connected. The feed is the only record of the rest, so
  // their names are lifted out of it and kept with the room.
  rememberFeedAuthors (roomKey, authors) {
    const room = this.rooms.get(roomKey)
    if (!room || authors.size === 0) return

    const members = Array.isArray(room.members) ? room.members : []
    let changed = false
    for (const [id, username] of authors) {
      if (members.some((member) => member.id === id)) continue
      if (members.length >= MAX_RETURNED_ROOM_MEMBERS - 1) break
      // No joinedAt on purpose: that belongs to an announced join and drives
      // which history a peer is sent.
      members.push({ id, username, bio: '', avatar: null })
      changed = true
    }
    if (!changed) return
    room.members = members
    this.schedulePersist()
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
      senderName: normalizeMemberName(entry.sn) || normalizePeerChatRoomName(sender, 'Peer'),
      message,
      ...(payload.preview && { preview: payload.preview }),
      ...(normalizePeerChatAttachment({
        message,
        fileName: entry.fileName,
        fileSize: entry.fileSize,
        fileEnc: entry.fileEnc
      }) || {}),
      replyTo: normalizePeerChatReply(entry.replyTo),
      ...(entry.fwd === true && { forwarded: true }),
      timestamp: normalizePeerChatTimestamp(entry.ts),
      // From this person's other devices too, so a chat with yourself, or a
      // room you write in from the desktop, reads as one side.
      self: this.isOwnDevice(sender)
    }
  }

  isOwnDevice (peerId) {
    const id = normalizePeerChatPeerId(peerId)
    return Boolean(id) && (id === this.localId || this.siblings.has(id))
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
      // A direct chat with another of your devices is a chat with yourself.
      name: room.isDM && room.dmWith && this.isOwnDevice(room.dmWith) ? 'You' : room.name,
      bio: room.bio || '',
      link: room.link || '',
      avatar: room.avatar || null,
      isDM: room.isDM === true,
      dmWith: room.dmWith || null,
      // The same answer the person's dot gives everywhere else.
      ...(room.isDM === true && { dmOnline: this.isPeerOnline(room.dmWith) }),
      pendingAcceptance: room.pendingAcceptance === true,
      rejected: room.rejected === true,
      isHost: room.isHost === true,
      isCreator: this.isRoomCreator(room.roomKey),
      removedByCreator: this.isRemovedFromRoom(room.roomKey),
      bans: normalizePeerChatRoomBans(room.bans),
      isPinned: room.isPinned === true,
      isMuted: room.isMuted === true,
      createdAt: normalizePeerChatReadTimestamp(room.createdAt),
      createdBy: normalizePeerChatPeerId(room.createdBy),
      createdByName: normalizeMemberName(room.createdByName),
      moderation: normalizePeerChatModeration(room.moderation),
      blockedByPeer: room.blockedByPeer === true,
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
    if (this.feeds.get(roomKey).length === 0) {
      for (const peer of this.peers.values()) {
        if (peer.rooms.includes(roomKey) && peer.syncingRooms?.has(roomKey)) return 'syncing'
      }
    }
    return peerCount > 0 ? 'connected' : 'waiting'
  }

  /**
   * Removing people from a room.
   *
   * There is no server, so this is what every honest client agrees to do. What
   * keeps it from being a free-for-all is that hyperswarm's handshake already
   * told both sides who the other is, so a removal is checked against the
   * connection it came in on. See room-moderation.mjs.
   */
  isRoomCreator (roomKey) {
    const room = this.rooms.get(roomKey)
    if (!room) return false
    const creatorKey = resolvePeerChatCreatorKey(roomKey, room.creatorKey)
    // A room made before any of this has no key on record. Its host is still
    // its host locally, which is what lets them fill the key in.
    return creatorKey ? creatorKey === this.localKey : room.isHost === true
  }

  isPeerRemovedFromRoom (roomKey, peer) {
    const room = this.rooms.get(roomKey)
    if (!room?.bans?.length) return false
    return isPeerChatPeerBanned(room.bans, { peerId: peer.id, connectionKey: peer.key })
  }

  /**
   * By id alone, for the member list and for history somebody else relays.
   *
   * Weaker than the connection check: a ban held by key cannot be matched
   * against an id, so it only catches what the room already knows about them.
   */
  isPeerIdRemovedFromRoom (roomKey, peerId) {
    const room = this.rooms.get(roomKey)
    if (!room?.bans?.length) return false
    return isPeerChatPeerBanned(room.bans, { peerId })
  }

  /**
   * The line in the room saying somebody was removed.
   *
   * Written by each peer that honours the removal rather than relayed, so it
   * appears exactly where the removal took effect and cannot be forged by
   * somebody who is not the creator.
   */
  /**
   * "Somebody joined", the way desktop has always written it.
   *
   * Mobile wrote nothing at all, so a room on a phone never said who had
   * turned up. By name: the id is eight characters of a public key and means
   * nothing to anybody reading the room, so a peer we already have a name for
   * keeps it even when the announcement arrives without one.
   */
  async appendJoinNotice (roomKey, peer, message, wasMember) {
    if (wasMember) return
    const id = `${wireTopic(roomKey)}-${peer.id}-join-${message.ts || Date.now()}`
    if (!this.trackMessageId(typeof message.id === 'string' ? message.id : id)) return
    if (!this.feeds.has(roomKey)) return

    const name = normalizeMemberName(message.username) ||
      normalizeMemberName(peer.username) ||
      this.rooms.get(roomKey)?.members?.find((member) => member.id === peer.id)?.username ||
      peer.id
    try {
      await this.appendEntry(roomKey, {
        id,
        type: 'system',
        message: `${name} joined`,
        ts: message.ts || Date.now()
      })
    } catch (error) {
      console.warn('[peerchat] Unable to record a join:', error)
    }
  }

  async appendRemovalNotice (roomKey, peerId, username) {
    const room = this.rooms.get(roomKey)
    const name = normalizeMemberName(username) ||
      room?.members?.find((member) => member.id === peerId)?.username ||
      peerId
    // By name, because "the creator" tells nobody in the room who that was.
    const by = this.isRoomCreator(roomKey)
      ? (this.myName() || this.localId)
      : (room?.createdByName || room?.createdBy || 'whoever made the room')
    try {
      await this.appendEntry(roomKey, {
        id: `removed-${roomKey}-${peerId}-${Date.now()}`,
        type: 'system',
        moderationNotice: true,
        message: `${name} was removed from the room by ${by}`,
        ts: Date.now()
      })
    } catch (error) {
      console.warn('[peerchat] Unable to record a removal:', error)
    }
  }

  /** Whether this device is the one that was removed. */
  isRemovedFromRoom (roomKey) {
    const room = this.rooms.get(roomKey)
    if (!room?.bans?.length || this.isRoomCreator(roomKey)) return false
    return isPeerChatPeerBanned(room.bans, { peerId: this.localId, connectionKey: this.localKey })
  }

  sendRoomBans (peer, roomKey) {
    if (!this.isRoomCreator(roomKey)) return
    const room = this.rooms.get(roomKey)
    this.sendToPeer(peer, {
      type: 'room-bans',
      roomKey,
      bans: normalizePeerChatRoomBans(room?.bans)
    })
  }

  broadcastRoomBans (roomKey) {
    if (!this.isRoomCreator(roomKey)) return
    for (const peer of this.peers.values()) {
      if (peer.rooms.includes(roomKey)) this.sendRoomBans(peer, roomKey)
    }
  }

  receiveRoomBans (roomKey, peer, bans) {
    const room = this.rooms.get(roomKey)
    if (!room) return
    // Only the creator, proven by the connection rather than claimed in the
    // payload. Their list replaces ours outright: they are the record.
    if (!isPeerChatRoomCreator({
      roomKey,
      storedKey: room.creatorKey,
      connectionKey: peer.key
    })) return

    const before = new Set(normalizePeerChatRoomBans(room.bans).map((ban) => ban.id))
    room.bans = normalizePeerChatRoomBans(bans)
    for (const ban of room.bans) {
      if (before.has(ban.id)) continue
      this.appendRemovalNotice(roomKey, ban.id, ban.name).catch(() => {})
    }
    // Anyone the creator has let back in stops being filtered out of the list.
    room.members = (room.members || []).filter((member) => (
      !isPeerChatPeerBanned(room.bans, { peerId: member.id })
    ))
    this.persistNow()
    this.bumpVersion()
  }

  /** Drop anyone in the room who is no longer welcome in it. */
  async removeRoomMember ({ roomKey, peerId }) {
    const normalized = normalizePeerChatRoomKey(roomKey)
    const room = this.rooms.get(normalized)
    if (!room) throw new Error('PeerChat room not found.')
    if (room.isDM) throw new Error('There is nobody to remove from a direct message.')
    if (!this.isRoomCreator(normalized)) {
      throw new Error('Only the person who made this room can remove people from it.')
    }

    const id = normalizePeerChatPeerId(peerId)
    if (!id) throw new Error('Invalid PeerChat member.')
    if (id === this.localId) throw new Error('You cannot remove yourself from your own room.')

    // Their full key if they are here to take it from, so the removal catches
    // that person rather than anyone sharing their first eight characters.
    const connected = [...this.peers.values()]
      .find((peer) => peer.id === id && peer.rooms.includes(normalized))
    const name = (room.members || []).find((member) => member.id === id)?.username ||
      connected?.username || id
    // The name goes with the removal, for anyone in the room who never met them.
    room.bans = addPeerChatRoomBan(room.bans, { id, key: connected?.key || '', name })
    room.members = (room.members || []).filter((member) => member.id !== id)

    await this.appendRemovalNotice(normalized, id, name)
    this.broadcastRoomBans(normalized)
    this.persistNow()
    this.bumpVersion()
    // The room back, so the list on screen updates from the answer rather than
    // waiting on the next poll to notice.
    return { ok: true, room: this.publicRoom(room), rooms: this.listRooms() }
  }

  async restoreRoomMember ({ roomKey, peerId }) {
    const normalized = normalizePeerChatRoomKey(roomKey)
    const room = this.rooms.get(normalized)
    if (!room) throw new Error('PeerChat room not found.')
    if (!this.isRoomCreator(normalized)) {
      throw new Error('Only the person who made this room can let people back in.')
    }

    room.bans = removePeerChatRoomBan(room.bans, peerId)
    this.broadcastRoomBans(normalized)
    this.persistNow()
    this.bumpVersion()
    return { ok: true, room: this.publicRoom(room), rooms: this.listRooms() }
  }

  isPeerOnline (peerId) {
    const id = normalizePeerChatPeerId(peerId)
    if (!id) return false
    for (const peer of this.peers.values()) {
      if (normalizePeerChatPeerId(peer.id) === id && !peer.connection?.destroyed) return true
    }
    return this.presence.isPresentAnywhere(id)
  }

  countRoomPeers (roomKey) {
    const peerIds = []
    for (const peer of this.peers.values()) {
      if (peer.rooms.includes(roomKey)) peerIds.push(peer.id)
    }
    return this.presence.presentIds(roomKey, peerIds).size
  }

  listRoomMembers (roomKey) {
    const members = new Map()
    if (this.profile.username) {
      members.set(this.localId, {
        id: this.localId,
        username: this.myName(),
        bio: this.profile.bio || '',
        avatar: this.profile.avatar || null,
        self: true,
        online: true
      })
    }
    const room = this.rooms.get(roomKey)
    for (const member of room?.members || []) {
      if (members.has(member.id)) continue
      members.set(member.id, {
        id: member.id,
        username: member.username,
        bio: member.bio,
        avatar: member.avatar,
        self: false,
        online: false
      })
      if (members.size >= MAX_RETURNED_ROOM_MEMBERS) break
    }
    for (const peer of this.peers.values()) {
      if (!peer.rooms.includes(roomKey)) continue
      const id = normalizePeerChatPeerId(peer.id)
      const username = normalizeMemberName(peer.username)
      if (!id || !username) continue
      if (!members.has(id) && members.size >= MAX_RETURNED_ROOM_MEMBERS) break
      members.set(id, {
        id,
        username,
        bio: peer.bio || '',
        avatar: peer.avatar || null,
        self: false,
        online: true
      })
      if (members.size >= MAX_RETURNED_ROOM_MEMBERS) break
    }
    // Someone removed is not in the room, so they are not in its list. Without
    // this they came straight back: the list is rebuilt from what peers relay,
    // and deleting the stored entry only lasted until the next member list
    // arrived from somebody else.
    for (const [id, member] of members) {
      if (member.self) continue
      if (this.isPeerIdRemovedFromRoom(roomKey, id)) members.delete(id)
    }

    // Online is a person, not a room. One connection carries every room two
    // people share, and a room can open on it a moment after another, so
    // counting only this room showed someone online in a direct message and
    // offline in Peer-to-Peer Republic at the same time. Someone mid-redial
    // still counts, so their dot does not blink off and on again.
    for (const member of members.values()) {
      if (member.online || member.self) continue
      if (this.isPeerOnline(member.id)) member.online = true
    }
    return collapsePeerChatMembers([...members.values()]).sort((left, right) => {
      if (left.self !== right.self) return left.self ? -1 : 1
      if (left.online !== right.online) return left.online ? -1 : 1
      return left.username.localeCompare(right.username)
    })
  }

  peerJoinedAt (roomKey, peerId) {
    const id = normalizePeerChatPeerId(peerId)
    const member = this.rooms.get(roomKey)?.members?.find((entry) => entry.id === id)
    return Number.isFinite(member?.joinedAt) ? member.joinedAt : null
  }

  rememberRoomMember (room, peer, announcedJoinedAt) {
    const id = normalizePeerChatPeerId(peer?.id)
    const username = normalizeMemberName(peer?.username)
    if (!room || !id || id === this.localId || !username) return false
    // Announcing a join does not undo a removal.
    if (this.isPeerRemovedFromRoom(room.roomKey, peer)) return false

    const members = Array.isArray(room.members) ? [...room.members] : []
    const index = members.findIndex((member) => member.id === id)
    const existing = index >= 0 ? members[index] : null
    const announced = announcedJoinTs(announcedJoinedAt)
    // This person's other device is in the room as of when the person joined
    // it, so the history since then goes to it too, sent again if some went
    // before this arrived.
    const earlier = this.siblings.has(id) && announcedJoinedAt !== undefined &&
      Number.isFinite(existing?.joinedAt) && announced < existing.joinedAt
    if (earlier) peer.syncedRooms?.delete(room.roomKey)
    // Who they are comes with any frame, when they joined only with their join.
    // A room opens by proof and the profile goes out with it, ahead of the
    // join, so taking the moment we heard it as their join time cut off what
    // was said between their join and their proof (the first message in a
    // direct message just accepted), and made the join look like a reconnect.
    const joinedAt = earlier
      ? announced
      : existing?.joinedAt ?? (announcedJoinedAt === undefined ? undefined : announced)
    const member = {
      id,
      username,
      bio: normalizePeerChatBio(peer.bio),
      avatar: normalizePeerChatAvatar(peer.avatar),
      ...(Number.isFinite(joinedAt) && { joinedAt })
    }
    if (existing && JSON.stringify(existing) === JSON.stringify(member)) return false
    if (!existing && members.length >= MAX_RETURNED_ROOM_MEMBERS - 1) {
      // Full. A name lifted out of the feed is the one worth losing: a live
      // peer needs the slot to get their join time recorded, and without that
      // we never sync them any history at all.
      const feedOnly = members.findIndex((entry) => !Number.isFinite(entry.joinedAt))
      if (feedOnly < 0) return false
      members.splice(feedOnly, 1)
    }

    room.members = members
    if (index >= 0) room.members[index] = member
    else room.members.push(member)
    return true
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
    // Tell the app straight away rather than letting it find out on its next
    // poll. Everything funnels through here, so a new message, a reaction and
    // a join all arrive immediately.
    this.notifyVersionChanged()
  }

  notifyVersionChanged () {
    if (this.notifyTimer) return
    // Coalesce a burst, such as a history sync landing many entries at once,
    // into one wake-up rather than one per entry.
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      notifyApp(RPC_APP_PEERCHAT_CHANGED, { version: this.version })
    }, PEERCHAT_NOTIFY_DEBOUNCE_MS)
    if (typeof this.notifyTimer?.unref === 'function') this.notifyTimer.unref()
  }

  loadState () {
    try {
      if (!existsSync(this.stateFilePath)) return
      const parsed = JSON.parse(readFileSync(this.stateFilePath, 'utf8'))
      const username = normalizePeerChatProfileName(parsed?.profile?.username)
      if (username) {
        const at = parsed?.profile?.at
        this.profile = {
          username,
          bio: normalizePeerChatBio(parsed?.profile?.bio),
          avatar: normalizePeerChatAvatar(parsed?.profile?.avatar),
          linkPreview: parsed?.profile?.linkPreview !== false,
          at: Number.isSafeInteger(at) && at > 0 ? at : 0
        }
      }
      this.device = { label: normalizeLabel(parsed?.device?.label) }
      this.link = normalizeLink(parsed?.link)
      for (const value of this.link && Array.isArray(parsed?.siblings) ? parsed.siblings.slice(0, MAX_SIBLINGS) : []) {
        const id = normalizePeerChatPeerId(value)
        if (id && id !== this.localId) this.siblings.add(id)
      }
      for (const [roomKey, at] of Object.entries(parsed?.leftRooms && typeof parsed.leftRooms === 'object' ? parsed.leftRooms : {})) {
        const key = normalizePeerChatRoomKey(roomKey)
        if (key && Number.isSafeInteger(at) && at > 0 && this.leftRooms.size < MAX_LEFT_ROOMS) this.leftRooms.set(key, at)
      }

      for (const value of Array.isArray(parsed?.blockedPeers) ? parsed.blockedPeers.slice(0, MAX_BLOCKED_PEERS) : []) {
        const peerId = normalizePeerChatPeerId(value?.peerId)
        if (!peerId || peerId === this.localId) continue
        this.blockedPeers.set(peerId, {
          peerId,
          username: normalizeMemberName(value?.username) || peerId,
          blockedAt: normalizePeerChatTimestamp(value?.blockedAt)
        })
      }

      const rooms = Array.isArray(parsed?.rooms) ? parsed.rooms.slice(0, MAX_ROOMS) : []
      for (const value of rooms) {
        const roomKey = normalizePeerChatRoomKey(value?.roomKey)
        if (!roomKey) continue
        const dmWith = normalizePeerChatPeerId(value?.dmWith)
        const isDM = value?.isDM === true && Boolean(dmWith)
        const dmWithKey = isDM ? normalizeDeviceKey(value?.dmWithKey) : ''
        this.rooms.set(roomKey, {
          roomKey,
          name: normalizePeerChatRoomName(value?.name, `${roomKey.slice(0, 8)}...`),
          bio: normalizePeerChatBio(value?.bio),
          link: normalizePeerChatLink(value?.link),
          avatar: normalizePeerChatAvatar(value?.avatar),
          isDM,
          dmWith: isDM ? dmWith : null,
          ...(dmWithKey && { dmWithKey }),
          pendingAcceptance: isDM && value?.pendingAcceptance === true,
          rejected: isDM && value?.rejected === true,
          isHost: value?.isHost === true,
          isPinned: value?.isPinned === true,
          isMuted: value?.isMuted === true,
          createdAt: Number.isFinite(value?.createdAt) ? value.createdAt : Date.now(),
          // A room made here has no join time of its own: it was joined when
          // it was made. Now would move it forward on every start, and peers
          // send a member only the history since they joined.
          joinedAt: Number.isFinite(value?.joinedAt)
            ? value.joinedAt
            : Number.isFinite(value?.createdAt) ? value.createdAt : Date.now(),
          createdBy: typeof value?.createdBy === 'string' ? value.createdBy.slice(0, 200) : '',
          // A room made before any of this has no creator key on record. The
          // device that made it is the one device that can fill that in from
          // its own key, which is what lets an existing room be moderated at
          // all, P2P Republic included.
          creatorKey: normalizePeerChatCreatorKey(value?.creatorKey) ||
            (value?.isHost === true && !isDM ? this.localKey : ''),
          bans: isDM ? [] : normalizePeerChatRoomBans(value?.bans),
          createdByName: normalizeMemberName(value?.createdByName),
          moderation: isDM
            ? { ...DEFAULT_PEERCHAT_MODERATION }
            : normalizePeerChatModeration(value?.moderation),
          lastMessage: normalizePersistedLastMessage(value?.lastMessage),
          unreadCount: normalizeUnreadCount(value?.unreadCount),
          unreadMentions: Math.min(
            normalizeUnreadCount(value?.unreadCount),
            normalizeUnreadCount(value?.unreadMentions)
          ),
          lastReadTs: normalizePeerChatReadTimestamp(value?.lastReadTs),
          members: normalizePersistedRoomMembers(value?.members, this.localId)
        })
      }

      const pendingDirectMessages = Array.isArray(parsed?.pendingDirectMessages)
        ? parsed.pendingDirectMessages.slice(0, MAX_PENDING_DIRECT_MESSAGES)
        : []
      for (const value of pendingDirectMessages) {
        const roomKey = normalizePeerChatRoomKey(value?.roomKey)
        const fromId = normalizePeerChatPeerId(value?.fromId)
        if (!roomKey || !fromId) continue
        this.pendingDirectMessages.set(roomKey, {
          roomKey,
          fromId,
          fromKey: normalizeDeviceKey(value?.fromKey),
          fromUsername: normalizeMemberName(value?.fromUsername) || fromId,
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
        device: this.device,
        link: this.link,
        leftRooms: Object.fromEntries(this.leftRooms),
        siblings: [...this.siblings].slice(0, MAX_SIBLINGS),
        rooms: [...this.rooms.values()],
        pendingDirectMessages: this.listPendingDirectMessages(),
        blockedPeers: this.listBlockedPeers()
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

function roomJoinTime (room) {
  const joined = room?.joinedAt ?? room?.createdAt
  return Number.isFinite(joined) ? joined : Date.now()
}

// A peer can claim anything. A time in the future would hide every message, so
// clamp it to now; anything unusable falls back to now as well.
function announcedJoinTs (ts) {
  const now = Date.now()
  return Number.isFinite(ts) && ts > 0 && ts <= now ? ts : now
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
    senderName: normalizeMemberName(value.senderName),
    message,
    timestamp: Number.isFinite(value.timestamp) ? value.timestamp : 0
  }
}

function normalizePersistedRoomMembers (value, localId) {
  if (!Array.isArray(value)) return []
  const members = []
  const seen = new Set()
  for (const candidate of value.slice(0, MAX_RETURNED_ROOM_MEMBERS - 1)) {
    const id = normalizePeerChatPeerId(candidate?.id)
    const username = normalizeMemberName(candidate?.username)
    if (!id || id === localId || !username || seen.has(id)) continue
    seen.add(id)
    // joinedAt stays absent unless the peer announced one. Storing a zero here
    // would read as "joined at the epoch" and replay the whole room to them.
    const joinedAt = normalizePeerChatReadTimestamp(candidate?.joinedAt)
    members.push({
      id,
      username,
      bio: normalizePeerChatBio(candidate?.bio),
      avatar: normalizePeerChatAvatar(candidate?.avatar),
      ...(joinedAt > 0 && { joinedAt })
    })
  }
  return members
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
