import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { foldText, itemMatches, kindOf, SEARCH_AFTER, showsSearch } from '../../app/hyperdrive/list-filter.mjs'

// The same rules as the Hyperdrive app in PeerSky Desktop (list-filter.js in
// the hyperdrive repo), with the same cases.
const items = [
  { kind: 'file', name: 'Résumé 2026.pdf' },
  { kind: 'folder', name: 'Holiday photos' },
  { kind: 'file', name: 'holiday.mov' },
  { kind: 'file', name: 'ÉTÉ.jpg' },
  { kind: 'folder', name: 'Notes' }
]
const names = (filter) => items.filter((item) => itemMatches(item, filter)).map((item) => item.name)

test('the filter picks files, folders or both', () => {
  assert.deepEqual(names({ kind: 'all' }), items.map((item) => item.name))
  assert.deepEqual(names({ kind: 'file' }), ['Résumé 2026.pdf', 'holiday.mov', 'ÉTÉ.jpg'])
  assert.deepEqual(names({ kind: 'folder' }), ['Holiday photos', 'Notes'])
  assert.equal(kindOf('uploaded'), 'all')
})

test('search finds a name whatever its case and accents, by every word typed', () => {
  assert.deepEqual(names({ query: 'holiday' }), ['Holiday photos', 'holiday.mov'])
  assert.deepEqual(names({ query: 'resume' }), ['Résumé 2026.pdf'])
  assert.deepEqual(names({ query: 'été' }), ['ÉTÉ.jpg'])
  assert.deepEqual(names({ query: '  photos   holi ' }), ['Holiday photos'])
  assert.deepEqual(names({ query: 'holiday', kind: 'file' }), ['holiday.mov'])
  assert.deepEqual(names({ query: '   ' }), items.map((item) => item.name))
  assert.equal(foldText('ＡＢＣ'), 'abc')
  // Hindi and Japanese names are found as typed.
  assert.equal(itemMatches({ kind: 'file', name: 'यात्रा फ़ोटो.jpg' }, { query: 'फ़ोटो' }), true)
  assert.equal(itemMatches({ kind: 'file', name: '旅行の写真.jpg' }, { query: '写真' }), true)
})

test('the search box comes up past ten, and stays while something is typed', () => {
  assert.equal(SEARCH_AFTER, 10)
  assert.equal(showsSearch(10), false)
  assert.equal(showsSearch(11), true)
  assert.equal(showsSearch(2, 'a'), true)
})

test('the Hyperdrive screen filters Recent and folders, and searches past ten', async () => {
  const screen = await readFile(new URL('../../app/hyperdrive/HyperdriveScreen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /\{ id: 'file', label: msg\('Files'\) \},\n\s+\{ id: 'folder', label: msg\('Folders'\) \}\n\]/)
  assert.match(screen, /const searchShown = showsSearch\(listedItems\.length, query\)/)
  assert.match(screen, /\{ kind: kindFilter, query: searchShown \? query : '' \}/)
  // A new folder starts with everything shown and nothing searched.
  assert.match(screen, /setQuery\(''\)\n\s+setFolderFilter\('all'\)\n\s+setFolderFilterVisible\(false\)\n\s+\}, \[location\?\.url\]\)/)
  // Nothing left says why, rather than looking empty.
  assert.match(screen, /t\('Nothing here matches "\{query\}"\.', \{ query: query\.trim\(\) \}\)/)
  assert.match(screen, /kindFilter === 'folder' \? t\('No folders here\.'\) : t\('No files here\.'\)/)
})
