export const PEERCHAT_UI_STATE_MAX_BYTES = 300 * 1024
export const PEERCHAT_DRAFT_MAX_CHARACTERS = 64 * 1024
// Same depth as desktop, so a phone and a laptop remember about as much.
export const PEERCHAT_RECENT_EMOJI_MAX = 24

const EMPTY_STATE = Object.freeze({
  activeRoomKey: null,
  draftRoomKey: null,
  draft: '',
  recentEmojis: []
})

export function parsePeerChatUiState (serialized) {
  if (typeof serialized !== 'string' || serialized.length > PEERCHAT_UI_STATE_MAX_BYTES) {
    return { ...EMPTY_STATE }
  }

  try {
    const stored = JSON.parse(serialized)
    if (stored?.version !== 1) return { ...EMPTY_STATE }

    const activeRoomKey = normalizeRoomKey(stored.activeRoomKey)
    const draftRoomKey = normalizeRoomKey(stored.draftRoomKey)
    const draft = normalizeDraft(stored.draft)
    return {
      activeRoomKey,
      draftRoomKey: draft ? draftRoomKey : null,
      draft: draftRoomKey ? draft : '',
      recentEmojis: normalizeRecentEmojis(stored.recentEmojis)
    }
  } catch {
    return { ...EMPTY_STATE }
  }
}

export function serializePeerChatUiState ({ activeRoomKey, draftRoomKey, draft, recentEmojis }) {
  const normalizedDraft = normalizeDraft(draft)
  const normalizedDraftRoomKey = normalizeRoomKey(draftRoomKey)
  return JSON.stringify({
    version: 1,
    activeRoomKey: normalizeRoomKey(activeRoomKey),
    draftRoomKey: normalizedDraft ? normalizedDraftRoomKey : null,
    draft: normalizedDraftRoomKey ? normalizedDraft : '',
    recentEmojis: normalizeRecentEmojis(recentEmojis)
  })
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
