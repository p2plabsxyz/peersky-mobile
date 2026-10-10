import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Bookmarking a page took opening the menu first. Add Bookmark can be the
// address bar's button now, filled when the page is bookmarked, with a toast
// and Undo. It is a choice rather than a star for everyone.

const toolbar = await readFile(new URL('../../app/BrowserToolbar.tsx', import.meta.url), 'utf8')
const shell = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

test('Add Bookmark in the address bar bookmarks the page in one tap', () => {
  assert.match(shell, /case 'bookmark':[\s\S]{0,200}label: browserPageIsBookmarked \? 'Remove bookmark' : 'Bookmark page',\s+active: browserPageIsBookmarked,\s+onPress: onBrowserToggleBookmark/)
  assert.match(toolbar, /accessibilityLabel=\{action\.label\}/)
  assert.match(toolbar, /onPress=\{action\.onPress\}/)
})

test('bookmarking says so and offers a folder, and removing one can be undone', () => {
  assert.match(shell, /message: 'Bookmarked',\s+actionLabel: 'Add to folder',\s+onAction: \(\) => setBookmarkFolderUrl\(page\.url\)/)
  assert.match(shell, /const place = findBrowserBookmark\(page\.url\)\s+const result = toggleBrowserBookmark\(page\)/)
  assert.match(shell, /message: 'Bookmark removed',\s+actionLabel: 'Undo',\s+onAction: \(\) => \{ if \(place\) restoreBrowserBookmark\(place\) \}/)
})

test('picking a folder from the toast says where the bookmark went', () => {
  assert.match(shell, /moveBrowserBookmark\(bookmarkFolderUrl, folderId\)\) \{\s+setBrowserToast\(\{ id: Date\.now\(\), message: `Saved in \$\{title\}` \}\)/)
})
