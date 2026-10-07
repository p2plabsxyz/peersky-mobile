// Builds assets/licenses/third-party-notices.txt, the list the app shows under
// Settings, About, Open-source licenses. It covers the npm packages in the
// app's JavaScript and in the backend bundle, the native libraries, and the
// data, media and models the app ships, each with its license text, so the
// notices travel with the app and work offline.
//
//   node scripts/generate-third-party-notices.mjs
//     [--maps ios.map android.map]   refresh scripts/third-party/app-packages.txt
//     [--autolinking ios.json android.json]
//                                    refresh scripts/third-party/native-packages.txt
//     [--native inventory.json]      refresh scripts/third-party/native.json
//
// The source maps come from `npx expo export:embed --sourcemap-output`, the
// autolinking lists from `npx expo-modules-autolinking resolve --platform ios
// --json` (and android): npm packages whose native code ships though none of
// their JavaScript does. The native inventory lists iOS pods, Android
// libraries, Rust crates and the Bare runtime, each with its license text or
// the path of one on the machine that made it; native.json keeps the texts,
// so later runs need nothing outside the repo.
// The backend list is read from app/app.bundle.mjs, so run `npm run
// bundle:bare` first.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'scripts', 'third-party')
const APP_PACKAGES = path.join(DATA, 'app-packages.txt')
const NATIVE_PACKAGES = path.join(DATA, 'native-packages.txt')
const NATIVE = path.join(DATA, 'native.json')
const CREDITS = path.join(DATA, 'credits.json')
const BACKEND_BUNDLE = path.join(ROOT, 'app', 'app.bundle.mjs')
const OUTPUT = path.join(ROOT, 'assets', 'licenses', 'third-party-notices.txt')

// Folded into backend files by our own generate scripts rather than bundled
// from node_modules, so the bundle's paths do not show them.
const EMBEDDED_IN_BACKEND = ['node_modules/yjs', 'node_modules/lib0', 'node_modules/katex']

const SECTIONS = [
  { id: 'peersky', title: 'PeerSky' },
  { id: 'app', title: 'App' },
  { id: 'engine', title: 'Peer-to-peer engine' },
  { id: 'runtime', title: 'Bare runtime and native add-ons' },
  { id: 'ios', title: 'iOS libraries' },
  { id: 'android', title: 'Android libraries' },
  { id: 'rust', title: 'Ad blocker on Android' },
  { id: 'content', title: 'Data, media and models' }
]

const NATIVE_SECTION = {
  'ios-pod': 'ios',
  android: 'android',
  rust: 'rust',
  barekit: 'runtime',
  'native-addon': 'runtime'
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._][a-z0-9]+)*(\.(md|txt|markdown|rst))?$/i

const args = process.argv.slice(2)
const mapsAt = args.indexOf('--maps')
if (mapsAt >= 0) writeAppPackages(args.slice(mapsAt + 1).filter((value) => !value.startsWith('--')))
const autolinkingAt = args.indexOf('--autolinking')
if (autolinkingAt >= 0) writeNativePackages(args.slice(autolinkingAt + 1).filter((value) => !value.startsWith('--')))
const nativeAt = args.indexOf('--native')
if (nativeAt >= 0) writeNative(args[nativeAt + 1])

const texts = []
const textIndex = new Map()
const seen = new Set()
const sections = SECTIONS.map((section) => ({ ...section, items: [] }))
const section = (id) => sections.find((entry) => entry.id === id)

