import { CUSTOM_SEARCH_QUERY_PLACEHOLDER, normalizeCustomSearchUrl } from '../browser-shell.mjs'
import { SEARCH_ENGINES } from '../settings/browser-preferences.mjs'

// What the search engine suggests while you type in the address bar. Each one
// is the engine's own suggestion address, and each answers the same way: what
// was typed, then a list of searches. A custom engine has none we know of, so
// it suggests nothing.
const SEARCH_SUGGESTION_URLS = {
  duckduckgo: 'https://duckduckgo.com/ac/?type=list&q=',
  'duckduckgo-noai': 'https://noai.duckduckgo.com/ac/?type=list&q=',
  startpage: 'https://www.startpage.com/osuggestions?q=',
  ecosia: 'https://ac.ecosia.org/autocomplete?type=list&q=',
  kagi: 'https://kagi.com/api/autosuggest?q='
}

export const MAX_SEARCH_SUGGESTIONS = 5
// Two letters before asking, and not much more than a sentence: anything
// longer was pasted in, and is nobody's search.
export const MIN_SEARCH_SUGGESTION_QUERY_LENGTH = 2
export const MAX_SEARCH_SUGGESTION_QUERY_LENGTH = 120
const MAX_SEARCH_SUGGESTION_LENGTH = 200

export function getSearchSuggestionUrl (searchEngine, query) {
  const base = SEARCH_SUGGESTION_URLS[searchEngine]
  return base ? `${base}${encodeURIComponent(String(query || '').trim())}` : null
}

/**
 * Whether what is in the address bar may go to the search engine while it is
 * typed. Never from an incognito tab, and never when it looks like an address,
 * an email address or a key: those can be private, and the bar opens them
 * rather than searching for them anyway.
 */
export function canSuggestSearches (text, { enabled = true, incognito = false } = {}) {
  const query = String(text || '').trim()
  if (!enabled || incognito) return false
  if (query.length < MIN_SEARCH_SUGGESTION_QUERY_LENGTH || query.length > MAX_SEARCH_SUGGESTION_QUERY_LENGTH) return false
  // hyper://, https://, mailto:, localhost:8080. A colon and a space after it
  // is a sentence, not an address.
  if (/^[a-z][a-z0-9+.-]*:\S/i.test(query)) return false
  // One word with a dot, a slash or an @ in it: a site, a path or an email.
  if (!/\s/.test(query) && /[./@]/.test(query)) return false
  // A drive or room key, with or without its scheme.
  if (/[a-z0-9]{32,}/i.test(query)) return false
  return true
}

/**
 * The searches in an engine's answer, cleaned up: no repeats, nothing that
 * only repeats what was typed, no control characters, and at most five.
 */
export function parseSearchSuggestions (body, query) {
  let value = body
  if (typeof body === 'string') {
    try {
      value = JSON.parse(body)
    } catch {
      return []
    }
  }

  const list = Array.isArray(value) && Array.isArray(value[1]) ? value[1] : []
  const seen = new Set([String(query || '').trim().toLowerCase()])
  const suggestions = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const text = Array.from(item).filter(isShownCharacter).join('').replace(/\s+/g, ' ').trim()
    const key = text.toLowerCase()
    if (!text || text.length > MAX_SEARCH_SUGGESTION_LENGTH || seen.has(key)) continue
    seen.add(key)
    suggestions.push(text)
    if (suggestions.length === MAX_SEARCH_SUGGESTIONS) break
  }
  return suggestions
}

function isShownCharacter (character) {
  const codePoint = character.codePointAt(0)
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

/**
 * The engines to search with just this once, below the suggestions: every one
 * but the one chosen in Settings, and a custom one only once it has an
 * address, named by its site.
 */
export function getOneOffSearchEngines (searchEngine, customSearchUrl = '') {
  const customUrl = normalizeCustomSearchUrl(customSearchUrl)
  return SEARCH_ENGINES.flatMap((engine) => {
    if (engine.id === searchEngine) return []
    if (engine.id !== 'custom') return [{ id: engine.id, title: engine.title }]
    if (!customUrl) return []
    const host = new URL(customUrl.replaceAll(CUSTOM_SEARCH_QUERY_PLACEHOLDER, 'q')).hostname
    return [{ id: engine.id, title: host.replace(/^www[.]/, '') }]
  })
}
