export const FILTER_LIST_SCHEMA_VERSION = 1
export const FILTER_LIST_UPDATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_FILTER_LIST_BYTES = 12 * 1024 * 1024
export const MIN_FILTER_LIST_BYTES = 1024

export const FILTER_LIST_SOURCES = Object.freeze([
  Object.freeze({
    id: 'easylist',
    title: 'EasyList',
    url: 'https://easylist.to/easylist/easylist.txt'
  }),
  Object.freeze({
    id: 'easyprivacy',
    title: 'EasyPrivacy',
    url: 'https://easylist.to/easylist/easyprivacy.txt'
  })
])

const SOURCE_BY_ID = new Map(FILTER_LIST_SOURCES.map((source) => [source.id, source]))
const SNAPSHOT_NAME_PATTERN = /^snapshot-[0-9]+$/

export function shouldUpdateFilterLists (state, now = Date.now()) {
  const normalized = normalizeFilterListState(state)
  if (!normalized) return true
  if (!Number.isFinite(now) || now < normalized.updatedAt) return true
  return now - normalized.updatedAt >= FILTER_LIST_UPDATE_INTERVAL_MS
}

export function validateFilterListSnapshot ({
  id,
  byteLength,
  preamble
}) {
  if (!SOURCE_BY_ID.has(id)) {
    return { ok: false, error: 'Unknown filter list.' }
  }
  if (!Number.isSafeInteger(byteLength) || byteLength < MIN_FILTER_LIST_BYTES) {
    return { ok: false, error: 'Filter list is unexpectedly small.' }
  }
  if (byteLength > MAX_FILTER_LIST_BYTES) {
    return { ok: false, error: 'Filter list exceeds the size limit.' }
  }
  if (typeof preamble !== 'string' || !/^(?:\uFEFF|\u00EF\u00BB\u00BF)?\s*\[Adblock(?: Plus)?[^\]]*\]/i.test(preamble)) {
    return { ok: false, error: 'Filter list has an invalid header.' }
  }

  return { ok: true }
}

export function isSafeFilterListResponseUrl (responseUrl, sourceUrl) {
  try {
    const parsed = new URL(responseUrl || sourceUrl)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

export function parseFilterListState (serialized) {
  let value

  try {
    value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized
  } catch {
    return null
  }

  return normalizeFilterListState(value)
}

export function serializeFilterListState (state) {
  const normalized = normalizeFilterListState(state)
  if (!normalized) throw new TypeError('Invalid filter-list state.')
  return JSON.stringify(normalized)
}

function normalizeFilterListState (value) {
  if (value?.schemaVersion !== FILTER_LIST_SCHEMA_VERSION) return null
  if (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) return null
  if (!SNAPSHOT_NAME_PATTERN.test(value.snapshotName || '')) return null
  if (!Array.isArray(value.lists) || value.lists.length !== FILTER_LIST_SOURCES.length) return null

  const records = new Map()
  for (const record of value.lists) {
    const source = SOURCE_BY_ID.get(record?.id)
    if (!source || records.has(source.id)) return null
    if (record.url !== source.url) return null
    if (record.filename !== `${source.id}.txt`) return null
    if (!Number.isSafeInteger(record.byteLength) || record.byteLength < MIN_FILTER_LIST_BYTES) return null
    if (record.byteLength > MAX_FILTER_LIST_BYTES) return null

    records.set(source.id, {
      id: source.id,
      url: source.url,
      filename: record.filename,
      byteLength: record.byteLength
    })
  }

  return {
    schemaVersion: FILTER_LIST_SCHEMA_VERSION,
    updatedAt: value.updatedAt,
    snapshotName: value.snapshotName,
    lists: FILTER_LIST_SOURCES.map((source) => records.get(source.id))
  }
}
