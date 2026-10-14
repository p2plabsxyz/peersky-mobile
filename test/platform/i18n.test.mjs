import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { msg, registerCatalogs, setLanguage, t, tKey, tp } from '../../app/i18n/i18n.mjs'
import { LANGUAGE_CODES, LANGUAGES, SOURCE_LANGUAGE, SYSTEM_LANGUAGE, isRtlLanguage, matchLanguage } from '../../app/i18n/languages.mjs'
import { INFO_PLIST_TEXT } from '../../app/i18n/native-strings.mjs'
import { PLURAL_CATEGORIES, pluralCategory } from '../../app/i18n/plural.mjs'
import { parseBrowserPreferences } from '../../app/settings/browser-preferences.mjs'
import { checkCatalog, collectStrings, readCatalog, scanSource } from '../../scripts/i18n.mjs'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const json = (path) => JSON.parse(read(path))

test('a phone language is matched to one PeerSky has, or English', () => {
  assert.equal(matchLanguage(['mr-IN', 'en-IN']), 'mr')
  assert.equal(matchLanguage(['sa']), 'sa')
  assert.equal(matchLanguage(['hi_IN']), 'hi')
  // Brazilian Portuguese stands for Portuguese everywhere.
  assert.equal(matchLanguage(['pt_BR']), 'pt-BR')
  assert.equal(matchLanguage(['pt-PT']), 'pt-BR')
  // Chinese by its script, or else by the place.
  assert.equal(matchLanguage(['zh-Hant-TW']), 'zh-Hant')
  assert.equal(matchLanguage(['zh_CN_#Hans']), 'zh-Hans')
  assert.equal(matchLanguage(['zh-HK']), 'zh-Hant')
  assert.equal(matchLanguage(['zh-Hans-HK']), 'zh-Hans')
  assert.equal(matchLanguage(['zh']), 'zh-Hans')
  // Java's old code for Indonesian.
  assert.equal(matchLanguage(['in_ID']), 'id')
  // The first one PeerSky has, in the order the phone gives.
  assert.equal(matchLanguage(['fil-PH', 'de-AT', 'fr']), 'de')
  assert.equal(matchLanguage(['fil-PH']), SOURCE_LANGUAGE)
  assert.equal(matchLanguage([]), SOURCE_LANGUAGE)
  assert.equal(matchLanguage(undefined), SOURCE_LANGUAGE)
})

test('the list has twenty five languages, Hindi, Marathi and Sanskrit among them, three read right to left', () => {
  assert.equal(LANGUAGES.length, 25)
  assert.equal(new Set(LANGUAGE_CODES).size, 25)
  for (const code of ['en', 'hi', 'mr', 'sa']) assert.ok(LANGUAGE_CODES.includes(code), code)
  assert.deepEqual(LANGUAGES.filter((language) => language.rtl).map((language) => language.code), ['ar', 'fa', 'ur'])
  assert.equal(isRtlLanguage('ar'), true)
  assert.equal(isRtlLanguage('mr'), false)
  for (const language of LANGUAGES) {
    assert.ok(language.native && language.name, language.code)
    assert.ok(PLURAL_CATEGORIES[language.code], `plural rules for ${language.code}`)
  }
})

test('each language takes the form a count needs', () => {
  const forms = (code, counts) => counts.map((n) => pluralCategory(code, n))
  assert.deepEqual(forms('en', [0, 1, 2]), ['other', 'one', 'other'])
  assert.deepEqual(forms('ru', [1, 2, 5, 11, 21, 22, 25, 111]), ['one', 'few', 'many', 'many', 'one', 'few', 'many', 'many'])
  assert.deepEqual(forms('uk', [1, 3, 12, 31]), ['one', 'few', 'many', 'one'])
  assert.deepEqual(forms('pl', [1, 2, 5, 12, 22, 101]), ['one', 'few', 'many', 'many', 'few', 'many'])
  assert.deepEqual(forms('ar', [0, 1, 2, 3, 10, 11, 99, 100, 102]), ['zero', 'one', 'two', 'few', 'few', 'many', 'many', 'other', 'other'])
  // Zero is singular in these.
  for (const code of ['fr', 'pt-BR', 'hi', 'bn', 'fa']) assert.deepEqual(forms(code, [0, 1, 2]), ['one', 'one', 'other'], code)
  assert.deepEqual(forms('mr', [0, 1, 2]), ['other', 'one', 'other'])
  // Sanskrit's dual.
  assert.deepEqual(forms('sa', [1, 2, 3]), ['one', 'two', 'other'])
  for (const code of ['ja', 'ko', 'zh-Hans', 'zh-Hant', 'th', 'vi', 'id']) assert.deepEqual(forms(code, [1, 2]), ['other', 'other'], code)
  for (const [code, categories] of Object.entries(PLURAL_CATEGORIES)) {
    for (let n = 0; n < 250; n++) assert.ok(categories.includes(pluralCategory(code, n)), `${code} ${n}`)
  }
})

