import {
  isHyperUrl,
  isWebUrl,
  MAX_BROWSER_URL_LENGTH
} from '../browser-shell.mjs'
import { normalizeBrowserFavicon } from './browser-favicon.mjs'

export const MAX_BROWSER_BOOKMARKS = 200
export const MAX_BROWSER_BOOKMARK_TITLE_LENGTH = 256
// Bookmarks can sit in folders, one level deep, which is as much as a phone
// screen shows well. A bookmark with no folder is at the top of Bookmarks.
export const MAX_BROWSER_BOOKMARK_FOLDERS = 50
export const MAX_BROWSER_BOOKMARK_FOLDER_TITLE_LENGTH = 64

export function parseBrowserBookmarks (serialized) {
  return parseBrowserBookmarkStore(serialized).bookmarks
}

/**
 * The bookmarks file: its bookmarks and its folders. A bookmark whose folder
 * is not there any more is at the top again. A file from before folders has
 * none, and reads the same as it always did.
 */
export function parseBrowserBookmarkStore (serialized) {
  let value

  try {
    value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized
  } catch {
    return { bookmarks: [], folders: [] }
  }

  if (!value || !Array.isArray(value.items)) {
    return { bookmarks: [], folders: [] }
  }

  const folders = normalizeBrowserBookmarkFolders(value.folders)
  const folderIds = new Set(folders.map((folder) => folder.id))
  const seenUrls = new Set()
  const bookmarks = []

  for (const item of value.items.slice(0, MAX_BROWSER_BOOKMARKS)) {
    const bookmark = normalizeBrowserBookmark(item)
    if (!bookmark || seenUrls.has(bookmark.url)) continue

    seenUrls.add(bookmark.url)
    if (bookmark.folder && !folderIds.has(bookmark.folder)) delete bookmark.folder
    bookmarks.push(bookmark)
  }

  return { bookmarks, folders }
}

export function serializeBrowserBookmarks (bookmarks, folders = []) {
  const store = parseBrowserBookmarkStore({ items: bookmarks, folders })
  return JSON.stringify({
    items: store.bookmarks,
    ...(store.folders.length > 0 && { folders: store.folders })
  })
}

export function createBrowserBookmarkFolder (folders, title, createdAt = Date.now()) {
  const name = normalizeBrowserBookmarkFolderTitle(title)
  if (!name || folders.length >= MAX_BROWSER_BOOKMARK_FOLDERS) return { folders, folder: null }
  const ids = new Set(folders.map((folder) => folder.id))
  let id = `folder-${createdAt.toString(36)}`
  for (let n = 1; ids.has(id); n += 1) id = `folder-${createdAt.toString(36)}-${n}`
  const folder = { id, title: name, createdAt }
  return { folders: [...folders, folder], folder }
}

export function renameBrowserBookmarkFolder (folders, folderId, title) {
  const name = normalizeBrowserBookmarkFolderTitle(title)
  if (!name) return folders
  return folders.map((folder) => folder.id === folderId ? { ...folder, title: name } : folder)
}

// Deleting a folder keeps what was in it: its bookmarks go back to the top.
export function deleteBrowserBookmarkFolder ({ bookmarks, folders }, folderId) {
  return {
    folders: folders.filter((folder) => folder.id !== folderId),
    bookmarks: bookmarks.map((bookmark) => {
      if (bookmark.folder !== folderId) return bookmark
      const { folder, ...rest } = bookmark
      return rest
    })
  }
}

// Into a folder, or to the top with null.
export function moveBrowserBookmark (bookmarks, url, folderId) {
  const normalizedUrl = normalizeBrowserBookmarkUrl(url)
  if (!normalizedUrl) return bookmarks
  return bookmarks.map((bookmark) => {
    if (bookmark.url !== normalizedUrl) return bookmark
    const { folder, ...rest } = bookmark
    return folderId ? { ...rest, folder: folderId } : rest
  })
}

export function getBrowserBookmarksInFolder (bookmarks, folderId) {
  return bookmarks.filter((bookmark) => (bookmark.folder || null) === (folderId || null))
}

function normalizeBrowserBookmarkFolders (value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const folders = []
  for (const item of value.slice(0, MAX_BROWSER_BOOKMARK_FOLDERS)) {
    const id = typeof item?.id === 'string' && /^folder-[a-z0-9-]{1,40}$/.test(item.id) ? item.id : ''
    const title = normalizeBrowserBookmarkFolderTitle(item?.title)
    const createdAt = Number(item?.createdAt)
    if (!id || !title || seen.has(id) || !Number.isSafeInteger(createdAt) || createdAt < 0) continue
    seen.add(id)
    folders.push({ id, title, createdAt })
  }
  return folders
}

function normalizeBrowserBookmarkFolderTitle (title) {
  return Array.from(String(title || ''))
    .filter(isSafeBookmarkTitleCharacter)
    .join('')
    .trim()
    .slice(0, MAX_BROWSER_BOOKMARK_FOLDER_TITLE_LENGTH)
}

