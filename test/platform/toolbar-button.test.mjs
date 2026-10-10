import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  burnsFromMenu,
  DEFAULT_TOOLBAR_BUTTON,
  normalizeToolbarButton,
  TOOLBAR_BUTTONS
} from '../../app/toolbar-button.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// The middle of the bar at the bottom holds the burn button unless another is
// chosen in Settings > Appearance, as DuckDuckGo does with its Fire Button.

test('the burn button is the default, and every choice is listed once', () => {
  assert.equal(DEFAULT_TOOLBAR_BUTTON, 'burn')
  const ids = TOOLBAR_BUTTONS.map((button) => button.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.includes('burn'))
  // In alphabetical order, as the list reads.
  const titles = TOOLBAR_BUTTONS.map((button) => button.title)
  assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b)))
})

test('anything this build does not know falls back to the burn button', () => {
  assert.equal(normalizeToolbarButton('share'), 'share')
  assert.equal(normalizeToolbarButton('vpn'), 'burn')
  assert.equal(normalizeToolbarButton(undefined), 'burn')
})

test('with another button on the bar, burning is still in the menu', async () => {
  assert.equal(burnsFromMenu('burn'), false)
  assert.equal(burnsFromMenu('share'), true)
  const menu = await read('app/settings/BrowserOverflowMenu.tsx')
  assert.match(menu, /\.\.\.\(onBurnTabs\s+\? \[\s+<MenuItem\s+key='burn'/)
  assert.match(menu, /label='Burn Tabs and Data'/)
})

test('every choice has an icon, the one the menu uses', async () => {
  const icons = await read('app/toolbar-button-icons.ts')
  for (const { id } of TOOLBAR_BUTTONS) {
    assert.match(icons, new RegExp(`\\n  '?${id}'?: [A-Z][A-Za-z]+Icon`), id)
  }
})

test('Appearance opens the toolbar button page, and back returns there', async () => {
  const appearance = await read('app/settings/Appearance.tsx')
  assert.match(appearance, /<SettingsSection title='Toolbar button'>/)
  assert.match(appearance, /onPress=\{onOpenToolbarButton\}/)
  // Below the logos.
  assert.ok(appearance.indexOf("title='Toolbar button'") > appearance.indexOf("title='Logo'"))

  const settings = await read('app/settings/SettingsScreen.tsx')
  assert.match(settings, /<Appearance \{\.\.\.props\} onOpenToolbarButton=\{\(\) => changePage\('toolbar-button', 1\)\} \/>/)
  assert.match(settings, /title='Toolbar Button'\s+onBack=\{\(\) => changePage\('appearance', -1\)\}/)
  assert.match(settings, /'toolbar-button': 'appearance'/)
  assert.match(settings, /setPage\(SETTINGS_PARENT_PAGES\[pageRef\.current\] \|\| 'main'\)/)

  const page = await read('app/settings/ToolbarButton.tsx')
  // The bar drawn small, with the chosen place picked out, over the list.
  assert.match(page, /<BackIcon[\s\S]{0,200}<ForwardIcon[\s\S]{0,400}<SelectedIcon/)
  assert.match(page, /accessibilityRole='radio'/)
  assert.match(page, /onPress=\{\(\) => onSelect\(button\.id as ToolbarButton\)\}/)
})