test('text comes from the catalog of the language picked, and English otherwise', () => {
  registerCatalogs({
    de: () => ({
      Save: 'Speichern',
      'Remove {name}?': '{name} entfernen?',
      '{count} files': { one: '{count} Datei', other: '{count} Dateien' }
    })
  })
  try {
    assert.equal(t('Save'), 'Save')
    setLanguage('de')
    assert.equal(t('Save'), 'Speichern')
    assert.equal(t('Remove {name}?', { name: 'Ada' }), 'Ada entfernen?')
    assert.equal(t('Not in the catalog'), 'Not in the catalog')
    assert.equal(tKey(msg('Save')), 'Speichern')
    assert.equal(tp({ one: '{count} file', other: '{count} files' }, 1), '1 Datei')
    assert.equal(tp({ one: '{count} file', other: '{count} files' }, 4), '4 Dateien')
    // A plural no catalog has falls back to English's own forms.
    assert.equal(tp({ one: '{count} room', other: '{count} rooms' }, 1), '1 room')
    // A placeholder with nothing for it stays as it is.
    assert.equal(t('Remove {name}?'), '{name} entfernen?')
    // A language nobody registered is English.
    setLanguage('xx')
    assert.equal(t('Save'), 'Save')
  } finally {
    setLanguage('en')
  }
})

test('every call names its text plainly, so the catalogs can hold it', () => {
  const head = "import { msg, t, tp } from '../i18n/i18n.mjs'\n"
  const found = scanSource(head + [
    "t('Plain')",
    't("Double")',
    "t('Don\\'t {go}', { go })",
    't(\n  \'Over lines\'\n)',
    "msg('Marked')",
    "tp({ one: '{count} peer', other: '{count} peers' }, n)",
    'format(x)',
    "it('not a t call')"
  ].join('\n'), 'sample.tsx')
  assert.deepEqual(found.strings, ['Plain', 'Double', "Don't {go}", 'Over lines', 'Marked'])
  assert.deepEqual(found.plurals, [{ one: '{count} peer', other: '{count} peers' }])
  assert.deepEqual(found.problems, [])

  // A template literal, put together here so the linter does not take it for one.
  const template = 't(`Saved to $' + '{folder}`)'
  const bad = scanSource(head + [template, "t('Remove ' + name)", 't(label)', "tp({ other: 'only' }, n)"].join('\n'), 'bad.tsx')
  assert.equal(bad.problems.length, 4)
  assert.match(bad.problems[0], /^bad\.tsx:2 /)

  // A file that does not use the translations is not read.
  assert.deepEqual(scanSource("t('x')", 'other.mjs'), { strings: [], plurals: [], problems: [] })
})

test('strings.json lists every text the app puts through t(), and nothing else', () => {
  const collected = collectStrings()
  assert.deepEqual(collected.problems, [])
  const written = json('app/i18n/strings.json')
  assert.deepEqual(written.strings, collected.strings, 'run node scripts/i18n.mjs --write')
  assert.deepEqual(written.plurals, collected.plurals, 'run node scripts/i18n.mjs --write')
})

test('every language has every text, with the same placeholders and each form a count needs', () => {
  const collected = json('app/i18n/strings.json')
  for (const { code } of LANGUAGES) {
    if (code === SOURCE_LANGUAGE) continue
    assert.ok(existsSync(new URL(`../../app/i18n/locales/${code}.json`, import.meta.url)), `app/i18n/locales/${code}.json`)
    const problems = checkCatalog(code, readCatalog(code), collected)
    assert.deepEqual(problems.slice(0, 10), [], `${code}: ${problems.length} problems`)
  }
})

