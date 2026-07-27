export const MAX_BROWSER_DOWNLOADS = 200
export const BROWSER_DOWNLOAD_SORTS = new Set([
  'newest',
  'oldest',
  'name',
  'size'
])

const DOWNLOAD_STATUSES = new Set([
  'pending',
  'running',
  'paused',
  'complete',
  'failed'
])

export function normalizeBrowserDownloadUrl (url) {
  if (typeof url !== 'string' || url.length > 4096) return null

  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    if (parsed.username || parsed.password) return null
    return parsed.href
  } catch {
    return null
  }
}

export function normalizeBrowserDownloads (downloads) {
  if (!Array.isArray(downloads)) return []

  const normalized = []

  for (const download of downloads) {
    if (!download || typeof download !== 'object') continue
    const id = truncateUnicode(String(download.id || ''), 4096)
    const name = truncateUnicode(String(download.name || '').trim(), 255)
    const status = DOWNLOAD_STATUSES.has(download.status)
      ? download.status
      : 'failed'
    const size = Number.isFinite(download.size) && download.size >= 0
      ? download.size
      : 0
    const createdAt = Number.isFinite(download.createdAt) && download.createdAt >= 0
      ? download.createdAt
      : 0

    if (!id || !name) continue

    normalized.push({
      id,
      name,
      status,
      size,
      createdAt
    })
    normalized.sort(compareNewest)
    if (normalized.length > MAX_BROWSER_DOWNLOADS) normalized.pop()
  }

  return disambiguateBrowserDownloadNames(normalized)
}

export function sortBrowserDownloads (downloads, sort = 'newest') {
  if (!Array.isArray(downloads)) return []

  const normalizedSort = BROWSER_DOWNLOAD_SORTS.has(sort) ? sort : 'newest'
  return [...downloads].sort((left, right) => {
    if (normalizedSort === 'oldest') {
      return compareNumbers(left.createdAt, right.createdAt) || compareIds(left, right)
    }
    if (normalizedSort === 'name') {
      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: 'base'
      }) || compareNewest(left, right)
    }
    if (normalizedSort === 'size') {
      return compareNumbers(right.size, left.size) || compareNewest(left, right)
    }

    return compareNewest(left, right)
  })
}

function truncateUnicode (value, limit) {
  return Array.from(value).slice(0, limit).join('')
}

export function disambiguateBrowserDownloadNames (downloads) {
  const nameCounts = new Map()

  return downloads.map((download) => {
    const normalizedName = download.name.toLocaleLowerCase()
    const count = nameCounts.get(normalizedName) || 0
    nameCounts.set(normalizedName, count + 1)

    if (count === 0) return download
    return {
      ...download,
      name: addFilenameSuffix(download.name, count)
    }
  })
}

export function createUniqueDownloadFilename (name, existingNames) {
  const normalizedName = normalizeLocalDownloadFilename(name)
  const normalizedExistingNames = new Set(
    Array.from(existingNames || [], (existingName) => String(existingName).toLocaleLowerCase())
  )
  if (!normalizedExistingNames.has(normalizedName.toLocaleLowerCase())) return normalizedName

  for (let count = 1; count <= MAX_BROWSER_DOWNLOADS; count += 1) {
    const candidate = addFilenameSuffix(normalizedName, count)
    if (!normalizedExistingNames.has(candidate.toLocaleLowerCase())) return candidate
  }

  return addFilenameSuffix(normalizedName, Date.now())
}

function normalizeLocalDownloadFilename (name) {
  const normalized = Array.from(String(name || 'download'))
    .map((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint < 32 || codePoint === 127 || '"\\/'.includes(character)
        ? '_'
        : character
    })
    .join('')
    .trim()

  return truncateUnicode(normalized || 'download', 255)
}

function addFilenameSuffix (name, count) {
  const dotIndex = name.lastIndexOf('.')
  const hasExtension = dotIndex > 0 && dotIndex < name.length - 1
  const stem = hasExtension ? name.slice(0, dotIndex) : name
  const extension = hasExtension ? name.slice(dotIndex) : ''
  const suffix = ` (${count})`
  const maximumStemLength = Math.max(1, 255 - Array.from(`${suffix}${extension}`).length)
  return `${truncateUnicode(stem, maximumStemLength)}${suffix}${extension}`
}

function compareNewest (left, right) {
  return compareNumbers(right.createdAt, left.createdAt) || compareIds(left, right)
}

function compareIds (left, right) {
  return String(left.id).localeCompare(String(right.id), undefined, {
    numeric: true,
    sensitivity: 'base'
  })
}

function compareNumbers (left, right) {
  const normalizedLeft = Number.isFinite(left) ? left : 0
  const normalizedRight = Number.isFinite(right) ? right : 0
  return normalizedLeft - normalizedRight
}
