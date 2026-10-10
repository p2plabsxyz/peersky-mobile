import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Several tabs can be picked at once, from the tab list's menu or by pressing
// and holding a tab, to copy all their links, share them or close them.

const screen = await readFile(new URL('../../app/tabs/BrowserTabsScreen.tsx', import.meta.url), 'utf8')
const shell = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

test('the menu and a long press both start picking tabs, and a tap then picks', () => {
  assert.match(screen, /Select tabs<\/Text>/)
  assert.match(screen, /onLongPress=\{\(\) => \{\s+if \(selecting\) return\s+setMenuOpen\(false\)\s+setSelected\(new Set\(\[item\.id\]\)\)/)
  assert.match(screen, /onPress=\{\(\) => selecting \? toggleSelected\(item\.id\) : onSwitchTab\(item\.id\)\}/)
  // A sideways drag is not a close while picking.
  assert.match(screen, /disabled=\{selecting\}/)
})

test('the picked tabs copy, share or close together, and closing them can be undone', () => {
  assert.match(screen, /label='Copy links'/)
  assert.match(screen, /label='Share'/)
  assert.match(screen, /onAction: \(\) => onReopenClosedTabs\(keys\)/)
  assert.match(shell, /const urls = getBrowserTabUrls\(browserTabsStateRef\.current, tabIds\) as string\[\]\s+if \(urls\.length > 0\) Clipboard\.setString\(urls\.join\('\\n'\)\)/)
  assert.match(shell, /const nextState = closeBrowserTabsState\(currentTabsState, ids\) as BrowserTabsState/)
})
