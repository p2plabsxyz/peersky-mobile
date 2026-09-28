/**
 * Who counts as being in a room, a moment after their connection goes.
 *
 * Hyperswarm drops and redials as a matter of course, and a phone waking, a
 * network changing or a laptop opening its lid all do it too. Counting only
 * live connections meant the peer count and the online dots flickered every
 * time, which in a room with a few hundred people is constant noise.
 *
 * A peer whose connection ends is held for a short while. Redial inside that
 * window and nothing on screen moved; stay away and they drop off as usual.
 */
export const PEER_PRESENCE_GRACE_MS = 15000

export function createPeerPresence ({ graceMs = PEER_PRESENCE_GRACE_MS } = {}) {
  // roomKey -> Map(peerId -> when they stop counting)
  const lingering = new Map()

  function forRoom (roomKey) {
    let room = lingering.get(roomKey)
    if (!room) {
      room = new Map()
      lingering.set(roomKey, room)
    }
    return room
  }

  return {
    /** Their connection is up, so there is nothing to hold. */
    markPresent (roomKey, peerId) {
      if (!roomKey || !peerId) return
      const room = lingering.get(roomKey)
      if (!room) return
      room.delete(peerId)
      if (room.size === 0) lingering.delete(roomKey)
    },

    /** Their connection ended. Hold them until the grace runs out. */
    markAbsent (roomKey, peerId, now = Date.now()) {
      if (!roomKey || !peerId) return
      forRoom(roomKey).set(peerId, now + graceMs)
    },

    /** Everyone in the room: live connections plus whoever is still held. */
    presentIds (roomKey, liveIds = [], now = Date.now()) {
      const ids = new Set(liveIds)
      for (const [peerId, expiresAt] of lingering.get(roomKey) || []) {
        if (expiresAt > now) ids.add(peerId)
      }
      return ids
    },

    isPresent (roomKey, peerId, now = Date.now()) {
      const expiresAt = lingering.get(roomKey)?.get(peerId)
      return expiresAt !== undefined && expiresAt > now
    },

    /**
     * When the next held peer stops counting, so a caller can refresh then.
     * Nothing else changes at that moment, so without it the count would sit
     * stale until the next unrelated event.
     */
    nextExpiryAt (now = Date.now()) {
      let earliest = null
      for (const room of lingering.values()) {
        for (const expiresAt of room.values()) {
          if (expiresAt <= now) return now
          if (earliest === null || expiresAt < earliest) earliest = expiresAt
        }
      }
      return earliest
    },

    /** @returns {boolean} whether anyone actually dropped off. */
    prune (now = Date.now()) {
      let changed = false
      for (const [roomKey, room] of lingering) {
        for (const [peerId, expiresAt] of room) {
          if (expiresAt > now) continue
          room.delete(peerId)
          changed = true
        }
        if (room.size === 0) lingering.delete(roomKey)
      }
      return changed
    },

    /** Leaving a room ends the question of who is in it. */
    forgetRoom (roomKey) {
      lingering.delete(roomKey)
    },

    clear () {
      lingering.clear()
    }
  }
}
