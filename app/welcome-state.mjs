/**
 * Whether the welcome screen has been seen.
 *
 * A marker file rather than a version number: the screen is about what PeerSky
 * is, which does not change with a release, so showing it again after an update
 * would be an interruption rather than news. Its absence is the only thing that
 * means "first run", and clearing app data legitimately brings it back.
 */
export const WELCOME_FILE_NAME = 'welcome-seen'

// A P2P app with a welcome of its own greets once, the first time it opens.
// Like the browser's, the markers stay on the phone they were made on.
export const APP_WELCOME_FILE_NAMES = Object.freeze({
  p2pmd: 'p2pmd-welcome-seen'
})

export function hasSeenWelcome (file) {
  try {
    return file.exists === true
  } catch {
    // Unreadable storage is not evidence of a first run, and a welcome screen
    // on every launch would be worse than never showing one.
    return true
  }
}

export function markWelcomeSeen (file) {
  try {
    file.create({ overwrite: true })
    return true
  } catch {
    return false
  }
}
