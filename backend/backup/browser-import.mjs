import b4a from 'b4a'

// Tabs and bookmarks that arrive from the desktop browser.
//
// The desktop keeps its tabs keyed by window and its bookmarks in its own
// shape, and the phone cannot read either. Restoring desktop tabs.json over
// the phone's browser-tabs.json used to leave the phone with one empty tab:
// its own tabs gone, and none of the desktop's. These are turned into a plain
// list instead, and the app adds them to what is already open the next time
// it starts, so nothing on the phone is lost.
export const INCOMING_TABS_FILE = 'incoming-tabs.json'
export const INCOMING_BOOKMARKS_FILE = 'incoming-bookmarks.json'

const MAX_IMPORTED_TABS = 50
const MAX_IMPORTED_BOOKMARKS = 200
const MAX_URL_LENGTH = 8192
const MAX_TITLE_LENGTH = 256

/**
 * Desktop tabs.json is { [windowId]: { tabs: [{ url, title }], ... } }.
 * Returns the incoming-tabs.json text, or null when nothing is worth adding.
 */
export function convertDesktopTabs (text, { now = Date.now() } = {}) {
  const parsed = parseJson(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const tabs = []
  const seen = new Set()
  for (const windowState of Object.values(parsed)) {
    if (!windowState || !Array.isArray(windowState.tabs)) continue
    for (const tab of windowState.tabs) {
      const entry = normalizeEntry(tab?.url, tab?.title)
      if (!entry || seen.has(entry.url)) continue
      seen.add(entry.url)
      tabs.push(entry)
      if (tabs.length === MAX_IMPORTED_TABS) break
    }
    if (tabs.length === MAX_IMPORTED_TABS) break
  }

  if (tabs.length === 0) return null
  return JSON.stringify({ version: 1, source: 'desktop', receivedAt: now, tabs })
}

/**
 * Desktop bookmarks.json is [{ url, title, dateAdded }].
 */
export function convertDesktopBookmarks (text, { now = Date.now() } = {}) {
  const parsed = parseJson(text)
  if (!Array.isArray(parsed)) return null

  const bookmarks = []
  const seen = new Set()
  for (const bookmark of parsed) {
    const entry = normalizeEntry(bookmark?.url, bookmark?.title)
    if (!entry || seen.has(entry.url)) continue
    seen.add(entry.url)
    const added = Date.parse(bookmark?.dateAdded)
    bookmarks.push({ ...entry, createdAt: Number.isFinite(added) ? added : now })
    if (bookmarks.length === MAX_IMPORTED_BOOKMARKS) break
  }

  if (bookmarks.length === 0) return null
  return JSON.stringify({ version: 1, source: 'desktop', receivedAt: now, bookmarks })
}

// Desktop-only pages (peersky://settings and the rest) would open to nothing
// on the phone, so only addresses the phone can load come across.
export function isImportableUrl (url) {
  if (typeof url !== 'string' || !url || url.length > MAX_URL_LENGTH) return false
  return /^(?:https?|hyper):\/\/[^\s]+$/i.test(url)
}

function normalizeEntry (url, title) {
  if (!isImportableUrl(url)) return null
  const cleanTitle = typeof title === 'string'
    ? Array.from(title.replace(/\s+/g, ' ').trim()).slice(0, MAX_TITLE_LENGTH).join('')
    : ''
  return { url, title: cleanTitle || url }
}

function parseJson (text) {
  try {
    return JSON.parse(typeof text === 'string' ? text : b4a.toString(text, 'utf8'))
  } catch {
    return null
  }
}
