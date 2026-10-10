import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// A tab moves by pressing and holding it, then dragging it where it should go.
// Let go without dragging, and it starts picking tabs, as a long press did.

const screen = await readFile(new URL('../../app/tabs/BrowserTabsScreen.tsx', import.meta.url), 'utf8')
const shell = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

test('a long press picks a tab up, and a drag drops it where it was let go', () => {
  assert.match(screen, /onLongPress=\{\(\) => \{\s+if \(selecting\) return\s+setMenuOpen\(false\)\s+draggingRef\.current = false\s+setDragArmedId\(item\.id\)/)
  assert.match(screen, /onDrop=\{\(gesture, size\) => dropTab\(item, gesture, size\)\}/)
  assert.match(screen, /const to = getTabDropIndex\(\{/)
  // The list holds still while a card is being dragged across it.
  assert.match(screen, /scrollEnabled=\{dragArmedId === null\}/)
  // One cell component for good, or every card would be rebuilt mid drag.
  assert.match(screen, /CellRendererComponent=\{TabRow\}/)
})

test('letting go without dragging starts picking tabs', () => {
  assert.match(screen, /if \(dragArmedIdRef\.current !== item\.id \|\| draggingRef\.current\) return\s+setDragArmedId\(null\)\s+setSelected\(new Set\(\[item\.id\]\)\)/)
})

test('the browser moves the tab in its saved order', () => {
  assert.match(shell, /const nextState = moveBrowserTabState\(currentTabsState, tabId, toIndex\) as BrowserTabsState/)
  assert.match(shell, /onMoveTab=\{onBrowserMoveTab\}/)
})
