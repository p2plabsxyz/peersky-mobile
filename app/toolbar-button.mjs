// The button in the middle of the bar at the bottom. The burn button unless
// you choose another in Settings > Appearance > Toolbar button, the way
// DuckDuckGo lets you swap its Fire Button.

export const DEFAULT_TOOLBAR_BUTTON = 'burn'

// In the order the settings list shows them.
export const TOOLBAR_BUTTONS = Object.freeze([
  { id: 'bookmark', title: 'Add Bookmark' },
  { id: 'favourite', title: 'Add Favourite' },
  { id: 'bookmarks', title: 'Bookmarks' },
  { id: 'burn', title: 'Burn Tabs and Data' },
  { id: 'downloads', title: 'Downloads' },
  { id: 'history', title: 'History' },
  { id: 'home', title: 'Home' },
  { id: 'incognito', title: 'New Incognito Tab' },
  { id: 'new-tab', title: 'New Tab' },
  { id: 'settings', title: 'Settings' },
  { id: 'share', title: 'Share' },
  { id: 'zoom', title: 'Zoom' }
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
