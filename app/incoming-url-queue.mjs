/**
 * Holds deep links until the browser has actually acted on one.
 *
 * A link can arrive before the browser screen is mounted, on a cold start, or
 * while it is being replaced. A listener living inside the browser missed
 * those, which is why an invite opened from Notes once brought PeerSky forward
 * and then did nothing.
 *
 * Delivering is not the same as handling here. A link stays queued until the
 * browser says it loaded it, so one that arrives moments before the screen goes
 * away is replayed to the screen that replaces it.
 */

// Enough for a burst of taps. Beyond that the oldest is the one nobody is
// waiting on any more.
export const MAX_QUEUED_INCOMING_URLS = 4

export function createIncomingUrlQueue () {
  let queued = []
  let deliver = null

  return {
    /** A link arrived. Delivered now if anyone is listening, held if not. */
    push (url) {
      const value = typeof url === 'string' ? url.trim() : ''
      // Already waiting: a cold start reads the launch URL and hears the same
      // one as an event, and that should open one tab, not two.
      if (!value || queued.includes(value)) return
      queued = [...queued, value].slice(-MAX_QUEUED_INCOMING_URLS)
      if (deliver) deliver(value)
    },

    /** The browser dealt with this one, by loading it or by refusing it. */
    settle (url) {
      queued = queued.filter((item) => item !== url)
    },

    /** Replays everything still unhandled, then follows new arrivals. */
    subscribe (next) {
      deliver = next
      for (const url of queued) next(url)
      return () => {
        if (deliver === next) deliver = null
      }
    },

    get pending () {
      return [...queued]
    }
  }
}
