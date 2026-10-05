// Pull down at the top of a page to reload it, as every other browser does.
//
// iOS has it in the WebView itself (pullToRefreshEnabled, a UIRefreshControl).
// Android's WebView has none, so the page reports the pull and the app draws
// the spinner. Only a pull the page would not use itself counts: nothing under
// the finger can still scroll up, the page has not turned overscroll off (a
// map or a game does), and it is not zoomed in.

export const PULL_REFRESH_MESSAGE_TYPE = 'peersky-pull-refresh'
// How far the finger travels, in points, before letting go reloads.
export const PULL_REFRESH_TRIGGER = 80
// How far the spinner follows the finger before it stops coming down.
export const PULL_REFRESH_MAX = 130

const PHASES = new Set(['move', 'end', 'cancel'])

/**
 * The script that watches for the pull, on Android pages only. The token is the
 * tab's own, so a message from the page can be told from one any page could
 * send.
 *
 * @param {string} token
 */
export function createPullRefreshScript (token) {
  return `(() => {
    if (window.__peerskyPullRefresh) return
    window.__peerskyPullRefresh = true
    const TYPE = ${JSON.stringify(PULL_REFRESH_MESSAGE_TYPE)}
    const TOKEN = ${JSON.stringify(String(token || ''))}
    const post = (phase, distance) => {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: TYPE, token: TOKEN, phase, distance }))
      } catch {}
    }
    const root = () => document.scrollingElement || document.documentElement
    // The page, or any box the finger is in, that could still scroll up.
    const canScrollUp = (node) => {
      for (let element = node; element && element.nodeType === 1; element = element.parentElement) {
        if (element === document.body || element === document.documentElement) break
        if (element.scrollTop > 0) return true
      }
      return root().scrollTop > 0 || window.scrollY > 0
    }
    const optedOut = () => {
      const pick = (element) => element ? getComputedStyle(element).overscrollBehaviorY || '' : ''
      return /none|contain/.test(pick(document.documentElement) + ' ' + pick(document.body))
    }
    let startX = 0
    let startY = null
    let pulling = false
    let distance = 0
    const reset = () => { startY = null; pulling = false; distance = 0 }
    addEventListener('touchstart', (event) => {
      reset()
      if (event.touches.length !== 1 || canScrollUp(event.target) || optedOut()) return
      if (window.visualViewport && window.visualViewport.scale > 1.01) return
      startX = event.touches[0].clientX
      startY = event.touches[0].clientY
    }, { capture: true, passive: true })
    addEventListener('touchmove', (event) => {
      if (startY === null) return
      if (event.touches.length !== 1 || event.defaultPrevented) {
        if (pulling) post('cancel', 0)
        reset()
        return
      }
      const down = event.touches[0].clientY - startY
      const across = event.touches[0].clientX - startX
      if (!pulling) {
        if (down < 8) {
          if (down < -4 || Math.abs(across) > 12) reset()
          return
        }
        if (Math.abs(across) > down || canScrollUp(event.target)) { reset(); return }
        pulling = true
      }
      // In CSS pixels, which a zoomed-out desktop page shrinks, so the app is
      // told how many screen pixels that is.
      const next = Math.round(Math.max(0, down) * (window.devicePixelRatio || 1))
      if (Math.abs(next - distance) < 3) return
      distance = next
      post('move', distance)
    }, { passive: true })
    addEventListener('touchend', () => {
      if (pulling) post('end', distance)
      reset()
    }, { passive: true })
    addEventListener('touchcancel', () => {
      if (pulling) post('cancel', 0)
      reset()
    }, { passive: true })
  })(); true;`
}

/**
 * A pull reported by the page, in points, or null for anything else.
 *
 * @param {unknown} message
 * @param {string} token
 * @param {number} pixelRatio the screen's pixels per point
 */
export function parsePullRefreshMessage (message, token, pixelRatio = 1) {
  if (typeof message !== 'string' || message.length > 300 || !token) return null
  try {
    const parsed = JSON.parse(message)
    if (parsed?.type !== PULL_REFRESH_MESSAGE_TYPE || parsed.token !== token || !PHASES.has(parsed.phase)) return null
    const pixels = Number(parsed.distance)
    const ratio = Number(pixelRatio) > 0 ? Number(pixelRatio) : 1
    const distance = Number.isFinite(pixels) && pixels > 0 ? Math.min(pixels / ratio, 2000) : 0
    return { phase: parsed.phase, distance }
  } catch {
    return null
  }
}

/** Where the spinner sits for a finger that has pulled this far: it slows, then stops. */
export function pullRefreshOffset (distance) {
  const pulled = Math.max(0, Number(distance) || 0)
  return Math.min(PULL_REFRESH_MAX, pulled * 0.6)
}

/** Whether letting go here reloads the page. */
export function shouldReloadOnRelease (distance) {
  return (Number(distance) || 0) >= PULL_REFRESH_TRIGGER
}
