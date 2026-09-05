export const PEERCHAT_UI_STATE_MAX_BYTES = 300 * 1024
export const PEERCHAT_DRAFT_MAX_CHARACTERS = 64 * 1024

const EMPTY_STATE = Object.freeze({
  activeRoomKey: null,
  draftRoomKey: null,
  draft: ''
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
      draft: draftRoomKey ? draft : ''
    }
  } catch {
    return { ...EMPTY_STATE }
  }
}

export function serializePeerChatUiState ({ activeRoomKey, draftRoomKey, draft }) {
  const normalizedDraft = normalizeDraft(draft)
  const normalizedDraftRoomKey = normalizeRoomKey(draftRoomKey)
  return JSON.stringify({
    version: 1,
    activeRoomKey: normalizeRoomKey(activeRoomKey),
    draftRoomKey: normalizedDraft ? normalizedDraftRoomKey : null,
    draft: normalizedDraftRoomKey ? normalizedDraft : ''
  })
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
