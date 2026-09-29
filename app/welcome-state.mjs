/**
 * Whether the welcome screen has been seen.
 *
 * A marker file rather than a version number: the screen is about what PeerSky
 * is, which does not change with a release, so showing it again after an update
 * would be an interruption rather than news. Its absence is the only thing that
 * means "first run", and clearing app data legitimately brings it back.
 */
export const WELCOME_FILE_NAME = 'welcome-seen'

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
