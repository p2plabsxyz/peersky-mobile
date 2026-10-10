import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addBrowserBookmark,
  createBrowserBookmarkFolder,
  deleteBrowserBookmarkFolder,
  findBrowserBookmark,
  getBrowserBookmarksInFolder,
  MAX_BROWSER_BOOKMARK_FOLDERS,
  mergeIncomingBrowserBookmarks,
  moveBrowserBookmark,
  parseBrowserBookmarks,
  parseBrowserBookmarkStore,
  removeBrowserBookmark,
  renameBrowserBookmarkFolder,
  restoreBrowserBookmark,
  serializeBrowserBookmarks
} from '../../app/bookmarks/browser-bookmarks.mjs'

// Bookmarks were one flat list. They can go in folders now, one level deep.

const A = 'https://a.example/'
const B = 'hyper://blog.example/'

function twoBookmarks () {
  let bookmarks = addBrowserBookmark([], { url: A, title: 'A', createdAt: 1 })
  bookmarks = addBrowserBookmark(bookmarks, { url: B, title: 'B', createdAt: 2 })
  return bookmarks
}

test('a bookmark moves into a folder and back to the top, and the file keeps both', () => {
  const { folders, folder } = createBrowserBookmarkFolder([], '  Trips  ', 1_800_000_000_000)
  assert.equal(folder.title, 'Trips')
  let bookmarks = moveBrowserBookmark(twoBookmarks(), A, folder.id)
  assert.deepEqual(getBrowserBookmarksInFolder(bookmarks, folder.id).map((item) => item.url), [A])
  assert.deepEqual(getBrowserBookmarksInFolder(bookmarks, null).map((item) => item.url), [B])

  const restored = parseBrowserBookmarkStore(serializeBrowserBookmarks(bookmarks, folders))
  assert.deepEqual(restored.folders, folders)
  assert.equal(restored.bookmarks.find((item) => item.url === A).folder, folder.id)

  bookmarks = moveBrowserBookmark(bookmarks, A, null)
  assert.equal(bookmarks.find((item) => item.url === A).folder, undefined)
})

test('bookmarking a page again keeps it in its folder', () => {
  const { folder } = createBrowserBookmarkFolder([], 'Read later', 5)
  let bookmarks = moveBrowserBookmark(twoBookmarks(), A, folder.id)
  bookmarks = addBrowserBookmark(bookmarks, { url: A, title: 'A again', createdAt: 9 })
  assert.equal(bookmarks.find((item) => item.url === A).folder, folder.id)
})

test('undoing a removal puts the bookmark back in its place and its folder', () => {
  const { folders, folder } = createBrowserBookmarkFolder([], 'Trips', 4)
  const bookmarks = moveBrowserBookmark(twoBookmarks(), A, folder.id)
  const place = findBrowserBookmark(bookmarks, A)
  assert.equal(place.index, 1)

  const removed = removeBrowserBookmark(bookmarks, A)
  assert.deepEqual(restoreBrowserBookmark(removed, place, folders), bookmarks)
  // Bookmarked again in the meantime: left as it is.
  assert.equal(restoreBrowserBookmark(bookmarks, place, folders), bookmarks)
  // Its folder was deleted in the meantime: back at the top.
  assert.equal(restoreBrowserBookmark(removed, place, []).find((item) => item.url === A).folder, undefined)
})

test('deleting a folder keeps its bookmarks, back at the top', () => {
  const { folders, folder } = createBrowserBookmarkFolder([], 'Work', 7)
  const bookmarks = moveBrowserBookmark(twoBookmarks(), B, folder.id)
  const after = deleteBrowserBookmarkFolder({ bookmarks, folders }, folder.id)
  assert.deepEqual(after.folders, [])
  assert.equal(after.bookmarks.length, 2)
  assert.ok(after.bookmarks.every((item) => item.folder === undefined))
})

test('a folder can be renamed, and names and the number of folders are bounded', () => {
  let { folders, folder } = createBrowserBookmarkFolder([], 'Old', 3)
  folders = renameBrowserBookmarkFolder(folders, folder.id, 'New')
  assert.equal(folders[0].title, 'New')
  assert.equal(renameBrowserBookmarkFolder(folders, folder.id, '   '), folders)
  assert.equal(createBrowserBookmarkFolder(folders, '').folder, null)
  assert.equal(createBrowserBookmarkFolder(folders, 'x'.repeat(200), 4).folder.title.length, 64)

  let many = []
  for (let index = 0; index < MAX_BROWSER_BOOKMARK_FOLDERS + 3; index += 1) {
    many = createBrowserBookmarkFolder(many, `F${index}`, 100 + index).folders
  }
  assert.equal(many.length, MAX_BROWSER_BOOKMARK_FOLDERS)
  // Two made in the same millisecond still get their own ids.
  const first = createBrowserBookmarkFolder([], 'One', 50)
  const second = createBrowserBookmarkFolder(first.folders, 'Two', 50)
  assert.notEqual(first.folder.id, second.folder.id)
})

test('bookmarks from another device come in at the top, whatever folder they were in there', () => {
  const merged = mergeIncomingBrowserBookmarks([], {
    bookmarks: [{ url: A, title: 'A', createdAt: 1, folder: 'folder-elsewhere' }]
  })
  assert.equal(merged[0].folder, undefined)
  assert.deepEqual(getBrowserBookmarksInFolder(merged, null).map((item) => item.url), [A])
})

test('a file from before folders reads as it did, and a bookmark in a missing folder is at the top', () => {
  const before = JSON.stringify({ items: [{ url: A, title: 'A', createdAt: 1 }] })
  assert.deepEqual(parseBrowserBookmarkStore(before), { bookmarks: [{ url: A, title: 'A', createdAt: 1 }], folders: [] })
  const orphan = JSON.stringify({ items: [{ url: A, title: 'A', createdAt: 1, folder: 'folder-gone' }] })
  assert.equal(parseBrowserBookmarks(orphan)[0].folder, undefined)
  // Serialized without folders, the file looks as it did before them.
  assert.equal(serializeBrowserBookmarks(twoBookmarks()).includes('folders'), false)
})

test('the Bookmarks screen lists folders first, opens them, and moves a bookmark with the folder button', async () => {
  const { readFile } = await import('node:fs/promises')
  const screen = await readFile(new URL('../../app/bookmarks/BookmarksScreen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /\.\.\.folders\.map\(\(folder\) => \(\{\s+kind: 'folder' as const/)
  assert.match(screen, /onPress=\{\(\) => setOpenFolderId\(item\.folder\.id\)\}/)
  assert.match(screen, /accessibilityLabel=\{`Move \$\{bookmark\.title\} to a folder`\}/)
  assert.match(screen, /if \(moving\) onMoveBookmark\(moving\.url, folderId\)/)
  assert.match(screen, /Tap the star in the address bar to bookmark a page\./)
})
