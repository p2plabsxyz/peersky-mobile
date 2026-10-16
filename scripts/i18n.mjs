#!/usr/bin/env node
// The text PeerSky's own screens show, gathered from the code, and the
// catalogs checked against it.
//
//   node scripts/i18n.mjs          lists any call whose text is not a plain string
//   node scripts/i18n.mjs --write  writes app/i18n/strings.json, app/i18n/viewer-strings.json,
//                                  app/i18n/catalogs.ts,
//                                  each language's iOS prompts and quick actions,
//                                  its Android notification text and the list
//                                  of languages in app/i18n/native,
//                                  and the widgets' Localizable.xcstrings
//   node scripts/i18n.mjs --check  also says what each catalog is missing or has wrong
//
// Only files that import t, tp or msg from app/i18n/i18n.mjs are read, and the
// Hyperdrive viewer's files under assets/hyperdrive-viewer that import them
// from its own i18n.js. Every call must name its English text as one plain
// string literal: a key put together at run time could never be in a
// catalog, so this refuses it with its place. tKey() takes a variable,
// holding text marked with msg().
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LANGUAGES, SOURCE_LANGUAGE } from '../app/i18n/languages.mjs'
import { ANDROID_TEXT, INFO_PLIST_TEXT, SHORTCUT_TEXT, WIDGET_NAMES, WIDGET_TEXT } from '../app/i18n/native-strings.mjs'
import { PLURAL_CATEGORIES } from '../app/i18n/plural.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP = join(ROOT, 'app')
// The Hyperdrive viewer, a web page the app serves (backend/hyperdrive-viewer).
// It translates itself with the strings the app hands it.
export const VIEWER = join(ROOT, 'assets', 'hyperdrive-viewer')
const SKIP = new Set(['app.bundle.mjs'])
const I18N_IMPORT = /import\s*\{[^}]*\b(?:t|tp|msg)\b[^}]*\}\s*from\s*['"][./]*(?:[\w-]+\/)*i18n\/i18n\.mjs['"]/
// The viewer's modules load each other by absolute path, as
// '/hyperdrive/viewer/i18n.js', or by a relative one.
export const VIEWER_I18N_IMPORT = /import\s*\{[^}]*\b(?:t|tp|msg)\b[^}]*\}\s*from\s*['"](?:\/hyperdrive\/viewer\/|(?:\.{1,2}\/)+)(?:[\w-]+\/)*i18n\.js['"]/

export function sourceFiles (dir = APP) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      // The i18n module itself passes text through rather than naming it.
      if (entry.name === 'generated' || entry.name === 'i18n') continue
      files.push(...sourceFiles(path))
    } else if (/\.(?:ts|tsx|mjs)$/.test(entry.name) && !SKIP.has(entry.name)) {
      files.push(path)
    }
  }
  return files
}

/** The viewer's scripts. Its data (the place names) holds no text to show. */
export function viewerSourceFiles (dir = VIEWER) {
  if (!existsSync(dir)) return []
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'data') continue
      files.push(...viewerSourceFiles(path))
    } else if (/\.m?js$/.test(entry.name)) {
      files.push(path)
    }
  }
  return files.sort()
}

function isViewerFile (file) {
  return file.startsWith(VIEWER + sep)
}

// A single or double quoted JavaScript string literal at `at`, read as the
// value it has at run time. Null when there is none there.
function readLiteral (source, at) {
  const quote = source[at]
  if (quote !== "'" && quote !== '"') return null
  let i = at + 1
  while (i < source.length && source[i] !== quote) {
    if (source[i] === '\n') return null
    i += source[i] === '\\' ? 2 : 1
  }
  if (i >= source.length) return null
  const literal = source.slice(at, i + 1)
  // Our own source, and only ever a quoted string: evaluating it is how its
  // escapes come out exactly as the app sees them.
  return { value: Function(`"use strict"; return (${literal})`)(), end: i + 1 } // eslint-disable-line no-new-func
}

function skipSpace (source, at) {
  while (at < source.length && /\s/.test(source[at])) at++
  return at
}

