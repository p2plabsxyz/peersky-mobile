import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Bookmarking a page took opening the menu first. The address bar has a star
// now, filled when the page is bookmarked, and a toast with Undo.

const toolbar = await readFile(new URL('../../app/BrowserToolbar.tsx', import.meta.url), 'utf8')
const shell = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

test('the address bar has a star that bookmarks the page in one tap', () => {
  assert.match(toolbar, /accessibilityLabel=\{isBookmarked \? 'Remove bookmark' : 'Bookmark page'\}/)
  assert.match(toolbar, /onPress=\{onToggleBookmark\}/)
  assert.match(shell, /onToggleBookmark=\{onBrowserToggleBookmark\}/)
  assert.match(shell, /isBookmarked=\{browserPageIsBookmarked\}\s+onToggleBookmark/)
})

test('bookmarking says so, and Undo takes it back', () => {
  assert.match(shell, /message: result === 'added' \? 'Bookmarked' : 'Bookmark removed',\s+actionLabel: 'Undo',\s+onAction: \(\) => \{ toggleBrowserBookmark\(page\) \}/)
})
