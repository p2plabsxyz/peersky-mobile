import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getSearchUrl, normalizeCustomSearchUrl } from '../../app/browser-shell.mjs'
import { KNOWN_SEARCH_ENGINES } from '../../app/settings/search-engine-list.mjs'
import { findSearchEngines, MAX_SEARCH_ENGINE_MATCHES, searchEngineForUrl } from '../../app/settings/search-engine-match.mjs'

const general = await readFile(new URL('../../app/settings/General.tsx', import.meta.url), 'utf8')
const credits = JSON.parse(await readFile(new URL('../../scripts/third-party/credits.json', import.meta.url), 'utf8'))
const names = (list) => list.map((engine) => engine.name)

test('every known engine is a search URL Custom takes as it is, each once', () => {
  assert.ok(KNOWN_SEARCH_ENGINES.length >= 30)
  const urls = new Set()
  const seen = new Set()
  for (const engine of KNOWN_SEARCH_ENGINES) {
    assert.equal(typeof engine.name, 'string')
    assert.ok(engine.name.trim() === engine.name && engine.name.length > 0, engine.name)
    assert.equal(normalizeCustomSearchUrl(engine.url), engine.url, engine.name)
    assert.equal(engine.url.split('%s').length, 2, `${engine.name} has one %s`)
    assert.doesNotMatch(engine.url, /\{|\}/, `${engine.name} has no Chromium placeholders left`)
    assert.ok(!urls.has(engine.url), `${engine.url} is listed once`)
    assert.ok(!seen.has(engine.name.toLowerCase()), `${engine.name} is listed once`)
    urls.add(engine.url)
    seen.add(engine.name.toLowerCase())
  }
})

test('a name, the start of one or its address finds the engine, best first', () => {
  assert.equal(findSearchEngines('brave')[0].name, 'Brave Search')
  assert.equal(findSearchEngines('Bra')[0].name, 'Brave Search')
  assert.equal(findSearchEngines('qwant')[0].host, 'qwant.com')
  assert.equal(findSearchEngines('mojeek')[0].name, 'Mojeek')
  assert.equal(findSearchEngines('goo')[0].name, 'Google')
  // A word inside the name, and a part of the host.
  assert.ok(names(findSearchEngines('search')).includes('Brave Search'))
  assert.equal(findSearchEngines('https://www.bing')[0].name, 'Microsoft Bing')
  assert.ok(findSearchEngines('yahoo').length > 1)
  assert.ok(findSearchEngines('a').length <= MAX_SEARCH_ENGINE_MATCHES)
})

test('a search URL, nothing or something unknown finds nothing', () => {
  assert.deepEqual(findSearchEngines('https://example.com/?q=%s'), [])
  assert.deepEqual(findSearchEngines(''), [])
  assert.deepEqual(findSearchEngines('   '), [])
  assert.deepEqual(findSearchEngines(undefined), [])
  assert.deepEqual(findSearchEngines('zzqqxx'), [])
})

test('a picked engine searches with the words typed in the address bar', () => {
  const brave = findSearchEngines('brave')[0]
  const url = getSearchUrl('custom', 'p2p & privacy', brave.url)
  assert.ok(url.startsWith('https://search.brave.com/'))
  assert.ok(url.includes('p2p%20%26%20privacy'))
  assert.equal(searchEngineForUrl(brave.url).name, 'Brave Search')
  assert.equal(searchEngineForUrl('https://example.com/?q=%s'), null)
  assert.equal(searchEngineForUrl(''), null)
})

test('Custom offers the engines a name fits, picks one on a tap or on Save, and says which is saved', () => {
  assert.match(general, /const engineMatches = isCustomSearchSaved \? \[\] : findSearchEngines\(draftUrl\)/)
  assert.match(general, /onPress=\{\(\) => pickSearchEngine\(engine\.url\)\}/)
  assert.match(general, /if \(!normalizedUrl && engineMatches\.length > 0\) \{\n\s*pickSearchEngine\(engineMatches\[0\]\.url\)/)
  assert.match(general, /t\('Searching with \{name\}', \{ name: savedEngine\.name \}\)/)
  assert.match(general, /t\('No search engine by that name\. Enter its search URL instead\.'\)/)
  // The URL keyboard has no space bar, and names have spaces.
  const input = general.slice(general.indexOf("{t('Name or search URL')}"), general.indexOf('value={draftUrl}'))
  assert.doesNotMatch(input, /keyboardType='url'/)
})

test('the list is credited to Chromium in the notices', () => {
  const entry = credits.find((item) => item.name === 'Chromium search engine list')
  assert.ok(entry)
  assert.equal(entry.license, 'BSD-3-Clause')
})
