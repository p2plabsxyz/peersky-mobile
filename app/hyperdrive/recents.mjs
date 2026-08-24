export const MAX_HYPERDRIVE_RECENTS = 100
export const MAX_HYPERDRIVE_RECENT_CHILDREN = 100
const MAX_CACHED_DIRECTORY_RECENTS = 5

export function parseHyperdriveRecents (value) {
  if (typeof value !== 'string' || !value) return []

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return boundCachedDirectories(
      parsed.map(normalizeRecent).filter(Boolean).slice(0, MAX_HYPERDRIVE_RECENTS)
    )
  } catch {
    return []
  }
}

export function recordHyperdriveRecent (recents, item, now = Date.now()) {
  const normalized = normalizeRecent({ ...item, openedAt: now })
  if (!normalized) return recents

  return boundCachedDirectories([
    normalized,
    ...recents.filter((entry) => entry.url !== normalized.url)
  ].slice(0, MAX_HYPERDRIVE_RECENTS))
}

export function removeHyperdriveRecent (recents, url) {
  return recents.filter((entry) => entry.url !== url)
}

export function serializeHyperdriveRecents (recents) {
  return JSON.stringify(boundCachedDirectories(
    recents.map(normalizeRecent).filter(Boolean).slice(0, MAX_HYPERDRIVE_RECENTS)
  ))
}

function normalizeRecent (value) {
  if (!value || typeof value !== 'object') return null
  const url = normalizeHyperUrl(value.url)
  const type = value.type === 'directory' ? 'directory' : value.type === 'file' ? 'file' : null
  if (!url || !type) return null

  const name = typeof value.name === 'string'
    ? Array.from(value.name.trim())
      .filter((character) => {
        const code = character.charCodeAt(0)
        return code >= 32 && (code < 127 || code > 159)
      })
      .join('')
      .slice(0, 160)
    : ''
  const openedAt = Number(value.openedAt)

  return {
    type,
    name: name || (type === 'directory' ? 'Hyperdrive' : 'Hyper file'),
    url,
    source: value.source === 'uploaded' ? 'uploaded' : 'fetched',
    openedAt: Number.isSafeInteger(openedAt) && openedAt > 0 ? openedAt : Date.now(),
    byteLength: type === 'file' && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0
      ? value.byteLength
      : 0,
    children: type === 'directory' && Array.isArray(value.children)
      ? value.children.map(normalizeChild).filter(Boolean).slice(0, MAX_HYPERDRIVE_RECENT_CHILDREN)
      : undefined
  }
}

function normalizeChild (value) {
  if (!value || typeof value !== 'object') return null
  const url = normalizeHyperUrl(value.url)
  const type = value.type === 'directory' ? 'directory' : value.type === 'file' ? 'file' : null
  if (!url || !type) return null

  const name = typeof value.name === 'string'
    ? Array.from(value.name.trim())
      .filter((character) => {
        const code = character.charCodeAt(0)
        return code >= 32 && (code < 127 || code > 159)
      })
      .join('')
      .slice(0, 160)
    : ''

  return {
    type,
    name: name || (type === 'directory' ? 'Folder' : 'Hyper file'),
    url,
    byteLength: type === 'file' && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0
      ? value.byteLength
      : 0
  }
}

function boundCachedDirectories (recents) {
  let cachedDirectories = 0
  return recents.map((entry) => {
    if (!entry.children?.length) return entry
    cachedDirectories += 1
    if (cachedDirectories <= MAX_CACHED_DIRECTORY_RECENTS) return entry
    const { children, ...recent } = entry
    return recent
  })
}

function normalizeHyperUrl (value) {
  if (typeof value !== 'string' || value.length > 4096) return null
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'hyper:' || !parsed.hostname || parsed.username || parsed.password) return null
    parsed.search = ''
    parsed.hash = ''
    return parsed.href
  } catch {
    return null
  }
}
