export function createPeerPresenceStore ({ now = Date.now } = {}) {
  const peers = new Map()
  let nextPeerId = 1

  function upsert (payload) {
    if (!payload || typeof payload !== 'object') return null

    const clientId = typeof payload.clientId === 'string' && payload.clientId.trim()
      ? payload.clientId.trim().slice(0, 120)
      : `anonymous-${nextPeerId++}`
    const previous = peers.get(clientId)
    const timestamp = now()
    const lineAttributions = normalizePeerLineAttributions(
      payload.peerLineAttributions ?? payload.lineAttributions ?? payload.lineAuthors
    )

    if (lineAttributions) {
      removeLineAttributionsFromOtherPeers(clientId, lineAttributions)
    }

    peers.set(clientId, {
      id: previous?.id || peers.size + 1,
      role: normalizePeerRole(payload.role),
      clientId,
      color: normalizePeerColor(payload.color) || previous?.color || '',
      name: normalizePeerName(payload.name) || previous?.name || `Peer ${clientId.slice(0, 6)}`,
      cursorLine: normalizeOptionalNumber(payload.cursorLine, previous?.cursorLine),
      cursorColumn: normalizeOptionalNumber(payload.cursorColumn, previous?.cursorColumn),
      selectionStart: normalizeOptionalNumber(payload.selectionStart, previous?.selectionStart),
      selectionEnd: normalizeOptionalNumber(payload.selectionEnd, previous?.selectionEnd),
      latexModeEnabled: typeof payload.latexModeEnabled === 'boolean' ? payload.latexModeEnabled : null,
      isTyping: typeof payload.isTyping === 'boolean' ? payload.isTyping : previous?.isTyping === true,
      lineAttributions: lineAttributions || previous?.lineAttributions || null,
      joinedAt: previous?.joinedAt || timestamp,
      updatedAt: timestamp
    })

    return clientId
  }

  function prune (peerKey, activePeerKeys) {
    if (!peerKey) return false
    if (activePeerKeys?.has(peerKey)) return false
    return peers.delete(peerKey)
  }

  function clear () {
    peers.clear()
    nextPeerId = 1
  }

  function getPeerList (activePeerKeys) {
    return Array.from(peers.entries())
      .filter(([peerKey]) => !activePeerKeys || activePeerKeys.has(peerKey))
      .map(([, peer]) => peer)
  }

  function getPeerCount (activePeerKeys) {
    let count = 0

    for (const peer of getPeerList(activePeerKeys)) {
      if (peer.role !== 'host') count += 1
    }

    return count
  }

  function removeLineAttributionsFromOtherPeers (clientId, lineAttributions) {
    const editedLines = new Set(Object.keys(lineAttributions))
    if (editedLines.size === 0) return

    for (const [peerKey, peer] of peers.entries()) {
      if (peerKey === clientId || !peer.lineAttributions) continue

      for (const line of editedLines) {
        delete peer.lineAttributions[line]
      }

      if (Object.keys(peer.lineAttributions).length === 0) {
        peer.lineAttributions = null
      }
    }
  }

  return {
    upsert,
    prune,
    clear,
    getPeerList,
    getPeerCount
  }
}

export function createPeerActivityStore ({ now = Date.now, maxItems = 200 } = {}) {
  const capacity = Number.isInteger(maxItems) && maxItems > 0 ? maxItems : 200
  const activity = []
  let sequence = 0

  function add (entry = {}) {
    sequence += 1
    const role = normalizePeerRole(entry.role)
    const name = normalizePeerName(entry.name) || 'Peer'
    const cursorLine = normalizeOptionalNumber(entry.cursorLine)
    const cursorColumn = normalizeOptionalNumber(entry.cursorColumn)
    const position = cursorLine && cursorColumn
      ? ` (line ${cursorLine}, col ${cursorColumn})`
      : cursorLine
        ? ` (line ${cursorLine})`
        : ''
    const type = entry.type === 'join' || entry.type === 'leave' || entry.type === 'edit'
      ? entry.type
      : 'event'
    const message = type === 'join'
      ? `${name} joined as ${role}`
      : type === 'leave'
        ? `${name} left the room`
        : type === 'edit'
          ? `${name} edited the document${position}`
          : `${name} updated their activity`
    const item = {
      id: sequence,
      type,
      role,
      name,
      clientId: normalizeClientId(entry.clientId),
      message,
      timestamp: now()
    }

    activity.unshift(item)
    if (activity.length > capacity) activity.length = capacity
    return item
  }

  function getActivity (limit = capacity) {
    const safeLimit = Number.isInteger(limit) && limit > 0
      ? Math.min(limit, capacity)
      : capacity
    return activity.slice(0, safeLimit)
  }

  function clear () {
    activity.length = 0
    sequence = 0
  }

  return {
    add,
    getActivity,
    clear
  }
}

function normalizePeerRole (role) {
  if (role === 'host') return 'host'
  if (role === 'client') return 'client'
  return 'viewer'
}

function normalizePeerName (name) {
  if (typeof name !== 'string') return ''
  return name.trim().slice(0, 80)
}

function normalizeClientId (clientId) {
  if (typeof clientId !== 'string') return null
  const value = clientId.trim()
  return value ? value.slice(0, 120) : null
}

function normalizePeerColor (color) {
  if (typeof color !== 'string') return ''
  const value = color.trim()
  if (!value || value.length > 64) return ''
  return value
}

function normalizeOptionalNumber (value, fallback = null) {
  if (value === undefined) return fallback ?? null
  if (value === null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizePeerLineAttributions (lineAttributions) {
  if (!lineAttributions || typeof lineAttributions !== 'object') return null

  const normalized = {}

  for (const [line, attribution] of Object.entries(lineAttributions)) {
    const lineNumber = Number(line)
    if (!Number.isInteger(lineNumber) || lineNumber < 1) continue
    if (!attribution || typeof attribution !== 'object') continue

    const color = normalizePeerColor(attribution.color)
    if (!color) continue

    normalized[String(lineNumber)] = {
      color,
      name: normalizePeerName(attribution.name)
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null
}
