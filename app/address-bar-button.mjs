// The button at the end of the address bar, after reload. Share unless you
// choose another in Settings > Appearance, next to the bottom bar's button.
// The star sat there for everyone before, and on a phone's narrow bar one
// button more than you use is one too many.

import { msg, tKey } from './i18n/i18n.mjs'

export const DEFAULT_ADDRESS_BAR_BUTTON = 'share'

// In the order the settings list shows them.
export const ADDRESS_BAR_BUTTONS = Object.freeze([
  { id: 'share', title: msg('Share') },
  { id: 'bookmark', title: msg('Add Bookmark') },
  { id: 'favourite', title: msg('Add Favourite') },
  { id: 'reader', title: msg('Reader View') },
  { id: 'send', title: msg('Send to Your Devices') },
  { id: 'zoom', title: msg('Zoom') },
  { id: 'desktop', title: msg('Desktop View') },
  { id: 'print', title: msg('Print') },
  { id: 'new-tab', title: msg('New Tab') },
  { id: 'none', title: msg('None') }
])

export function normalizeAddressBarButton (value) {
  return ADDRESS_BAR_BUTTONS.some((button) => button.id === value) ? value : DEFAULT_ADDRESS_BAR_BUTTON
}

// The title in the language shown now. The table keeps the English.
export function addressBarButtonTitle (value) {
  return tKey(ADDRESS_BAR_BUTTONS.find((button) => button.id === normalizeAddressBarButton(value)).title)
}
