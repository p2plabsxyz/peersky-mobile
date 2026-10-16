// Quick actions on the app icon (plugins/with-home-shortcuts.js) and taps on
// the home screen widgets (targets/widgets). Each arrives as a
// peersky://shortcut/ link, which the app follows like any other link it is
// opened with.
export const HOME_SHORTCUTS = Object.freeze(['paste', 'new-tab', 'incognito', 'app-icon'])

// "search" puts the cursor in the address bar. "open" carries an address in
// its url parameter: an app from the widget's row, a bookmark, PeerTunes.
const WIDGET_SHORTCUTS = Object.freeze(['search', 'open'])

const MAX_TARGET_LENGTH = 4096
const OPENABLE_TARGET = /^(https?|hyper|peersky):\/\//i

/**
 * The action a peersky://shortcut/ link stands for, as { name, target }, or
 * null for any other link. Only "open" has a target.
 */
export function parseHomeShortcut (url) {
  const match = /^peersky:\/\/shortcut\/([a-z-]+)\/?(?:\?([^#]*))?$/i.exec(String(url || '').trim())
  if (!match) return null
  const name = match[1].toLowerCase()
  const query = match[2]

  if (name !== 'open') {
    if (query !== undefined) return null
    return HOME_SHORTCUTS.includes(name) || WIDGET_SHORTCUTS.includes(name) ? { name } : null
  }

  const target = readQueryValue(query, 'url')
  if (
    !target ||
    target.length > MAX_TARGET_LENGTH ||
    !OPENABLE_TARGET.test(target) ||
    /^peersky:\/\/shortcut\//i.test(target)
  ) {
    return null
  }
  return { name, target }
}

const PEERTUNES_APP_URL = /^peersky:\/\/p2p\/peertunes\/?$/i
const WIDGET_SONG_ID = /^[A-Za-z0-9]{0,64}$/

/**
 * A tap on the PeerTunes widget while it shows a song, as { song }: PeerTunes
 * opens Now Playing with that song. Null for any other link, the widget with
 * nothing on it included. The song comes in a parameter of its own, beside
 * the address, so the PeerTunes tab keeps its plain address and a restart
 * does not ask for that song again.
 */
export function parsePeerTunesWidgetTap (url) {
  const shortcut = parseHomeShortcut(url)
  if (shortcut?.name !== 'open' || !PEERTUNES_APP_URL.test(shortcut.target)) return null
  const query = /\?([^#]*)$/.exec(String(url).trim())
  const song = readQueryValue(query ? query[1] : '', 'song')
  if (song === null || !WIDGET_SONG_ID.test(song)) return null
  return { song }
}

// URLSearchParams in React Native does not read a query string, so this does
// it by hand.
function readQueryValue (query, key) {
  for (const pair of String(query || '').split('&')) {
    const separator = pair.indexOf('=')
    if (separator < 0 || pair.slice(0, separator) !== key) continue
    try {
      return decodeURIComponent(pair.slice(separator + 1)).trim()
    } catch {
      return null
    }
  }
  return null
}
