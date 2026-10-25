import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

import { LANGUAGES } from '../../app/i18n/languages.mjs'
import { pluralCategory } from '../../app/i18n/plural.mjs'
import { PEERTUNES_OWN_KEYS, createPeerTunesLanguageScript, peertunesEntries, peertunesStringKeys } from '../../app/peertunes/peertunes-screen.mjs'
import { collectPeerTunesStrings, collectStrings, peertunesSourceFiles, scanSource } from '../../scripts/i18n.mjs'

// PeerTunes stayed English on a phone set to any other language. It is a web
// page the app serves, so the app now hands it its words in the language
// picked, before it loads and again on a switch, and it shows them.
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const json = (path) => JSON.parse(read(path))
const require = createRequire(import.meta.url)

test('peertunes-strings.json lists what PeerTunes shows, and strings.json has it too', () => {
  const files = peertunesSourceFiles()
  assert.ok(files.some((file) => file.endsWith('ui.js')) && files.some((file) => file.endsWith('welcome.js')))
  const peertunes = collectPeerTunesStrings()
  assert.deepEqual(peertunes.problems, [])
  assert.ok(peertunes.strings.length > 150)
  assert.deepEqual(json('app/i18n/peertunes-strings.json'), { strings: peertunes.strings, plurals: peertunes.plurals }, 'run node scripts/i18n.mjs --write')
  const all = collectStrings()
  for (const text of peertunes.strings) assert.ok(all.strings.includes(text), text)
  for (const forms of peertunes.plurals) assert.ok(all.plurals.some((item) => item.other === forms.other), forms.other)
  // Names stay as they are.
  assert.ok(!peertunes.strings.includes('PeerTunes'))
})

test('a PeerTunes script is read when it takes its words from PT.i18n', () => {
  const head = 'const { t, tp } = PT.i18n || require("./i18n.js").i18n;\n'
  const found = scanSource(head + [
    't("Music")',
    'tp({ one: "{count} song", other: "{count} songs" }, n)',
    't(label)'
  ].join('\n'), 'assets/peertunes/js/ui.js', { peertunes: true })
  assert.deepEqual(found.strings, ['Music'])
  assert.deepEqual(found.plurals, [{ one: '{count} song', other: '{count} songs' }])
  assert.equal(found.problems.length, 1)
  assert.deepEqual(scanSource('t("Music")', 'assets/peertunes/js/wheel.js', { peertunes: true }).strings, [])
})

test('the page gets its language and words before it loads, and a switch while it is open', () => {
  const strings = { Music: `Musik${String.fromCharCode(0x2028)}` }
  const script = createPeerTunesLanguageScript({ language: 'de', strings })
  // The line separator would end a JavaScript string, so it goes in escaped.
  assert.ok(!script.includes(String.fromCharCode(0x2028)))

  const before = { window: {} }
  vm.runInNewContext(script, before)
  assert.equal(before.window.peerskyTunes.language, 'de')
  assert.equal(before.window.peerskyTunes.strings.Music, strings.Music)

  const switched = []
  const open = { window: { PT: { setLanguage: (config) => switched.push(config.language) } } }
  vm.runInNewContext(script, open)
  assert.deepEqual(switched, ['de'])

  const fallback = { window: {} }
  vm.runInNewContext(createPeerTunesLanguageScript({ language: '', strings: ['x'] }), fallback)
  assert.equal(fallback.window.peerskyTunes.language, 'en')
  assert.deepEqual({ ...fallback.window.peerskyTunes.strings }, {})

  assert.deepEqual(peertunesStringKeys({ strings: ['A', 'A', 1], plurals: [{ one: 'x', other: 'B' }, null] }), ['A', 'B', 'Albums (music)', 'Shuffle (music)'])
})

// PeerSky's own screens use Albums for photos and Shuffle for a new name, and
// most catalogs said so: 相册 and 换一个 in Chinese, Sortear in Portuguese. The
// player asks for the same English words and means music.
test('PeerTunes gets the music meaning of words PeerSky uses for something else', () => {
  assert.deepEqual({ ...PEERTUNES_OWN_KEYS }, { Albums: 'Albums (music)', Shuffle: 'Shuffle (music)' })
  const entries = peertunesEntries({ Albums: '相册', 'Albums (music)': '专辑', Shuffle: '换一个', 'Shuffle (music)': '随机播放', Music: '音乐' })
  assert.deepEqual(entries, { Albums: '专辑', Shuffle: '随机播放', Music: '音乐' })
  // A catalog without one keeps the shared word.
  assert.deepEqual(peertunesEntries({ Albums: 'Alben' }), { Albums: 'Alben' })

  const zh = json('app/i18n/locales/zh-Hans.json')
  assert.equal(peertunesEntries(zh).Albums, zh['Albums (music)'])
  for (const own of Object.values(PEERTUNES_OWN_KEYS)) assert.ok(collectStrings().strings.includes(own), own)
})

test('the screen hands PeerTunes the words it uses, and a switch without a reload', () => {
  const screen = read('app/peertunes/PeerTunesScreen.tsx')
  assert.match(screen, /const PEERTUNES_STRING_KEYS = peertunesStringKeys\(peertunesStrings\)/)
  assert.match(screen, /createPeerTunesLanguageScript\(\{ language, strings: peertunesEntries\(catalogEntries\(PEERTUNES_STRING_KEYS\)\) \}\)/)
  // Subscribed, so a switch re-renders it wherever it sits.
  assert.match(screen, /\n {2}useT\(\)\n/)
  assert.match(screen, /if \(pageLanguageRef\.current === language\) return\s+pageLanguageRef\.current = language\s+webViewRef\.current\?\.injectJavaScript\(languageScript\)/)
  // The language is not in the key, so a switch does not stop the song.
  assert.match(screen, /key=\{`\$\{pageUrl\}:\$\{reloadNonce\}:\$\{tokenRun\.run\}`\}/)

  const main = read('assets/peertunes/js/main.js')
  assert.match(main, /PT\.setLanguage = \(config\) => \{\s+PT\.i18n\.setup\(config\);\s+applyLanguage\(\);\s+ui\.retranslate\(\);/)
  const html = read('assets/peertunes/index.html')
  assert.ok(html.indexOf('./js/i18n.js') < html.indexOf('./js/library.js'))
})

test('PeerTunes counts the way the app does in every language', () => {
  const file = require.resolve('../../assets/peertunes/js/i18n.js')
  delete require.cache[file]
  const { i18n } = require(file)
  for (const { code } of LANGUAGES) {
    for (let n = 0; n <= 250; n++) assert.equal(i18n.pluralCategory(code, n), pluralCategory(code, n), `${code} ${n}`)
  }
})
