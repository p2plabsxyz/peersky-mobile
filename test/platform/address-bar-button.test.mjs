import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  ADDRESS_BAR_BUTTONS,
  DEFAULT_ADDRESS_BAR_BUTTON,
  normalizeAddressBarButton
} from '../../app/address-bar-button.mjs'
import { parseBrowserPreferences } from '../../app/settings/browser-preferences.mjs'

// The button after reload in the address bar is a choice, made in Settings >
// Appearance next to the bottom bar's: Share unless another is picked, and a
// star only for someone who wants one there.

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8')

test('Share is what a new install gets, and anything unknown falls back to it', () => {
  assert.equal(DEFAULT_ADDRESS_BAR_BUTTON, 'share')
  assert.equal(parseBrowserPreferences({}).addressBarButton, 'share')
  assert.equal(parseBrowserPreferences({ addressBarButton: 'reader' }).addressBarButton, 'reader')
  assert.equal(normalizeAddressBarButton('launch-rockets'), 'share')
  assert.deepEqual(ADDRESS_BAR_BUTTONS.map((button) => button.id), [
    'share', 'bookmark', 'favourite', 'reader', 'send', 'zoom', 'desktop', 'print', 'new-tab', 'none'
  ])
})

test('every choice has an icon and an action, and None leaves only reload', async () => {
  const icons = await read('app/address-bar-button-icons.ts')
  for (const { id } of ADDRESS_BAR_BUTTONS) {
    assert.match(icons, new RegExp(`\\n  '?${id}'?: [A-Z][A-Za-z]+Icon`), id)
  }
  const app = await read('app/index.tsx')
  for (const { id } of ADDRESS_BAR_BUTTONS.filter((button) => button.id !== 'none')) {
    assert.match(app, new RegExp(`case '${id}'`), id)
  }
  assert.match(app, /default:\s+return null\s+\}\s+\}\)\(\)/)
  assert.match(app, /addressBarAction=\{browserAddressBarAction\}/)
  const toolbar = await read('app/BrowserToolbar.tsx')
  assert.match(toolbar, /\{addressBarAction && \(\s+<AddressBarActionButton/)
  assert.doesNotMatch(toolbar, /StarIcon|onToggleBookmark/)
})

test('Appearance opens the address bar button page, and back returns there', async () => {
  const appearance = await read('app/settings/Appearance.tsx')
  assert.match(appearance, /<SettingsSection title=\{t\('Address bar button'\)\}>/)
  assert.match(appearance, /onPress=\{onOpenAddressBarButton\}/)
  assert.ok(appearance.indexOf("title={t('Address bar button')}") > appearance.indexOf("title={t('Toolbar button')}"))
  const settings = await read('app/settings/SettingsScreen.tsx')
  assert.match(settings, /onOpenAddressBarButton=\{\(\) => changePage\('address-bar-button', 1\)\}/)
  assert.match(settings, /'address-bar-button': 'appearance'/)
  const page = await read('app/settings/AddressBarButton.tsx')
  assert.match(page, /accessibilityRole='radio'/)
  assert.match(page, /onPress=\{\(\) => onSelect\(button\.id as AddressBarButton\)\}/)
})

// Safari and Chrome select the whole address when the bar is tapped, so what
// is typed replaces it. In PeerSky the caret landed where the finger did, and
// typing went into the middle of the old address.
test('a tap on the address bar selects the whole address', async () => {
  const toolbar = await read('app/BrowserToolbar.tsx')
  const effect = /useEffect\(\(\) => \{\s*if \(!isAddressFocused\) return\s*addressInputRef\.current\?\.setSelection\(0, address\.length\)\s*\}, \[isAddressFocused\]\)/
  assert.match(toolbar, effect)
  // While the box is not being typed in, it shows the start of the address.
  assert.match(toolbar, /selection=\{isAddressFocused \? undefined : \{ start: 0, end: 0 \}\}/)
  assert.match(toolbar, /value=\{isAddressFocused \? address : formatBrowserAddress\(address, showFullAddress\)\}/)
})
