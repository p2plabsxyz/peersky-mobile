// The button in the middle of the bar at the bottom. The burn button unless
// you choose another in Settings > Appearance > Toolbar button, the way
// DuckDuckGo lets you swap its Fire Button.

import { msg } from './i18n/i18n.mjs'

export const DEFAULT_TOOLBAR_BUTTON = 'burn'

// In the order the settings list shows them.
export const TOOLBAR_BUTTONS = Object.freeze([
  { id: 'bookmark', title: msg('Add Bookmark') },
  { id: 'favourite', title: msg('Add Favourite') },
  { id: 'bookmarks', title: msg('Bookmarks') },
  { id: 'burn', title: msg('Burn Tabs and Data') },
  { id: 'downloads', title: msg('Downloads') },
  { id: 'history', title: msg('History') },
  { id: 'home', title: msg('Home') },
  { id: 'incognito', title: msg('New Incognito Tab') },
  { id: 'new-tab', title: msg('New Tab') },
  { id: 'settings', title: msg('Settings') },
  { id: 'share', title: msg('Share') },
  { id: 'zoom', title: msg('Zoom') }
])

export function normalizeToolbarButton (value) {
  return TOOLBAR_BUTTONS.some((button) => button.id === value) ? value : DEFAULT_TOOLBAR_BUTTON
}

/**
 * Whether the burn button needs a place in the menu: with something else in
 * the middle of the bar, the menu is the only way left to burn the tabs.
 */
export function burnsFromMenu (toolbarButton) {
  return normalizeToolbarButton(toolbarButton) !== 'burn'
}
