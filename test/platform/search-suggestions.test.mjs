import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  canSuggestSearches,
  getOneOffSearchEngines,
  getSearchSuggestionUrl,
  MAX_SEARCH_SUGGESTIONS,
  parseSearchSuggestions
} from '../../app/search/search-suggestions.mjs'
import { parseBrowserPreferences } from '../../app/settings/browser-preferences.mjs'

// The address bar suggests searches as you type, from the engine you search
// with, and can search with another engine just once.

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('each engine is asked at its own suggestion address, and a custom one is not asked', () => {
  assert.equal(getSearchSuggestionUrl('duckduckgo', ' peer to peer '), 'https://duckduckgo.com/ac/?type=list&q=peer%20to%20peer')
  assert.equal(getSearchSuggestionUrl('duckduckgo-noai', 'peer'), 'https://noai.duckduckgo.com/ac/?type=list&q=peer')
  assert.equal(getSearchSuggestionUrl('startpage', 'peer'), 'https://www.startpage.com/osuggestions?q=peer')
  assert.equal(getSearchSuggestionUrl('ecosia', 'peer'), 'https://ac.ecosia.org/autocomplete?type=list&q=peer')
  assert.equal(getSearchSuggestionUrl('kagi', 'peer'), 'https://kagi.com/api/autosuggest?q=peer')
  assert.equal(getSearchSuggestionUrl('custom', 'peer'), null)
  assert.equal(getSearchSuggestionUrl('nobody', 'peer'), null)
})

test('only searches are sent: never from incognito, never an address, an email or a key', () => {
  for (const text of ['peer to peer', 'weather', 'node.js tutorial', 'note: buy milk', 'c++ lambda']) {
    assert.equal(canSuggestSearches(text), true, text)
  }
  assert.equal(canSuggestSearches('weather', { incognito: true }), false)
  assert.equal(canSuggestSearches('weather', { enabled: false }), false)
  for (const text of [
    'w',
    '',
    'https://example.com/a',
    'hyper://blog',
    'localhost:8080',
    'mailto:ada@example.com',
    'github.com',
    'example.com/private/page',
    'ada@example.com',
    'yry4kh9kd3zc4nqhpd4q1ub5gwnemx1wkgfmmmezsmnihr4tt7ky',
    'a'.repeat(64),
    'x '.repeat(70)
  ]) {
    assert.equal(canSuggestSearches(text), false, text)
  }
})

test('an answer is cleaned up: no repeats, nothing that repeats what was typed, at most five', () => {
  const body = JSON.stringify(['peer', ['peer', 'Peer review', 'peer review', 'peer\u202e gynt', '  peer   pressure ', 7, '', 'a', 'b', 'c', 'd']])
  const suggestions = parseSearchSuggestions(body, 'Peer')
  assert.deepEqual(suggestions, ['Peer review', 'peer gynt', 'peer pressure', 'a', 'b'])
  assert.equal(suggestions.length, MAX_SEARCH_SUGGESTIONS)
  assert.deepEqual(parseSearchSuggestions('not json', 'peer'), [])
  assert.deepEqual(parseSearchSuggestions({ results: [] }, 'peer'), [])
  assert.deepEqual(parseSearchSuggestions(['peer', 'oops'], 'peer'), [])
})

test('the other engines are offered for one search, a custom one by its site once it has an address', () => {
  assert.deepEqual(getOneOffSearchEngines('duckduckgo').map((engine) => engine.id), ['duckduckgo-noai', 'startpage', 'ecosia', 'kagi'])
  assert.deepEqual(getOneOffSearchEngines('kagi', 'https://www.search.example/find?q=%s').at(-1), { id: 'custom', title: 'search.example' })
  assert.ok(!getOneOffSearchEngines('custom', 'https://search.example/?q=%s').some((engine) => engine.id === 'custom'))
})

test('suggestions are on unless turned off, and asked for without cookies only while typing', async () => {
  assert.equal(parseBrowserPreferences({}).searchSuggestionsEnabled, true)
  assert.equal(parseBrowserPreferences({ searchSuggestionsEnabled: false }).searchSuggestionsEnabled, false)

  const hook = await read('app/search/useSearchSuggestions.ts')
  assert.match(hook, /credentials: 'omit'/)
  const toolbar = await read('app/BrowserToolbar.tsx')
  assert.match(toolbar, /useSearchSuggestions\(address, \{\s+active: isAddressFocused,\s+enabled: searchSuggestionsEnabled,\s+incognito: isIncognito,/)
  const general = await read('app/settings/General.tsx')
  assert.match(general, /title='Search suggestions'/)
})
