import { parseHyperUrl } from './url.mjs'

export const MAX_HYPER_ARCHIVE_ENTRIES = 500
const DEFAULT_PAGE_SIZE = 5
const MAX_PAGE_SIZE = 20
const MAX_NAME_LENGTH = 160

export function parseHyperArchive (value) {
  if (typeof value !== 'string' || !value) return []

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed?.items)) return []
    return parsed.items
      .map(normalizeHyperArchiveEntry)
      .filter(Boolean)
      .slice(0, MAX_HYPER_ARCHIVE_ENTRIES)
  } catch {
    return []
  }
}

export function serializeHyperArchive (items) {
  return JSON.stringify({
    items: items
      .map(normalizeHyperArchiveEntry)
      .filter(Boolean)
      .slice(0, MAX_HYPER_ARCHIVE_ENTRIES)
  })
}

export function recordHyperArchiveItem (items, candidate, now = Date.now()) {
  const entry = normalizeHyperArchiveEntry({ ...candidate, updatedAt: now })
  if (!entry) return items

  const existing = items.find((item) => item.url === entry.url)
  const nextEntry = existing?.source === 'published' && entry.source === 'fetched'
    ? { ...entry, source: 'published', appId: existing.appId, name: existing.name }
    : entry

  return [
    nextEntry,
    ...items.filter((item) => item.url !== nextEntry.url)
  ].slice(0, MAX_HYPER_ARCHIVE_ENTRIES)
}

// Long enough for a drive key, which is the other thing someone pastes in here
// besides a name.
export const MAX_HYPER_ARCHIVE_QUERY_LENGTH = 128

export function normalizeHyperArchiveQuery (value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase()
    .slice(0, MAX_HYPER_ARCHIVE_QUERY_LENGTH)
}

export function listHyperArchiveItems (
  items,
  { page = 1, pageSize = DEFAULT_PAGE_SIZE, query = '', source = 'all' } = {}
) {
  const normalizedSource = source === 'published' || source === 'fetched' ? source : 'all'
  // Searching before paging, so a match on the last page is still found from
  // the first one. The archive holds at most a few hundred entries, so this
  // stays a pass over an array.
  const normalizedQuery = normalizeHyperArchiveQuery(query)
  const filtered = items.filter((item) => (
    (normalizedSource === 'all' || item.source === normalizedSource) &&
    (!normalizedQuery || matchesHyperArchiveQuery(item, normalizedQuery))
  ))
  const normalizedPageSize = Math.min(normalizePositiveInteger(pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(filtered.length / normalizedPageSize))
  const normalizedPage = Math.min(normalizePositiveInteger(page, 1), totalPages)
  const start = (normalizedPage - 1) * normalizedPageSize

  return {
    items: filtered.slice(start, start + normalizedPageSize),
    page: normalizedPage,
    pageSize: normalizedPageSize,
    query: normalizedQuery,
    source: normalizedSource,
    total: filtered.length,
    totalPages
  }
}

function matchesHyperArchiveQuery (item, query) {
  return String(item.name || '').toLocaleLowerCase().includes(query) ||
    String(item.url || '').toLocaleLowerCase().includes(query)
}

export function removeHyperArchiveItems (items, { appId, source } = {}) {
  if (!appId && !source) return items

  return items.filter((item) => {
    const matchesApp = !appId || item.appId === appId
    const matchesSource = !source || item.source === source
    return !(matchesApp && matchesSource)
  })
}

function normalizeHyperArchiveEntry (value) {
  if (!value || typeof value !== 'object') return null
  const target = parseHyperUrl(value.url)
  if (target.error || target.driveAddress === 'default') return null

  const source = value.source === 'published'
    ? 'published'
    : value.source === 'fetched'
      ? 'fetched'
      : null
  if (!source) return null

  const updatedAt = Number(value.updatedAt)
  const url = createHyperUrl(target.driveAddress, target.pathname)

  return {
    url,
    driveUrl: target.driveAddress,
    name: normalizeName(value.name) || getDefaultName(target),
    source,
    appId: normalizeAppId(value.appId),
    updatedAt: Number.isSafeInteger(updatedAt) && updatedAt > 0 ? updatedAt : Date.now()
  }
}

function createHyperUrl (driveAddress, pathname) {
  const encodedPath = pathname
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${driveAddress.slice(0, -1)}${encodedPath}`
}

function normalizeName (value) {
  if (typeof value !== 'string') return ''
  return Array.from(value.trim())
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && (code < 127 || code > 159)
    })
    .join('')
    .slice(0, MAX_NAME_LENGTH)
}

function normalizeAppId (value) {
  return value === 'p2pmd' || value === 'hyperdrive' ? value : undefined
}

function getDefaultName (target) {
  const pathname = target.pathname.replace(/\/$/, '')
  if (pathname) {
    try {
      return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)).slice(0, MAX_NAME_LENGTH)
    } catch {}
  }

  const hostname = target.driveAddress.slice('hyper://'.length, -1)
  return `${hostname.slice(0, 8)}...${hostname.slice(-6)}`
}

function normalizePositiveInteger (value, fallback) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}
