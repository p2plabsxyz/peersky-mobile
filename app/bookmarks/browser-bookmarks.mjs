import {
  isHyperUrl,
  isWebUrl,
  MAX_BROWSER_URL_LENGTH
} from '../browser-shell.mjs'
import { normalizeBrowserFavicon } from './browser-favicon.mjs'

export const MAX_BROWSER_BOOKMARKS = 200
export const MAX_BROWSER_BOOKMARK_TITLE_LENGTH = 256

export function parseBrowserBookmarks (serialized) {
  let value

  try {
    value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized
  } catch {
    return []
  }

  if (!value || !Array.isArray(value.items)) {
    return []
  }

  const seenUrls = new Set()
  const bookmarks = []

  for (const item of value.items.slice(0, MAX_BROWSER_BOOKMARKS)) {
    const bookmark = normalizeBrowserBookmark(item)
    if (!bookmark || seenUrls.has(bookmark.url)) continue

    seenUrls.add(bookmark.url)
    bookmarks.push(bookmark)
  }

  return bookmarks
}

export function serializeBrowserBookmarks (bookmarks) {
  return JSON.stringify({
    items: parseBrowserBookmarks({
      items: bookmarks
    })
  })
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

  return [
    bookmark,
    ...bookmarks.filter((item) => item.url !== bookmark.url)
  ]
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
  return favicon ? { ...bookmark, favicon } : bookmark
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
