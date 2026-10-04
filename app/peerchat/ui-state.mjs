export const PEERCHAT_UI_STATE_MAX_BYTES = 300 * 1024
export const PEERCHAT_DRAFT_MAX_CHARACTERS = 64 * 1024
// One unsent message per chat. There used to be one for the whole app, so
// opening another chat threw away what you had typed in the last one.
export const PEERCHAT_MAX_DRAFTS = 30
// Same depth as desktop, so a phone and a laptop remember about as much.
export const PEERCHAT_RECENT_EMOJI_MAX = 24

const EMPTY_STATE = Object.freeze({
  activeRoomKey: null,
  drafts: Object.freeze({}),
  recentEmojis: []
})

export function parsePeerChatUiState (serialized) {
  if (typeof serialized !== 'string' || serialized.length > PEERCHAT_UI_STATE_MAX_BYTES) {
    return { ...EMPTY_STATE, drafts: {} }
  }

  try {
    const stored = JSON.parse(serialized)
    // Version 1 kept a single draft for a single room.
    const drafts = stored?.version === 2
      ? stored.drafts
      : stored?.version === 1 && typeof stored.draftRoomKey === 'string'
        ? { [stored.draftRoomKey]: stored.draft }
        : null
    if (!drafts) return { ...EMPTY_STATE, drafts: {} }

    return {
      activeRoomKey: normalizeRoomKey(stored.activeRoomKey),
      drafts: normalizeDrafts(drafts),
      recentEmojis: normalizeRecentEmojis(stored.recentEmojis)
    }
  } catch {
    return { ...EMPTY_STATE, drafts: {} }
  }
}

export function serializePeerChatUiState ({ activeRoomKey, drafts, recentEmojis }) {
  const state = {
    version: 2,
    activeRoomKey: normalizeRoomKey(activeRoomKey),
    drafts: normalizeDrafts(drafts),
    recentEmojis: normalizeRecentEmojis(recentEmojis)
  }
  // The newest come first, so when everything will not fit it is the oldest
  // drafts that are left out.
  let serialized = JSON.stringify(state)
  const keys = Object.keys(state.drafts)
  while (serialized.length > PEERCHAT_UI_STATE_MAX_BYTES && keys.length > 0) {
    delete state.drafts[keys.pop()]
    serialized = JSON.stringify(state)
  }
  return serialized
}

/**
 * The drafts with this room's text in it, newest first. Empty text removes the
 * room's draft.
 */
export function setPeerChatDraft (drafts, roomKey, text) {
  const key = normalizeRoomKey(roomKey)
  const rest = Object.entries(normalizeDrafts(drafts)).filter(([room]) => room !== key)
  const draft = normalizeDraft(text)
  if (!key) return Object.fromEntries(rest)
  return normalizeDrafts(Object.fromEntries(draft ? [[key, draft], ...rest] : rest))
}

function normalizeDrafts (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const drafts = {}
  for (const [roomKey, text] of Object.entries(value)) {
    const key = normalizeRoomKey(roomKey)
    const draft = normalizeDraft(text)
    if (!key || !draft || key in drafts) continue
    drafts[key] = draft
    if (Object.keys(drafts).length >= PEERCHAT_MAX_DRAFTS) break
  }
  return drafts
}

/** Most recently used first, no repeats, capped. */
export function recordRecentEmoji (recentEmojis, emoji) {
  const normalized = normalizeEmoji(emoji)
  if (!normalized) return normalizeRecentEmojis(recentEmojis)
  return [normalized, ...normalizeRecentEmojis(recentEmojis).filter((item) => item !== normalized)]
    .slice(0, PEERCHAT_RECENT_EMOJI_MAX)
}

function normalizeRecentEmojis (value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const emojis = []
  for (const item of value) {
    const normalized = normalizeEmoji(item)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    emojis.push(normalized)
    if (emojis.length >= PEERCHAT_RECENT_EMOJI_MAX) break
  }
  return emojis
}

// A single glyph, which a flag or a family can spend several code points on.
// Anything longer is not an emoji someone picked, so it is not stored.
function normalizeEmoji (value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 24 || /\s/.test(trimmed)) return ''
  return trimmed
}

function normalizeRoomKey (value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null
}

function normalizeDraft (value) {
  if (typeof value !== 'string') return ''
  return Array.from(value).slice(0, PEERCHAT_DRAFT_MAX_CHARACTERS).join('')
}