const own = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const app = JSON.parse(readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
addItem('peersky', {
  name: 'PeerSky Mobile',
  version: app.expo?.version || '',
  license: own.license || 'MIT',
  url: 'https://github.com/p2plabsxyz/peersky-mobile',
  text: readFileSync(path.join(ROOT, 'LICENSE'), 'utf8')
})
for (const dir of readLines(APP_PACKAGES)) addPackage('app', dir)
for (const dir of readLines(NATIVE_PACKAGES)) addPackage('app', dir)
for (const dir of [...backendPackageDirs(), ...EMBEDDED_IN_BACKEND]) addPackage('engine', dir)

const native = existsSync(NATIVE) ? JSON.parse(readFileSync(NATIVE, 'utf8')) : { texts: [], entries: [] }
for (const entry of native.entries) {
  addItem(NATIVE_SECTION[entry.source] || 'runtime', {
    name: entry.name,
    version: entry.version || '',
    license: entry.license || 'See text',
    url: entry.url || '',
    text: native.texts[entry.text] || noticeFor(entry.license, entry.copyright || `The ${entry.name} authors`, entry)
  })
}

for (const entry of JSON.parse(readFileSync(CREDITS, 'utf8'))) {
  const text = entry.textFile
    ? readFileSync(path.join(ROOT, entry.textFile), 'utf8')
    : noticeFor(entry.license, entry.copyright, entry)
  addItem(entry.section || 'content', {
    name: entry.name,
    version: entry.version || '',
    license: entry.license,
    url: entry.url || '',
    text
  })
}

for (const entry of sections) entry.items.sort((left, right) => left.name.localeCompare(right.name))
const notices = {
  version: 1,
  sections: sections.filter((entry) => entry.items.length > 0),
  texts
}
writeFileSync(OUTPUT, JSON.stringify(notices))
const count = notices.sections.reduce((total, entry) => total + entry.items.length, 0)
console.log(`Wrote ${count} components and ${texts.length} license texts to ${path.relative(ROOT, OUTPUT)} (${Math.round(statSync(OUTPUT).size / 1024)} KB)`)

function addPackage (sectionId, dir) {
  const folder = path.join(ROOT, dir)
  const manifest = JSON.parse(readFileSync(path.join(folder, 'package.json'), 'utf8'))
  const license = licenseOf(manifest)
  addItem(sectionId, {
    name: manifest.name,
    version: manifest.version || '',
    license,
    url: repositoryOf(manifest),
    text: licenseTextOf(folder) || noticeFor(license, authorOf(manifest) || manifest.name)
  })
}

function addItem (sectionId, item) {
  const key = `${item.name}@${item.version}`
  if (seen.has(key)) return
  seen.add(key)
  const text = normalize(item.text)
  if (!text) throw new Error(`No license text for ${key}`)
  let index = textIndex.get(text)
  if (index === undefined) {
    index = texts.length
    texts.push(text)
    textIndex.set(text, index)
  }
  section(sectionId).items.push({ name: item.name, version: item.version, license: item.license, url: item.url, text: index })
}

function backendPackageDirs () {
  const source = readFileSync(BACKEND_BUNDLE, 'utf8')
  const dirs = new Set()
  for (const match of source.matchAll(/((?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)+)\//gi)) {
    dirs.add(match[1].slice(1))
  }
  return [...dirs].sort()
}

function licenseOf (manifest) {
  if (typeof manifest.license === 'string') return manifest.license
  if (manifest.license?.type) return manifest.license.type
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((entry) => entry.type || entry).join(' OR ')
  return 'See text'
}

function authorOf (manifest) {
  const author = manifest.author
  if (typeof author === 'string') return author.replace(/\s*[<(].*$/, '').trim()
  return author?.name || ''
}

function repositoryOf (manifest) {
  const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
  if (!repository) return manifest.homepage || ''
  return repository
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^github:/, 'https://github.com/')
    .replace(/\.git$/, '')
    .replace(/^([\w.-]+\/[\w.-]+)$/, 'https://github.com/$1')
}

// The license files at the top of a package, the license first and any
// NOTICE after it, as Apache 2.0 asks.
function licenseTextOf (folder) {
  const files = readdirSync(folder)
    .filter((name) => LICENSE_FILE.test(name) && statSync(path.join(folder, name)).isFile())
    .sort((left, right) => rank(left) - rank(right) || left.localeCompare(right))
  if (files.length === 0) return ''
  return files.map((name) => readFileSync(path.join(folder, name), 'utf8').trim()).join('\n\n')
}

function rank (name) {
  return /^notice/i.test(name) ? 1 : 0
}

function normalize (text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// For a package that ships no license file: the standard text with the
// author it names, or a pointer for licenses that are cited by address.
function noticeFor (license, holder, entry = {}) {
  const copyright = holder ? `Copyright (c) ${holder}` : ''
  const id = String(license || '').toUpperCase()
  if (id === 'MIT') return template('MIT', copyright)
  if (id === 'ISC') return template('ISC', copyright)
  if (id === 'BSD-2-CLAUSE') return template('BSD-2-Clause', copyright)
  if (id === 'BSD-3-CLAUSE') return template('BSD-3-Clause', copyright)
  if (id === 'APACHE-2.0') return template('Apache-2.0', '')
  if (entry.notice) return entry.notice
  throw new Error(`No license text for ${holder} (${license})`)
}

function template (id, copyright) {
  const body = readFileSync(path.join(DATA, 'templates', `${id}.txt`), 'utf8').trim()
  return body.replace('{{copyright}}', copyright || '')
}

function readLines (file) {
  return readFileSync(file, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean)
}

function writeAppPackages (maps) {
  const dirs = new Set()
  for (const map of maps) {
    for (const source of JSON.parse(readFileSync(map, 'utf8')).sources || []) {
      const normalized = source.replace(/\\/g, '/')
      const start = normalized.indexOf('node_modules/')
      const last = normalized.lastIndexOf('node_modules/')
      if (start < 0) continue
      const parts = normalized.slice(last + 'node_modules/'.length).split('/')
      const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
      dirs.add(normalized.slice(start, last) + 'node_modules/' + name)
    }
  }
  writeFileSync(APP_PACKAGES, [...dirs].sort().join('\n') + '\n')
  console.log(`Wrote ${dirs.size} app packages to ${path.relative(ROOT, APP_PACKAGES)}`)
}

// Release builds leave out the modules autolinking marks debug only.
function writeNativePackages (lists) {
  const appPackages = new Set(readLines(APP_PACKAGES))
  const dirs = new Set()
  for (const list of lists) {
    for (const module of JSON.parse(readFileSync(list, 'utf8')).modules || []) {
      if (module.debugOnly === true) continue
      const source = module.pods?.[0]?.podspecDir || module.projects?.[0]?.sourceDir || ''
      const start = source.indexOf('node_modules/')
      const last = source.lastIndexOf('node_modules/')
      if (start < 0) continue
      const parts = source.slice(last + 'node_modules/'.length).split('/')
      const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
      const dir = source.slice(start, last) + 'node_modules/' + name
      if (!appPackages.has(dir)) dirs.add(dir)
    }
  }
  writeFileSync(NATIVE_PACKAGES, [...dirs].sort().join('\n') + '\n')
  console.log(`Wrote ${dirs.size} native-only packages to ${path.relative(ROOT, NATIVE_PACKAGES)}`)
}

function writeNative (inventoryPath) {
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
  // Each text once: many libraries share one.
  const texts = []
  const seenTexts = new Map()
  const entries = inventory.map((entry) => {
    const text = entry.text
      ? normalize(entry.text)
      : entry.licenseFile && existsSync(entry.licenseFile) ? normalize(readFileSync(entry.licenseFile, 'utf8')) : ''
    let index = null
    if (text) {
      index = seenTexts.get(text)
      if (index === undefined) {
        index = texts.length
        texts.push(text)
        seenTexts.set(text, index)
      }
    }
    return {
      name: entry.name,
      version: entry.version || '',
      license: entry.license || '',
      source: entry.source,
      url: entry.url || '',
      text: index
    }
  })
  writeFileSync(NATIVE, JSON.stringify({ texts, entries }) + '\n')
  console.log(`Wrote ${entries.length} native components to ${path.relative(ROOT, NATIVE)}`)
}
