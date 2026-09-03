import {
  isHyperUrl,
  isWebUrl,
  MAX_BROWSER_URL_LENGTH
} from '../browser-shell.mjs'

export const MAX_BROWSER_HISTORY_ITEMS = 500
export const MAX_BROWSER_HISTORY_TITLE_LENGTH = 256
export const MAX_BROWSER_HISTORY_SUGGESTIONS = 5
export const MAX_BROWSER_HISTORY_FILE_BYTES = 4 * 1024 * 1024

export function parseBrowserHistory (serialized) {
  return parseBrowserHistoryResult(serialized).items
}

export function parseBrowserHistoryResult (serialized) {
  let value

  try {
    value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized
  } catch {
    return { ok: false, items: [] }
  }

  if (!value || !Array.isArray(value.items)) return { ok: false, items: [] }

  const items = []
  const seenUrls = new Set()

  for (const valueItem of value.items.slice(0, MAX_BROWSER_HISTORY_ITEMS)) {
    const item = normalizeBrowserHistoryItem(valueItem)
    if (!item || seenUrls.has(item.url)) continue

    seenUrls.add(item.url)
    items.push(item)
    if (items.length >= MAX_BROWSER_HISTORY_ITEMS) break
  }

  return { ok: true, items }
}

export function serializeBrowserHistory (items) {
  return JSON.stringify({ items: parseBrowserHistory({ items }) })
}

export function addBrowserHistoryItem (items, value) {
  const item = normalizeBrowserHistoryItem(value)
  if (!item) return items
  const current = items[0]
  if (
    current?.url === item.url &&
    current.title === item.title &&
    item.visitedAt >= current.visitedAt &&
    item.visitedAt - current.visitedAt < 1000
  ) return items

  return [
    item,
    ...items.filter((existing) => existing.url !== item.url)
  ].slice(0, MAX_BROWSER_HISTORY_ITEMS)
}

export function removeBrowserHistoryItem (items, value) {
  const item = normalizeBrowserHistoryItem(value)
  if (!item) return items

  const index = items.findIndex((existing) => (
    existing.url === item.url && existing.visitedAt === item.visitedAt
  ))
  if (index < 0) return items

  return [...items.slice(0, index), ...items.slice(index + 1)]
}

export function getBrowserHistorySuggestions (
  items,
  query,
  limit = MAX_BROWSER_HISTORY_SUGGESTIONS
) {
  const normalizedQuery = String(query || '').trim().toLowerCase()
  if (!normalizedQuery || !Number.isSafeInteger(limit) || limit < 1) return []

  const suggestions = []
  const seenUrls = new Set()

  for (const item of items) {
    if (
      seenUrls.has(item.url) || !(
        item.url.toLowerCase().includes(normalizedQuery) ||
        item.title.toLowerCase().includes(normalizedQuery)
      )
    ) continue

    seenUrls.add(item.url)
    suggestions.push(item)
    if (suggestions.length >= Math.min(limit, MAX_BROWSER_HISTORY_SUGGESTIONS)) break
  }

  return suggestions
}

export function mergeBrowserHistoryItems (restored, pending) {
  let items = restored
  for (const item of pending) items = addBrowserHistoryItem(items, item)
  return items
}

export function getBrowserHistoryDocumentTitle (html, fallback) {
  const match = String(html || '').slice(0, 64 * 1024).match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)
  if (!match) return normalizeBrowserHistoryTitle(fallback, fallback)

  const title = decodeBasicHtmlEntities(match[1].replace(/<[^>]*>/g, ' '))
  return normalizeBrowserHistoryTitle(title, fallback)
}

export function normalizeBrowserHistoryItem (value) {
  const url = normalizeBrowserHistoryUrl(value?.url)
  if (!url) return null

  const visitedAt = Number(value?.visitedAt)
  if (!Number.isSafeInteger(visitedAt) || visitedAt < 0) return null

  return {
    url,
    title: normalizeBrowserHistoryTitle(value?.title, url),
    visitedAt
  }
}

function normalizeBrowserHistoryUrl (url) {
  const value = String(url || '').trim()
  if (
    value.length < 1 ||
    value.length > MAX_BROWSER_URL_LENGTH ||
    (!isWebUrl(value) && !isHyperUrl(value))
  ) return null

  try {
    const parsed = new URL(value)
    if (parsed.username || parsed.password) return null
    return parsed.href.length <= MAX_BROWSER_URL_LENGTH ? parsed.href : null
  } catch {
    return null
  }
}

function normalizeBrowserHistoryTitle (title, fallback) {
  const normalized = Array.from(String(title || ''))
    .filter((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && !(
        codePoint < 32 ||
        (codePoint >= 127 && codePoint <= 159) ||
        codePoint === 0x061c ||
        (codePoint >= 0x200b && codePoint <= 0x200f) ||
        (codePoint >= 0x2028 && codePoint <= 0x202e) ||
        (codePoint >= 0x2060 && codePoint <= 0x206f) ||
        codePoint === 0xfeff
      )
    })
    .join('')
    .trim()

  return Array.from(normalized || fallback)
    .slice(0, MAX_BROWSER_HISTORY_TITLE_LENGTH)
    .join('')
}

function decodeBasicHtmlEntities (value) {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|amp|lt|gt|quot|apos);/gi, (entity, decimal, hexadecimal) => {
    if (decimal || hexadecimal) {
      const codePoint = Number.parseInt(decimal || hexadecimal, hexadecimal ? 16 : 10)
      if (
        Number.isSafeInteger(codePoint) &&
        codePoint >= 0 &&
        codePoint <= 0x10ffff &&
        !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return String.fromCodePoint(codePoint)
      }
      return ''
    }

    return {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&apos;': "'"
    }[entity.toLowerCase()] || entity
  })
}
