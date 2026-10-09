// One person on several devices. Each device keeps its own network key, so
// each is its own room member, told apart by a fixed label after the name:
// "ada" where the name was made, then "ada@mobile", "ada@desktop1". There is
// one phone; a new phone takes this one's place.
//
// A link is a secret the person's devices share, sent only inside their
// sealed, code-checked transfers. A profile carries a proof made with it over
// the sender's network key, so only the person's own devices can take a name
// and its rooms from each other: a forwarded proof fails on the forwarder's
// connection. Desktop PeerChat has the same rules in lib/device-link.js, and
// the proof must match byte for byte.
import { createHash, createHmac, randomBytes } from 'node:crypto'
import b4a from 'b4a'
import { normalizeKeyChain } from './key-chain.mjs'

const KEY_RE = /^[0-9a-f]{64}$/
const LABEL_RE = /^(mobile|desktop[0-9]{0,3})$/
const ROOM_KEY_RE = /^[0-9a-f]{64}$/
const PEER_ID_RE = /^[0-9a-f]{8}$/
const USERNAME_RE = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/
const MAX_LABELS = 32
const MAX_TRANSFER_ROOMS = 500
const MAX_NAME = 50
const MAX_ROOM_NAME = 80
const MAX_BIO = 300
const MAX_LINK = 512
export const PEERCHAT_TRANSFER_VERSION = 1
// A transfer from another of the person's devices, left beside the phone's
// storage by a restore and taken once on PeerChat's next start.
export const PEERCHAT_INCOMING_FILE = 'peerchat-incoming.json'
// What a phone sends to PeerSky Desktop, in the same form.
export const PHONE_PEERCHAT_FILE = 'phone-peerchat.json'

function clamp (value, max) {
  return (typeof value === 'string' ? value : '').slice(0, max)
}

function sha256 (text) {
  return createHash('sha256').update(text).digest('hex')
}

export function normalizeLabel (value) {
  const label = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return LABEL_RE.test(label) ? label : ''
}

export function normalizeUsername (value) {
  if (typeof value !== 'string') return ''
  const name = value.trim().replace(/\s+/g, ' ')
  return name.length <= MAX_NAME && USERNAME_RE.test(name) ? name : ''
}

// What everyone sees. The device the name was made on has no label. Names are
// kept to 50 characters everywhere, so a long one gives way to the label.
export function displayName (username, label) {
  const name = typeof username === 'string' ? username : ''
  const suffix = normalizeLabel(label)
  if (!name || !suffix) return name
  return `${name.slice(0, MAX_NAME - suffix.length - 1).trimEnd()}@${suffix}`
}

// Someone else's name as they send it: a name, or a name and a label.
export function normalizeMemberName (value) {
  if (typeof value !== 'string') return ''
  const text = value.trim().replace(/\s+/g, ' ')
  if (!text || text.length > MAX_NAME) return ''
  const at = text.lastIndexOf('@')
  if (at === -1) return USERNAME_RE.test(text) ? text : ''
  const name = text.slice(0, at)
  const label = text.slice(at + 1)
  return USERNAME_RE.test(name) && LABEL_RE.test(label) ? text : ''
}

export function createLink (origin) {
  return { key: b4a.toString(randomBytes(32), 'hex'), origin: origin === 'mobile' ? 'mobile' : 'desktop', labels: [] }
}

export function mergeLabels (...lists) {
  const labels = new Set()
  for (const list of lists) {
    for (const value of Array.isArray(list) ? list : []) {
      const label = normalizeLabel(value)
      if (label) labels.add(label)
    }
  }
  return [...labels].sort().slice(0, MAX_LABELS)
}

export function normalizeLink (raw) {
  if (!raw || typeof raw !== 'object') return null
  const key = typeof raw.key === 'string' ? raw.key.toLowerCase() : ''
  if (!KEY_RE.test(key)) return null
  return { key, origin: raw.origin === 'mobile' ? 'mobile' : 'desktop', labels: mergeLabels(raw.labels) }
}

// Public: two members with the same link id are one person.
export function linkId (link) {
  return link?.key ? sha256(`peerchat-device-link\n${link.key}`).slice(0, 32) : ''
}

// The label a new device gets. There is one phone; desktops are numbered, and
// the device the name was made on counts as the first desktop when it is one.
export function nextLabel (link, targetType) {
  if (targetType === 'mobile') return 'mobile'
  let highest = 0
  for (const label of mergeLabels(link?.labels)) {
    if (!label.startsWith('desktop')) continue
    const number = label === 'desktop' ? 1 : Number(label.slice('desktop'.length))
    if (number > highest) highest = number
  }
  if (highest === 0 && link?.origin === 'mobile') return 'desktop'
  return `desktop${highest + 1}`
}

// The network key the connection was made with: 32 bytes, as hex.
export function normalizeDeviceKey (value) {
  const key = typeof value === 'string' ? value.toLowerCase() : ''
  return KEY_RE.test(key) ? key : ''
}

function proofFields (id, name, bio, avatar, at, labels, device) {
  return JSON.stringify([id, name, bio, avatar ? sha256(avatar) : '', at, labels, device])
}

function mac (key, fields) {
  return createHmac('sha256', b4a.from(key, 'hex')).update(fields).digest('hex')
}