function lineOf (source, at) {
  return source.slice(0, at).split('\n').length
}

// After these, a slash starts a regular expression rather than a division.
const BEFORE_REGEX = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'])
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'])

// The end of the string, template or regular expression starting at `at`.
function skipQuoted (source, at) {
  const quote = source[at]
  let depth = 0
  let i = at + 1
  while (i < source.length) {
    const c = source[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (quote === '`' && c === '$' && source[i + 1] === '{') {
      depth++
      i += 2
      continue
    }
    if (quote === '`' && depth > 0 && c === '}') depth--
    else if (c === quote && depth === 0) return i + 1
    else if (quote !== '`' && c === '\n') return i
    i++
  }
  return i
}

function skipRegex (source, at) {
  let inClass = false
  let i = at + 1
  while (i < source.length && source[i] !== '\n') {
    const c = source[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) return i + 1
    i++
  }
  return i
}

/**
 * The source with its comments blanked out, every character kept in its
 * place, so a call named in a comment, as `t('...')` in a note on how to
 * write one, is not taken for one. Strings, templates and regular
 * expressions are stepped over whole.
 */
export function withoutComments (source) {
  let out = ''
  let last = ''
  let word = ''
  let i = 0
  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]
    if (c === '/' && (next === '/' || next === '*')) {
      const end = next === '/' ? source.indexOf('\n', i) : source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : next === '/' ? end : end + 2
      out += source.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    const regex = c === '/' && (BEFORE_REGEX.has(last) || (/\w/.test(last) && KEYWORDS_BEFORE_REGEX.has(word)))
    if (c === '"' || c === "'" || c === '`' || regex) {
      const stop = regex ? skipRegex(source, i) : skipQuoted(source, i)
      out += source.slice(i, stop)
      last = regex ? '/' : c
      word = ''
      i = stop
      continue
    }
    out += c
    if (/[\w$]/.test(c)) {
      word = /[\w$]/.test(source[i - 1] || '') ? word + c : c
      last = c
    } else if (!/\s/.test(c)) {
      word = ''
      last = c
    }
    i++
  }
  return out
}

/**
 * The keys one file uses, and each call that does not name its text plainly.
 * A viewer file is read when it imports the viewer's own i18n.js. Comments
 * are left out.
 */
