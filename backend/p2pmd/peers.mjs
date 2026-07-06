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
      cursorLine: normalizeOptionalNumber(payload.cursorLine),
      cursorColumn: normalizeOptionalNumber(payload.cursorColumn),
      selectionStart: normalizeOptionalNumber(payload.selectionStart),
      selectionEnd: normalizeOptionalNumber(payload.selectionEnd),
      latexModeEnabled: typeof payload.latexModeEnabled === 'boolean' ? payload.latexModeEnabled : null,
      isTyping: payload.isTyping === true,
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

function normalizePeerRole (role) {
  if (role === 'host') return 'host'
  if (role === 'client') return 'client'
  return 'viewer'
}

function normalizePeerName (name) {
  if (typeof name !== 'string') return ''
  return name.trim().slice(0, 80)
}

function normalizePeerColor (color) {
  if (typeof color !== 'string') return ''
  const value = color.trim()
  if (!value || value.length > 64) return ''
  return value
}

function normalizeOptionalNumber (value) {
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
