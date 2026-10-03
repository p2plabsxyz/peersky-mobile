// The quick actions on the app icon (a long press on the home screen). Each
// arrives as a peersky://shortcut/ link, so it follows the same path as any
// other link the app is opened with. plugins/with-home-shortcuts.js lists them.
export const HOME_SHORTCUTS = Object.freeze(['paste', 'new-tab', 'incognito', 'app-icon'])

/** The quick action a link stands for, or null for any other link. */
export function parseHomeShortcutUrl (url) {
  const match = /^peersky:\/\/shortcut\/([a-z-]+)\/?$/i.exec(String(url || '').trim())
  const name = match?.[1]?.toLowerCase()
  return HOME_SHORTCUTS.includes(name) ? name : null
}
