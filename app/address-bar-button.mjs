// The button at the end of the address bar, after reload. Share unless you
// choose another in Settings > Appearance, next to the bottom bar's button.
// The star sat there for everyone before, and on a phone's narrow bar one
// button more than you use is one too many.

export const DEFAULT_ADDRESS_BAR_BUTTON = 'share'

// In the order the settings list shows them.
export const ADDRESS_BAR_BUTTONS = Object.freeze([
  { id: 'share', title: 'Share' },
  { id: 'bookmark', title: 'Add Bookmark' },
  { id: 'favourite', title: 'Add Favourite' },
  { id: 'reader', title: 'Reader View' },
  { id: 'send', title: 'Send to Your Devices' },
  { id: 'zoom', title: 'Zoom' },
  { id: 'desktop', title: 'Desktop View' },
  { id: 'print', title: 'Print' },
  { id: 'new-tab', title: 'New Tab' },
  { id: 'none', title: 'None' }
])

export function normalizeAddressBarButton (value) {
  return ADDRESS_BAR_BUTTONS.some((button) => button.id === value) ? value : DEFAULT_ADDRESS_BAR_BUTTON
}

export function addressBarButtonTitle (value) {
  return ADDRESS_BAR_BUTTONS.find((button) => button.id === normalizeAddressBarButton(value)).title
}