export function addBrowserBookmark (bookmarks, {
  url,
  title,
  favicon,
  createdAt = Date.now()
}) {
  const bookmark = normalizeBrowserBookmark({ url, title, favicon, createdAt })
  if (!bookmark) return bookmarks

  const existingIndex = bookmarks.findIndex((item) => item.url === bookmark.url)
  if (existingIndex === -1 && bookmarks.length >= MAX_BROWSER_BOOKMARKS) {
    return bookmarks
  }
  const existingFolder = existingIndex === -1 ? null : bookmarks[existingIndex].folder

  return [
    existingFolder ? { ...bookmark, folder: existingFolder } : bookmark,
    ...bookmarks.filter((item) => item.url !== bookmark.url)
  ]
}

/**
 * Adds bookmarks that came from another device after the ones already here,
 * so the phone's own stay on top. Anything already bookmarked is left as it
 * is, and the limit holds. Folders belong to the phone that made them, so
 * these land at the top.
 */
export function mergeIncomingBrowserBookmarks (bookmarks, incoming) {
  const list = Array.isArray(incoming?.bookmarks) ? incoming.bookmarks : []
  const merged = [...bookmarks]
  const seen = new Set(bookmarks.map((bookmark) => bookmark.url))

  for (const item of list) {
    if (merged.length >= MAX_BROWSER_BOOKMARKS) break
    const bookmark = normalizeBrowserBookmark(item)
    if (!bookmark || seen.has(bookmark.url)) continue
    seen.add(bookmark.url)
    delete bookmark.folder
    merged.push(bookmark)
  }

  return merged.length === bookmarks.length ? bookmarks : merged
}

// Where a page is in the list, so taking it out can be undone exactly.
export function findBrowserBookmark (bookmarks, url) {
  const normalizedUrl = normalizeBrowserBookmarkUrl(url)
  const index = normalizedUrl ? bookmarks.findIndex((bookmark) => bookmark.url === normalizedUrl) : -1
  return index === -1 ? null : { bookmark: bookmarks[index], index }
}

// Puts back a bookmark just removed, in its old place and its folder if that
// is still there.
export function restoreBrowserBookmark (bookmarks, { bookmark, index }, folders = []) {
  const restored = normalizeBrowserBookmark(bookmark)
  if (
    !restored ||
    bookmarks.length >= MAX_BROWSER_BOOKMARKS ||
    bookmarks.some((item) => item.url === restored.url)
  ) {
    return bookmarks
  }
  if (restored.folder && !folders.some((folder) => folder.id === restored.folder)) delete restored.folder
  const at = Math.min(Math.max(Number.isSafeInteger(index) ? index : 0, 0), bookmarks.length)
  return [...bookmarks.slice(0, at), restored, ...bookmarks.slice(at)]
}

export function removeBrowserBookmark (bookmarks, url) {
  const normalizedUrl = normalizeBrowserBookmarkUrl(url)
  if (!normalizedUrl) return bookmarks

  return bookmarks.filter((bookmark) => bookmark.url !== normalizedUrl)
}

export function isBrowserUrlBookmarked (bookmarks, url) {
  const normalizedUrl = normalizeBrowserBookmarkUrl(url)
  return Boolean(
    normalizedUrl &&
    bookmarks.some((bookmark) => bookmark.url === normalizedUrl)
  )
}

export function canBookmarkBrowserPage (sourceKind, url) {
  return (
    (sourceKind === 'web' || sourceKind === 'hyper') &&
    normalizeBrowserBookmarkUrl(url) !== null
  )
}

function normalizeBrowserBookmark (value) {
  const url = normalizeBrowserBookmarkUrl(value?.url)
  if (!url) return null

  const createdAt = Number(value?.createdAt)
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) return null

  const bookmark = {
    url,
    title: normalizeBrowserBookmarkTitle(value?.title, url),
    createdAt
  }
  const favicon = normalizeBrowserFavicon(value?.favicon, url)
  const folder = typeof value?.folder === 'string' && /^folder-[a-z0-9-]{1,40}$/.test(value.folder)
    ? value.folder
    : null
  return {
    ...bookmark,
    ...(favicon && { favicon }),
    ...(folder && { folder })
  }
}

function normalizeBrowserBookmarkUrl (url) {
  const value = String(url || '').trim()
  if (
    value.length < 1 ||
    value.length > MAX_BROWSER_URL_LENGTH ||
    (!isWebUrl(value) && !isHyperUrl(value))
  ) {
    return null
  }

  try {
    const parsed = new URL(value)
    if (parsed.username || parsed.password) return null
    const normalizedUrl = parsed.href
    return normalizedUrl.length <= MAX_BROWSER_URL_LENGTH
      ? normalizedUrl
      : null
  } catch {
    return null
  }
}

function normalizeBrowserBookmarkTitle (title, fallback) {
  const normalized = Array.from(String(title || ''))
    .filter(isSafeBookmarkTitleCharacter)
    .join('')
    .trim()

  return Array.from(normalized || fallback)
    .slice(0, MAX_BROWSER_BOOKMARK_TITLE_LENGTH)
    .join('')
}

function isSafeBookmarkTitleCharacter (character) {
  const codePoint = character.codePointAt(0)
  if (codePoint === undefined) return false

  return !(
    codePoint < 32 ||
    (codePoint >= 127 && codePoint <= 159) ||
    codePoint === 0x061c ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x2028 && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    codePoint === 0xfeff
  )
}
