import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Tabs not opened for two weeks are kept apart at the top of the tab list,
// folded away, with a way to close them all, as Firefox does.

const screen = await readFile(new URL('../../app/tabs/BrowserTabsScreen.tsx', import.meta.url), 'utf8')
const shell = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

test('inactive tabs leave the grid for a folded group, and close together with Undo', () => {
  assert.match(screen, /const gridItems = selecting \? items : items\.filter\(\(item\) => !item\.isInactive\)/)
  assert.match(screen, /Inactive tabs \(\{items\.length\}\)/)
  assert.match(screen, /Close all inactive tabs<\/Text>/)
  assert.match(screen, /const keys = onCloseTabs\(inactiveItems\.map\(\(item\) => item\.id\)\)/)
})

test('the browser marks a tab inactive by when it was last on screen', () => {
  assert.match(shell, /isInactive: isInactiveBrowserTab\(tab, browserTabsState\.activeTabId, browserTabManagerNow\)/)
})
