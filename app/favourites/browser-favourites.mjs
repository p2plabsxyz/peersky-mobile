import {
  isHyperUrl,
  isWebUrl,
  MAX_BROWSER_URL_LENGTH
} from '../browser-shell.mjs'
import { normalizeBrowserFavicon } from '../bookmarks/browser-favicon.mjs'

// Eight, because they sit on the home screen in the same grid as the built-in
// apps and a ninth would push the wallpaper off the bottom.
export const MAX_BROWSER_FAVOURITES = 8
export const MAX_BROWSER_FAVOURITE_TITLE_LENGTH = 64

/**
 * A favourite is not a bookmark.
 *
 * A bookmark is a list you keep, as long as you like, and go looking through.
 * A favourite is one of eight tiles on the home screen, next to PeerChat and
 * the rest, for the places you open without thinking. Keeping them apart means
 * neither one has to compromise: the list can grow, the grid stays a grid.
 */
export function parseBrowserFavourites (serialized) {
  let value

  try {
    value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized
  } catch {
    return []
  }

  if (!value || !Array.isArray(value.items)) return []

  const seenUrls = new Set()
  const favourites = []

  for (const item of value.items) {
    if (favourites.length >= MAX_BROWSER_FAVOURITES) break
    const favourite = normalizeBrowserFavourite(item)
    if (!favourite || seenUrls.has(favourite.url)) continue

    seenUrls.add(favourite.url)
    favourites.push(favourite)
  }

  return favourites
}

export function serializeBrowserFavourites (favourites) {
  return JSON.stringify({ items: parseBrowserFavourites({ items: favourites }) })
}

export function addBrowserFavourite (favourites, { url, title, favicon, createdAt = Date.now() }) {
  const favourite = normalizeBrowserFavourite({ url, title, favicon, createdAt })
  if (!favourite) return favourites

  const without = favourites.filter((item) => item.url !== favourite.url)
  // New ones go on the end. The grid is a place, and something you added last
  // week should not move because you added something today.
  if (without.length >= MAX_BROWSER_FAVOURITES) return favourites
  return [...without, favourite]
}

export function removeBrowserFavourite (favourites, url) {
  const normalizedUrl = normalizeBrowserFavouriteUrl(url)
  if (!normalizedUrl) return favourites

  return favourites.filter((favourite) => favourite.url !== normalizedUrl)
}

export function isBrowserUrlFavourited (favourites, url) {
  const normalizedUrl = normalizeBrowserFavouriteUrl(url)
  return Boolean(
    normalizedUrl &&
    favourites.some((favourite) => favourite.url === normalizedUrl)
  )
}

export function canFavouriteBrowserPage (sourceKind, url) {
  return (
    (sourceKind === 'web' || sourceKind === 'hyper') &&
    normalizeBrowserFavouriteUrl(url) !== null
  )
}

function normalizeBrowserFavourite (value) {
  const url = normalizeBrowserFavouriteUrl(value?.url)
  if (!url) return null

  const createdAt = Number(value?.createdAt)
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) return null

  const favourite = {
    url,
    title: normalizeBrowserFavouriteTitle(value?.title, url),
    createdAt
  }
  const favicon = normalizeBrowserFavicon(value?.favicon, url)
  return favicon ? { ...favourite, favicon } : favourite
}

function normalizeBrowserFavouriteUrl (url) {
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
    return parsed.href.length <= MAX_BROWSER_URL_LENGTH ? parsed.href : null
  } catch {
    return null
  }
}

// Two lines under a 64pt tile, so a long page title is cut to something that
// fits rather than something that wraps into the row below.
function normalizeBrowserFavouriteTitle (title, fallback) {
  const normalized = Array.from(String(title || ''))
    .filter(isSafeFavouriteTitleCharacter)
    .join('')
    .trim()

  const source = normalized || hostFromUrl(fallback) || fallback
  return Array.from(source).slice(0, MAX_BROWSER_FAVOURITE_TITLE_LENGTH).join('')
}

function hostFromUrl (url) {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function isSafeFavouriteTitleCharacter (character) {
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