function sameHex (a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Sent with every profile. Covers the name without its label, the bio, the
// picture and when they were set, so a sibling can take all four, and the
// network key of the device sending it, so nobody can pass it on as theirs.
export function makeProfileProof (link, profile, deviceKey) {
  if (!link?.key) return null
  const device = normalizeDeviceKey(deviceKey)
  if (!device) return null
  const id = linkId(link)
  const name = normalizeUsername(profile?.username)
  if (!name) return null
  const bio = clamp(profile?.bio, MAX_BIO)
  const at = Number.isSafeInteger(profile?.at) && profile.at > 0 ? profile.at : 0
  const labels = mergeLabels(link.labels)
  return { id, name, bio, at, labels, mac: mac(link.key, proofFields(id, name, bio, profile?.avatar || null, at, labels, device)) }
}

// True only for a proof made with this link, for this picture, by the device
// whose network key the connection was made with.
export function checkProfileProof (link, proof, avatar, deviceKey) {
  if (!link?.key || !proof || typeof proof !== 'object') return false
  const device = normalizeDeviceKey(deviceKey)
  if (!device) return false
  const id = linkId(link)
  if (proof.id !== id) return false
  const name = normalizeUsername(proof.name)
  if (!name || name !== proof.name) return false
  if (typeof proof.bio !== 'string' || proof.bio.length > MAX_BIO) return false
  if (!Number.isSafeInteger(proof.at) || proof.at < 0) return false
  const labels = mergeLabels(proof.labels)
  if (!Array.isArray(proof.labels) || labels.length !== proof.labels.length) return false
  return sameHex(proof.mac, mac(link.key, proofFields(id, name, proof.bio, avatar || null, proof.at, labels, device)))
}

function normalizeTransferRoom (raw) {
  if (!raw || typeof raw !== 'object') return null
  const roomKey = typeof raw.roomKey === 'string' ? raw.roomKey.toLowerCase() : ''
  if (!ROOM_KEY_RE.test(roomKey)) return null
  const isDM = raw.isDM === true
  const dmWith = typeof raw.dmWith === 'string' ? raw.dmWith.toLowerCase() : ''
  if (isDM && !PEER_ID_RE.test(dmWith)) return null
  const creatorKey = typeof raw.creatorKey === 'string' ? raw.creatorKey.toLowerCase() : ''
  const createdBy = typeof raw.createdBy === 'string' ? raw.createdBy.toLowerCase() : ''
  return {
    roomKey,
    name: clamp(raw.name, MAX_ROOM_NAME),
    bio: clamp(raw.bio, MAX_BIO),
    link: clamp(raw.link, MAX_LINK),
    isDM,
    dmWith: isDM ? dmWith : '',
    createdAt: Number.isSafeInteger(raw.createdAt) && raw.createdAt > 0 ? raw.createdAt : 0,
    // When the person joined. The other device joins as of then, so the
    // room's history since then comes to it too.
    joinedAt: Number.isSafeInteger(raw.joinedAt) && raw.joinedAt > 0 ? raw.joinedAt : 0,
    createdBy: PEER_ID_RE.test(createdBy) ? createdBy : '',
    createdByName: clamp(raw.createdByName, MAX_NAME + 20),
    creatorKey: KEY_RE.test(creatorKey) ? creatorKey : '',
    // A room whose keys rotate: from the earliest hour this device holds, so
    // the other device reads the same history. See key-chain.mjs.
    ...(normalizeKeyChain(raw.chain) && { chain: normalizeKeyChain(raw.chain) })
  }
}

// What goes to another of the person's devices: the link, the label that
// device takes, the profile, and the rooms to join. Room keys are secret; the
// transfer carrying this is sealed to the other device.
export function makeTransfer ({ link, label, profile, rooms }, options) {
  return normalizeTransfer({
    version: PEERCHAT_TRANSFER_VERSION,
    label,
    link,
    profile,
    rooms
  }, options)
}

// Rooms one of the person's devices offers another: the same entries a
// transfer carries, checked the same way.
export function normalizeSharedRooms (list) {
  const rooms = []
  const seen = new Set()
  for (const room of Array.isArray(list) ? list : []) {
    const entry = normalizeTransferRoom(room)
    if (!entry || seen.has(entry.roomKey)) continue
    seen.add(entry.roomKey)
    rooms.push(entry)
    if (rooms.length === MAX_TRANSFER_ROOMS) break
  }
  return rooms
}

export function normalizeTransfer (raw, { maxAvatar = 1_400_000 } = {}) {
  if (!raw || typeof raw !== 'object' || raw.version !== PEERCHAT_TRANSFER_VERSION) return null
  const link = normalizeLink(raw.link)
  const label = normalizeLabel(raw.label)
  if (!link || !label) return null
  const username = normalizeUsername(raw.profile?.username)
  const avatar = typeof raw.profile?.avatar === 'string' && raw.profile.avatar.length <= maxAvatar &&
    raw.profile.avatar.startsWith('data:image/')
    ? raw.profile.avatar
    : null
  const at = Number.isSafeInteger(raw.profile?.at) && raw.profile.at > 0 ? raw.profile.at : 0
  const rooms = normalizeSharedRooms(raw.rooms)
  return {
    version: PEERCHAT_TRANSFER_VERSION,
    label,
    link,
    profile: username ? { username, bio: clamp(raw.profile?.bio, MAX_BIO), avatar, at } : null,
    rooms
  }
}
