import {
  PEERCHAT_ADULT_DOMAINS,
  PEERCHAT_BAD_WORDS
} from './moderation-data.mjs'

export const DEFAULT_PEERCHAT_MODERATION = Object.freeze({
  abuseFilter: true,
  nsfwFilter: true,
  spamRateLimit: 10
})

export const PEERCHAT_MODERATION_WINDOW_MS = 10_000
export const PEERCHAT_MODERATION_KICK_MS = 5 * 60_000
const TRACKER_IDLE_MS = 30 * 60_000
const MAX_TRACKED_PEER_ROOMS = 2000
const BAD_WORDS = new Set(PEERCHAT_BAD_WORDS)
const WORD_RE = /[a-z0-9']+/gi
const URL_RE = /(?:https?:\/\/|hyper:\/\/)?(?:www[.])?([a-z0-9-]+(?:[.][a-z0-9-]+)*[.][a-z]{2,})(?:[/?#][^\s]*)?/gi
const THREAT_PATTERNS = [
  /\bkys\b/i,
  /\bkill\s*your\s*self\b/i,
  /\bgo\s*die\b/i,
  /\bshoot\s*up\b/i,
  /\brape\s*(you|u|her|him|them)\b/i,
  /\bi('?ll|m\s*going\s*to)\s*(rape|murder|stalk)\b/i,
  /\bstfu\b/i
]

export function normalizePeerChatModeration (value) {
  const normalized = { ...DEFAULT_PEERCHAT_MODERATION }
  if (!value || typeof value !== 'object') return normalized
  if (value.abuseFilter === false) normalized.abuseFilter = false
  if (value.nsfwFilter === false) normalized.nsfwFilter = false
  if (Number.isFinite(value.spamRateLimit)) {
    normalized.spamRateLimit = Math.max(1, Math.min(50, Math.floor(value.spamRateLimit)))
  }
  return normalized
}

export function checkPeerChatContent (text, settings) {
  const value = typeof text === 'string' ? text : ''
  const moderation = normalizePeerChatModeration(settings)

  if (moderation.abuseFilter && THREAT_PATTERNS.some((pattern) => pattern.test(value))) {
    return { flagged: true, reason: 'abusive language' }
  }

  if (moderation.nsfwFilter) {
    const words = value.match(WORD_RE) || []
    if (words.some((word) => BAD_WORDS.has(word.toLowerCase()))) {
      return { flagged: true, reason: 'profanity or slurs' }
    }
  }

  URL_RE.lastIndex = 0
  let match
  while ((match = URL_RE.exec(value)) !== null) {
    const domain = match[1]?.toLowerCase()
    if (!domain) continue
    const labels = domain.split('.')
    for (let index = 0; index < labels.length - 1; index += 1) {
      const candidate = labels.slice(index).join('.')
      if (binaryIncludes(PEERCHAT_ADULT_DOMAINS, candidate)) {
        return { flagged: true, reason: `adult domain link (${candidate})` }
      }
    }
  }

  return { flagged: false, reason: '' }
}

export function createPeerChatModerator ({ maxTrackedPeerRooms = MAX_TRACKED_PEER_ROOMS } = {}) {
  const spam = new Map()
  const violations = new Map()
  const touchedAt = new Map()
  const kicks = new Map()
  let lastCleanupAt = 0

  function checkMessage (peerId, roomKey, text, {
    allowKick = true,
    checkSpam = true,
    now = Date.now(),
    settings
  } = {}) {
    cleanup(now)
    const key = trackerKey(peerId, roomKey)
    const kick = allowKick ? getKick(key, now) : null
    if (kick) return blocked('temporarily blocked from this room', 'kick', kick)

    if (checkSpam && isSpam(key, now, normalizePeerChatModeration(settings).spamRateLimit)) {
      return recordBlocked(key, 'spam (too many messages)', now, allowKick)
    }

    const content = checkPeerChatContent(text, settings)
    if (content.flagged) return recordBlocked(key, content.reason, now, allowKick)
    return { allowed: true, reason: '', action: 'none' }
  }

  function isKicked (peerId, roomKey, now = Date.now()) {
    cleanup(now)
    return Boolean(getKick(trackerKey(peerId, roomKey), now))
  }

  function clearRoom (roomKey) {
    const suffix = `:${roomKey}`
    for (const map of [spam, violations, touchedAt, kicks]) {
      for (const key of map.keys()) if (key.endsWith(suffix)) map.delete(key)
    }
  }

  function clear () {
    spam.clear()
    violations.clear()
    touchedAt.clear()
    kicks.clear()
  }

  function isSpam (key, now, limit) {
    let entries = spam.get(key)
    if (!entries) {
      entries = []
      spam.set(key, entries)
    }
    const cutoff = now - PEERCHAT_MODERATION_WINDOW_MS
    while (entries.length > 0 && entries[0] <= cutoff) entries.shift()
    entries.push(now)
    touchedAt.set(key, now)
    enforceBound()
    return entries.length >= limit
  }

  function recordBlocked (key, reason, now, allowKick) {
    const count = (violations.get(key) || 0) + 1
    violations.set(key, count)
    touchedAt.set(key, now)
    enforceBound()
    const action = count >= 3 && allowKick ? 'kick' : count >= 2 ? 'final-warn' : 'warn'
    if (action === 'kick') {
      kicks.set(key, now)
      return blocked(reason, action, getKick(key, now))
    }
    return blocked(reason, action)
  }

  function cleanup (now) {
    if (now - lastCleanupAt < PEERCHAT_MODERATION_WINDOW_MS) return
    lastCleanupAt = now
    for (const [key, entries] of spam) {
      while (entries.length > 0 && entries[0] <= now - PEERCHAT_MODERATION_WINDOW_MS) entries.shift()
      if (entries.length === 0) spam.delete(key)
    }
    for (const [key, touched] of touchedAt) {
      if (touched <= now - TRACKER_IDLE_MS) removeKey(key)
    }
    for (const [key, kickedAt] of kicks) {
      if (kickedAt <= now - PEERCHAT_MODERATION_KICK_MS) removeKey(key)
    }
  }

  function enforceBound () {
    while (touchedAt.size > maxTrackedPeerRooms) {
      removeKey(touchedAt.keys().next().value)
    }
  }

  function removeKey (key) {
    spam.delete(key)
    violations.delete(key)
    touchedAt.delete(key)
    kicks.delete(key)
  }

  function getKick (key, now) {
    const kickedAt = kicks.get(key)
    if (kickedAt == null) return null
    const blockedUntil = kickedAt + PEERCHAT_MODERATION_KICK_MS
    if (blockedUntil <= now) {
      removeKey(key)
      return null
    }
    return { blockedUntil, remainingMs: blockedUntil - now }
  }

  return { checkMessage, isKicked, clearRoom, clear }
}

function trackerKey (peerId, roomKey) {
  return `${String(peerId).slice(0, 200)}:${String(roomKey).slice(0, 64)}`
}

function blocked (reason, action, details = {}) {
  return { allowed: false, reason, action, ...details }
}

function binaryIncludes (values, target) {
  let low = 0
  let high = values.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const value = values[middle]
    if (value === target) return true
    if (value < target) low = middle + 1
    else high = middle - 1
  }
  return false
}
