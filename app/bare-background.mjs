// iOS gives an app that leaves the screen about 30 seconds to finish what it
// asked to finish, and kills it if it has not let go by then.
// react-native-bare-kit 0.13.3 asks each time it suspends Bare and lets go
// only when Bare goes idle or resumes. The backend always has sockets open,
// so it never goes idle, and the library's own timeout lets go of nothing
// (fixed upstream in holepunchto/bare-kit cf42748, not in a release yet). So
// iOS killed the app half a minute after it left the screen, and every reopen
// was a fresh start: the logo, then each tab loading again, a PDF back on its
// first page. Resuming Bare before the time is up lets go, and iOS then
// suspends the app the usual way, with everything left as it was.
export const BARE_BACKGROUND_GRACE_MS = 15000

export function resumeBareInBackground (worklet, appState, {
  grace = BARE_BACKGROUND_GRACE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  let timer = null
  const cancel = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }
  const resumeLater = () => {
    timer = setTimer(() => {
      timer = null
      if (worklet.suspended && !worklet.terminated) worklet.resume()
    }, grace)
  }

  const subscription = appState.addEventListener('change', (state) => {
    cancel()
    if (state === 'background') resumeLater()
  })
  // Started behind another app, Bare starts suspended.
  if (appState.currentState === 'background') resumeLater()

  return () => {
    cancel()
    subscription.remove()
  }
}
