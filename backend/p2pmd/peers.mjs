import { newerLineAuthor } from './line-authors.mjs'

export function createPeerPresenceStore ({ now = Date.now } = {}) {
  const peers = new Map()
  let nextPeerId = 1
  // How far each person's line authors have changed, and how far the last
  // list sent to everyone went. An editor sends all of its lines every time,
  // so only a real change goes out again.
  const attributionVersions = new Map()

  function markAttributionsChanged (peerKey) {
    const entry = attributionVersions.get(peerKey) || { version: 0, sent: 0 }
    entry.version += 1
    attributionVersions.set(peerKey, entry)
  }

  function upsert (payload) {
    if (!payload || typeof payload !== 'object') return null

    const clientId = typeof payload.clientId === 'string' && payload.clientId.trim()
      ? payload.clientId.trim().slice(0, 120)
      : `anonymous-${nextPeerId++}`
    const previous = peers.get(clientId)
    const timestamp = now()
    // An editor sends all of its own lines, so an empty list means it has
    // none now, and nothing sent means nothing changed.
    const sent = payload.peerLineAttributions ?? payload.lineAttributions ?? payload.lineAuthors
    const lineAttributions = sent && typeof sent === 'object'
      ? normalizePeerLineAttributions(sent) || {}
      : null

    if (lineAttributions) {
      // A line that stays with the same person keeps the time it became
      // theirs, which is all a rival claim is weighed against, so typing in it
      // does not send their lines out again on every key.
      for (const [line, attribution] of Object.entries(lineAttributions)) {
        const current = previous?.lineAttributions?.[line]
        if (current && current.name === attribution.name && current.color === attribution.color &&
          current.clientId === attribution.clientId && Number(current.updatedAt) > 0) {
          lineAttributions[line] = current
        }
      }
      settleLineOwners(clientId, lineAttributions)
    }

    const nextLineAttributions = lineAttributions || previous?.lineAttributions || null
    if (!previous || JSON.stringify(nextLineAttributions) !== JSON.stringify(previous.lineAttributions || null)) {
      markAttributionsChanged(clientId)
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
      lineAttributions: nextLineAttributions,
      joinedAt: previous?.joinedAt || timestamp,
      updatedAt: timestamp
    })

    return clientId
  }

  function prune (peerKey, activePeerKeys) {
    if (!peerKey) return false
    if (activePeerKeys?.has(peerKey)) return false
    attributionVersions.delete(peerKey)
    return peers.delete(peerKey)
  }

  function clear () {
    peers.clear()
    attributionVersions.clear()
    nextPeerId = 1
  }

  function getPeerList (activePeerKeys) {
    return Array.from(peers.entries())
      .filter(([peerKey]) => !activePeerKeys || activePeerKeys.has(peerKey))
      .map(([, peer]) => peer)
  }

  // The list as it goes out to everyone: each person's line authors only when
  // they changed since the last one. Editors merge a list into what they
  // have, so a list without someone's authors takes nothing away. Whoever
  // connects is sent getPeerList, with everyone's.
  function takePeerListUpdate (activePeerKeys) {
    return getPeerList(activePeerKeys).map((peer) => {
      const entry = attributionVersions.get(peer.clientId)
      const unsent = !entry || entry.version !== entry.sent
      if (entry) entry.sent = entry.version
      return unsent ? peer : { ...peer, lineAttributions: null }
    })
  }

  function getPeerCount (activePeerKeys) {
    let count = 0

    for (const peer of getPeerList(activePeerKeys)) {
      if (peer.role !== 'host') count += 1
    }

    return count
  }

  // One person to a line: the one whose edit of it is newest. A claim older
  // than someone else's stays out, so an editor still sending a line it lost
  // does not take it back.
  function settleLineOwners (clientId, lineAttributions) {
    for (const [peerKey, peer] of peers.entries()) {
      if (peerKey === clientId || !peer.lineAttributions) continue

      let removed = false
      for (const line of Object.keys(lineAttributions)) {
        const theirs = peer.lineAttributions[line]
        if (!theirs) continue
        const claim = { ...lineAttributions[line], clientId: lineAttributions[line].clientId || clientId }
        if (newerLineAuthor({ ...theirs, clientId: theirs.clientId || peerKey }, claim) === claim) {
          delete peer.lineAttributions[line]
          removed = true
        } else {
          delete lineAttributions[line]
        }
      }
      if (removed) markAttributionsChanged(peerKey)
    }
  }

  return {
    upsert,
    prune,
    clear,
    getPeerList,
    takePeerListUpdate,
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

    const normalizedAttribution = {
      color,
      name: normalizePeerName(attribution.name)
    }
    const clientId = typeof attribution.clientId === 'string'
      ? attribution.clientId.trim().slice(0, 120)
      : ''
    const updatedAt = Number(attribution.updatedAt)
    if (clientId) normalizedAttribution.clientId = clientId
    if (Number.isFinite(updatedAt) && updatedAt >= 0) normalizedAttribution.updatedAt = updatedAt
    normalized[String(lineNumber)] = normalizedAttribution
  }

  return Object.keys(normalized).length > 0 ? normalized : null
}
