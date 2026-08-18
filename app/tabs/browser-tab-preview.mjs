export const MAX_BROWSER_TAB_PREVIEW_FILES = 50
export const MAX_BROWSER_TAB_PREVIEW_FILE_BYTES = 2 * 1024 * 1024
export const MAX_BROWSER_TAB_PREVIEW_TOTAL_BYTES = 50 * 1024 * 1024

const MAX_PREVIEW_HEIGHT = 720
const MAX_PREVIEW_WIDTH = 360

export function getBrowserTabPreviewFilename (tabId, pageKey, revision, width, height) {
  const normalizedRevision = normalizeRevision(revision)
  const normalizedWidth = normalizeDimension(width, MAX_PREVIEW_WIDTH)
  const normalizedHeight = normalizeDimension(height, MAX_PREVIEW_HEIGHT)
  if (
    !isValidTabId(tabId) ||
    !pageKey ||
    !normalizedRevision ||
    !normalizedWidth ||
    !normalizedHeight
  ) return null

  return `preview-${tabId}-${hashPreviewKey(pageKey)}-${normalizedRevision}-${normalizedWidth}x${normalizedHeight}.jpg`
}

export function parseBrowserTabPreviewFilename (filename, tabId, pageKey) {
  if (!isValidTabId(tabId) || !pageKey || typeof filename !== 'string') return null

  const prefix = `preview-${tabId}-${hashPreviewKey(pageKey)}-`
  if (!filename.startsWith(prefix)) return null

  const match = /^(\d+)-(\d+)x(\d+)[.]jpg$/.exec(filename.slice(prefix.length))
  if (!match) return null

  const revision = normalizeRevision(Number(match[1]))
  const width = normalizeDimension(Number(match[2]), MAX_PREVIEW_WIDTH)
  const height = normalizeDimension(Number(match[3]), MAX_PREVIEW_HEIGHT)
  if (!revision || !width || !height) return null

  return {
    aspectRatio: width / height,
    height,
    revision,
    width
  }
}

export function isBrowserTabPreviewFilename (filename) {
  return /^preview-tab-\d+-[a-f0-9]{8}-\d+-\d+x\d+[.]jpg$/.test(String(filename || ''))
}

export function isBrowserTabPreviewForPage (previewPageKey, pageKey) {
  return (
    typeof previewPageKey === 'string' &&
    previewPageKey.length > 0 &&
    previewPageKey === pageKey
  )
}

export function selectRetainedBrowserTabPreviewUris (
  entries,
  maximumFiles = MAX_BROWSER_TAB_PREVIEW_FILES,
  maximumBytes = MAX_BROWSER_TAB_PREVIEW_TOTAL_BYTES
) {
  const retainedUris = new Set()
  let retainedBytes = 0

  const sortedEntries = Array.from(entries || [])
    .filter((entry) => (
      entry &&
      typeof entry.uri === 'string' &&
      isBrowserTabPreviewFilename(entry.name) &&
      Number.isFinite(entry.size) &&
      entry.size > 0 &&
      entry.size <= MAX_BROWSER_TAB_PREVIEW_FILE_BYTES
    ))
    .sort((left, right) =>
      (right.modificationTime || 0) - (left.modificationTime || 0)
    )

  for (const entry of sortedEntries) {
    if (
      retainedUris.size >= maximumFiles ||
      retainedBytes + entry.size > maximumBytes
    ) continue

    retainedUris.add(entry.uri)
    retainedBytes += entry.size
  }

  return retainedUris
}

function normalizeDimension (value, maximum) {
  return Number.isInteger(value) && value > 0 && value <= maximum ? value : null
}

function normalizeRevision (value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function isValidTabId (tabId) {
  return /^tab-\d+$/.test(String(tabId || ''))
}

function hashPreviewKey (value) {
  let hash = 2166136261
  const input = String(value)

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}