export function scanSource (text, file = '', { viewer = false } = {}) {
  const strings = []
  const plurals = []
  const problems = []
  const source = withoutComments(text)
  if (!(viewer ? VIEWER_I18N_IMPORT : I18N_IMPORT).test(source)) return { strings, plurals, problems }

  for (const match of source.matchAll(/(?<![\w.$])(t|msg)\(/g)) {
    let at = skipSpace(source, match.index + match[0].length)
    const literal = readLiteral(source, at)
    at = literal ? skipSpace(source, literal.end) : at
    if (!literal || (source[at] !== ',' && source[at] !== ')')) {
      problems.push(`${file}:${lineOf(source, match.index)} ${match[1]}() needs its English text as one plain string`)
      continue
    }
    strings.push(literal.value)
  }

  for (const match of source.matchAll(/(?<![\w.$])tp\(\s*\{/g)) {
    let at = match.index + match[0].length
    const forms = {}
    for (;;) {
      at = skipSpace(source, at)
      const key = /^(one|other)\s*:/.exec(source.slice(at))
      if (!key) break
      at = skipSpace(source, at + key[0].length)
      const literal = readLiteral(source, at)
      if (!literal) break
      forms[key[1]] = literal.value
      at = skipSpace(source, literal.end)
      if (source[at] === ',') at++
    }
    at = skipSpace(source, at)
    if (typeof forms.one !== 'string' || typeof forms.other !== 'string' || source[at] !== '}') {
      problems.push(`${file}:${lineOf(source, match.index)} tp() needs { one: '...', other: '...' } as plain strings`)
      continue
    }
    plurals.push({ one: forms.one, other: forms.other })
  }

  return { strings, plurals, problems }
}

function gather (files, strings = new Set()) {
  const plurals = new Map()
  const problems = []
  for (const file of files) {
    const found = scanSource(readFileSync(file, 'utf8'), relative(ROOT, file), { viewer: isViewerFile(file) })
    for (const text of found.strings) strings.add(text)
    for (const forms of found.plurals) plurals.set(forms.other, forms)
    problems.push(...found.problems)
  }
  return {
    strings: [...strings].sort(),
    plurals: [...plurals.values()].sort((a, b) => a.other.localeCompare(b.other)),
    problems
  }
}

/** Every key the app uses, the viewer's with them: what strings.json holds. */
export function collectStrings (files = [...sourceFiles(), ...viewerSourceFiles()]) {
  // Every language's name, for the language list (language-name.mjs), and
  // what iOS, the quick actions, the widgets and Android's PeerChat
  // notification show (native-strings.mjs).
  return gather(files, new Set([
    ...LANGUAGES.map((language) => language.name),
    ...Object.values(INFO_PLIST_TEXT),
    ...Object.values(SHORTCUT_TEXT),
    ...WIDGET_TEXT,
    ...Object.values(ANDROID_TEXT)
  ]))
}

/**
 * The keys the Hyperdrive viewer uses: what viewer-strings.json holds, and
 * all the app hands the page of a catalog.
 */
export function collectViewerStrings (files = viewerSourceFiles()) {
  return gather(files)
}

function writeJson (path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

/**
 * Writes strings.json and viewer-strings.json, and nothing else, so it can
 * run without the catalogs: the sync of the viewer does.
 */
export function writeStringFiles () {
  const app = collectStrings()
  const viewer = collectViewerStrings()
  writeJson(join(APP, 'i18n', 'strings.json'), { strings: app.strings, plurals: app.plurals })
  writeJson(join(APP, 'i18n', 'viewer-strings.json'), { strings: viewer.strings, plurals: viewer.plurals })
  return { app, viewer, problems: app.problems }
}

const PLACEHOLDER = /\{(\w+)\}/g

function placeholders (text) {
  return [...String(text).matchAll(PLACEHOLDER)].map((match) => match[1]).sort().join(',')
}

/** What one catalog lacks or gets wrong, against the keys the app uses. */
export function checkCatalog (code, catalog, { strings, plurals }) {
  const problems = []
  const categories = PLURAL_CATEGORIES[code] || ['other']
  for (const text of strings) {
    const value = catalog[text]
    if (typeof value !== 'string' || !value.trim()) problems.push(`missing: ${JSON.stringify(text)}`)
    else if (placeholders(value) !== placeholders(text)) problems.push(`placeholders differ: ${JSON.stringify(text)}`)
  }
  for (const forms of plurals) {
    const value = catalog[forms.other]
    if (!value || typeof value !== 'object') {
      problems.push(`missing plural: ${JSON.stringify(forms.other)}`)
      continue
    }
    for (const category of categories) {
      if (typeof value[category] !== 'string' || !value[category].trim()) {
        problems.push(`plural ${category} missing: ${JSON.stringify(forms.other)}`)
      } else if (placeholders(value[category]) !== placeholders(forms.other)) {
        problems.push(`plural ${category} placeholders differ: ${JSON.stringify(forms.other)}`)
      }
    }
  }
  const known = new Set([...strings, ...plurals.map((forms) => forms.other)])
  for (const key of Object.keys(catalog)) {
    if (!known.has(key)) problems.push(`not used: ${JSON.stringify(key)}`)
  }
  return problems
}

export function catalogPath (code) {
  return join(APP, 'i18n', 'locales', `${code}.json`)
}

export function readCatalog (code) {
  return JSON.parse(readFileSync(catalogPath(code), 'utf8'))
}

function writeCatalogLoaders () {
  const lines = [
    '// Written by scripts/i18n.mjs from LANGUAGES in languages.mjs. Each catalog is',
    '// required only when its language is picked, so the others are never parsed.',
    'export const CATALOG_LOADERS: Record<string, () => unknown> = {'
  ]
  const codes = LANGUAGES.map((language) => language.code).filter((code) => code !== SOURCE_LANGUAGE)
  codes.forEach((code, index) => {
    const key = /^[a-z]+$/.test(code) ? code : `'${code}'`
    lines.push(`  ${key}: () => require('./locales/${code}.json')${index < codes.length - 1 ? ',' : ''}`)
  })
  lines.push('}', '')
  writeFileSync(join(APP, 'i18n', 'catalogs.ts'), lines.join('\n'))
}

function catalogFor (code) {
  return code !== SOURCE_LANGUAGE && existsSync(catalogPath(code)) ? readCatalog(code) : {}
}

function translated (catalog, text) {
  return typeof catalog[text] === 'string' && catalog[text].trim() ? catalog[text] : text
}

// Expo writes each value into a .strings file, and into Android's
// strings.xml, between double quotes as it is, so a quote, a backslash or a
// line break in a translation would end the string early. They go in escaped.
export function stringsValue (text) {
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

// For the native side, which runs before any JavaScript: the languages, for
// Android's list of them (plugins/with-app-languages.js), and each one's iOS
// prompts and quick action titles and Android notification text, which the
// locales in app.json point at. Text a catalog lacks stays English.
function writeNativeFiles () {
  const dir = join(APP, 'i18n', 'native')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'languages.json'), JSON.stringify(LANGUAGES.map((language) => language.code)) + '\n')
  for (const { code } of LANGUAGES) {
    const catalog = catalogFor(code)
    const ios = {}
    for (const [key, text] of Object.entries(INFO_PLIST_TEXT)) ios[key] = stringsValue(translated(catalog, text))
    for (const [key, text] of Object.entries(SHORTCUT_TEXT)) ios[key] = stringsValue(translated(catalog, text))
    const android = {}
    for (const [key, text] of Object.entries(ANDROID_TEXT)) android[key] = stringsValue(translated(catalog, text))
    writeFileSync(join(dir, `${code}.json`), JSON.stringify({ ios, android }, null, 2) + '\n')
  }
}

// The widgets' words in every language, as a String Catalog: Xcode builds it
// into the widget extension and, as it sits in _shared, into the app too, for
// the PeerTunes buttons' titles. Written the way Xcode writes one, keys in
// order and a space before each colon, so a build that reads it leaves it be.
export function widgetCatalog () {
  const strings = {}
  for (const name of WIDGET_NAMES) strings[name] = { shouldTranslate: false }
  for (const text of WIDGET_TEXT) {
    const localizations = {}
    for (const { code } of LANGUAGES) {
      if (code === SOURCE_LANGUAGE) continue
      const value = catalogFor(code)[text]
      if (typeof value === 'string' && value.trim()) localizations[code] = { stringUnit: { state: 'translated', value } }
    }
    strings[text] = Object.keys(localizations).length ? { localizations } : {}
  }
  const sorted = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]))
  }
  const json = JSON.stringify(sorted({ sourceLanguage: SOURCE_LANGUAGE, strings, version: '1.0' }), null, 2)
  return json.replace(/^(\s*"(?:[^"\\]|\\.)*"):/gm, '$1 :') + '\n'
}

function writeWidgetCatalog () {
  writeFileSync(join(ROOT, 'targets', 'widgets', '_shared', 'Localizable.xcstrings'), widgetCatalog())
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const collected = collectStrings()
  if (collected.problems.length) {
    console.error(collected.problems.join('\n'))
    process.exitCode = 1
  }
  if (process.argv.includes('--write')) {
    writeStringFiles()
    writeCatalogLoaders()
    writeNativeFiles()
    writeWidgetCatalog()
  }
  console.log(`${collected.strings.length} strings and ${collected.plurals.length} plurals`)

  if (process.argv.includes('--check')) {
    for (const { code } of LANGUAGES) {
      if (code === SOURCE_LANGUAGE) continue
      let problems
      try {
        problems = checkCatalog(code, readCatalog(code), collected)
      } catch (error) {
        problems = [`unreadable: ${error.message}`]
      }
      console.log(`${code}: ${problems.length ? `${problems.length} problems` : 'complete'}`)
      for (const problem of problems.slice(0, 20)) console.log(`  ${problem}`)
      if (problems.length) process.exitCode = 1
    }
  }
}