test('each catalog loads only when its language is picked', () => {
  const loaders = read('app/i18n/catalogs.ts')
  for (const { code } of LANGUAGES) {
    if (code === SOURCE_LANGUAGE) continue
    assert.ok(loaders.includes(`() => require('./locales/${code}.json')`), code)
  }
  assert.ok(!loaders.includes("'./locales/en.json'"))
})

test('iOS and Android are told about every language, with iOS prompts in each', () => {
  const app = json('app.json').expo
  assert.deepEqual(json('app/i18n/native/languages.json'), LANGUAGE_CODES)
  assert.deepEqual(Object.keys(app.locales), LANGUAGE_CODES)
  assert.ok(app.plugins.includes('./plugins/with-app-languages'))
  for (const code of LANGUAGE_CODES) {
    assert.equal(app.locales[code], `./app/i18n/native/${code}.json`)
    const { ios } = json(`app/i18n/native/${code}.json`)
    assert.deepEqual(Object.keys(ios).sort(), Object.keys(INFO_PLIST_TEXT).sort(), code)
    for (const value of Object.values(ios)) assert.ok(value.trim(), code)
  }
  // The English is what Info.plist says, so the copies are of the real text.
  for (const [key, text] of Object.entries(INFO_PLIST_TEXT)) assert.equal(app.ios.infoPlist[key], text, key)
  assert.ok(read('plugins/with-lan-discovery.js').includes(INFO_PLIST_TEXT.NSLocalNetworkUsageDescription))
  assert.deepEqual(json('app/i18n/native/en.json').ios, INFO_PLIST_TEXT)

  const plugin = read('plugins/with-app-languages.js')
  assert.match(plugin, /application\.\$\['android:localeConfig'\] = '@xml\/locales_config'/)
  assert.match(plugin, /<locale android:name="\$\{code\}"\/>/)
})

test('the language is a preference, the phone\'s unless one is picked', () => {
  assert.equal(parseBrowserPreferences({}).language, SYSTEM_LANGUAGE)
  assert.equal(parseBrowserPreferences({ language: 'mr' }).language, 'mr')
  assert.equal(parseBrowserPreferences({ language: 'zh-Hant' }).language, 'zh-Hant')
  assert.equal(parseBrowserPreferences({ language: 'xx' }).language, SYSTEM_LANGUAGE)
  assert.equal(parseBrowserPreferences({ language: 7 }).language, SYSTEM_LANGUAGE)
})

test('the first screen is in the language picked, and a switch reaches every screen', () => {
  const layout = read('app/_layout.tsx')
  assert.ok(layout.indexOf("import './i18n/setup'") > -1)
  assert.ok(layout.indexOf("import './i18n/setup'") < layout.indexOf('import { Slot }'), 'set up before anything else loads')
  const setup = read('app/i18n/setup.ts')
  assert.match(setup, /registerCatalogs\(CATALOG_LOADERS\)\nsetLanguage\(startupLanguage\(\)\)/)
  assert.match(setup, /JSON\.parse\(file\.textSync\(\)\)\?\.language/)
  const app = read('app/index.tsx')
  assert.match(app, /export default function App \(\) \{\n {2}\/\/ [^\n]*\n {2}useT\(\)/)
  assert.match(app, /applyLanguageSetting\(browserPreferences\.language\)/)
  const apply = read('app/i18n/apply-language.ts')
  // Picked in PeerSky, the direction follows it; the phone's follows the phone.
  assert.match(apply, /I18nManager\.allowRTL\(rtl\)\n {4}I18nManager\.forceRTL\(rtl\)/)
  assert.match(apply, /I18nManager\.allowRTL\(true\)\n {4}I18nManager\.forceRTL\(false\)/)
})

test('Settings has a Language page listing each language under its own name', () => {
  const screen = read('app/settings/SettingsScreen.tsx')
  assert.match(screen, /id: 'language',\n {4}title: (?:msg\()?'Language'/)
  assert.match(screen, /page === 'language' && \(\n {10}<LanguageSettings language=\{props\.language\} onLanguageChange=\{props\.onLanguageChange\} \/>/)
  const page = read('app/settings/Language.tsx')
  assert.match(page, /\{ id: SYSTEM_LANGUAGE, title: t\('Phone language'\)/)
  assert.match(page, /title: entry\.native/)
})
