import { CUSTOM_SEARCH_QUERY_PLACEHOLDER, normalizeCustomSearchUrl } from '../browser-shell.mjs'
import { KNOWN_SEARCH_ENGINES } from './search-engine-list.mjs'

export const MAX_SEARCH_ENGINE_MATCHES = 6

// What was typed, as the names and hosts are compared: lower case, without a
// scheme or www. in front, so "https://www.qwant" finds Qwant too.
function normalizeEngineQuery (value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
}

function hostOf (url) {
  try {
    return new URL(url.replaceAll(CUSTOM_SEARCH_QUERY_PLACEHOLDER, 'q')).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// How well an engine fits what was typed, lower is better, or -1 for not at
// all: its name or host starting with it, then a word of its name or a part
// of its host starting with it, then either holding it anywhere.
function rank (engine, query) {
  const name = engine.name.toLocaleLowerCase()
  const host = engine.host
  if (name.startsWith(query) || host.startsWith(query)) return 0
  const words = name.split(/[^\p{L}\p{N}]+/u)
  const labels = host.split('.')
  if (words.some((word) => word.startsWith(query)) || labels.some((label) => label.startsWith(query))) return 1
  if (name.includes(query) || host.includes(query)) return 2
  return -1
}

const ENGINES = KNOWN_SEARCH_ENGINES.map((engine) => ({ ...engine, host: hostOf(engine.url) }))

/**
 * The known search engines whose name or address fits what was typed into
 * Custom, best first and at most a few. Nothing for a search URL, which is
 * used as it is, or for nothing typed.
 *
 * @param {string} value what is in the field
 * @returns {{ name: string, url: string, host: string }[]}
 */
export function findSearchEngines (value, limit = MAX_SEARCH_ENGINE_MATCHES) {
  if (String(value || '').includes(CUSTOM_SEARCH_QUERY_PLACEHOLDER)) return []
  const query = normalizeEngineQuery(value)
  if (!query) return []
  return ENGINES
    .map((engine, index) => ({ engine, index, score: rank(engine, query) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.engine)
}

/**
 * The known engine a saved custom URL is, if it is one, so Settings can name
 * it rather than show only its address.
 */
export function searchEngineForUrl (url) {
  const normalized = normalizeCustomSearchUrl(url)
  if (!normalized) return null
  return ENGINES.find((engine) => engine.url === normalized) || null
}
