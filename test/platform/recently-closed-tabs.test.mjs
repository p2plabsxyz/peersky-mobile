import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { formatClosedTabTime } from '../../app/tabs/recently-closed-time.mjs'

// Tabs closed lately can be opened again, from the tab list's menu, and a tab
// just closed comes straight back with Undo, as in Firefox.

const screen = await readFile(new URL('../../app/tabs/BrowserTabsScreen.tsx', import.meta.url), 'utf8')
const shell = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

test('the list says how long ago each tab was closed', () => {
  const now = 1_800_000_000_000
  assert.equal(formatClosedTabTime(now - 10_000, now), 'Just now')
  assert.equal(formatClosedTabTime(now - 5 * 60_000, now), '5 min ago')
  assert.equal(formatClosedTabTime(now - 3 * 3_600_000, now), '3 h ago')
  assert.equal(formatClosedTabTime(now - 30 * 3_600_000, now), 'Yesterday')
  assert.equal(formatClosedTabTime(now - 4 * 86_400_000, now), '4 days ago')
})

test('the tab list opens Recently closed from its menu, and closing a tab offers Undo', () => {
  assert.match(screen, /Recently closed tabs<\/Text>/)
  assert.match(screen, /onReopen=\{\(key\) => onReopenClosedTab\(key\)\}/)
  assert.match(screen, /actionLabel: 'Undo',\s+onAction: \(\) => onReopenClosedTab\(key, \{ restorePlace: true \}\)/)
  // Close all moved into the menu, so the bar keeps four buttons.
  assert.match(screen, /Close all tabs<\/Text>/)
})

test('a closed tab is remembered, and Burn and clearing history forget them all', () => {
  assert.match(shell, /const closed = snapshotClosedBrowserTab\(currentTabsState\.tabs\[closingIndex\]/)
  assert.match(shell, /return closed \? closed\.key : null/)
  const burn = shell.slice(shell.indexOf('  function burnBrowserTabs ()'), shell.indexOf('  function onBrowserCloseAllTabs ()'))
  assert.match(burn, /updateRecentlyClosedTabs\(\[\]\)/)
  const clearData = shell.slice(shell.indexOf('onClearBrowsingData={() => {'), shell.indexOf('onClearCachedData='))
  assert.match(clearData, /updateRecentlyClosedTabs\(\[\]\)/)
})
