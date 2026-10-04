import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { describeNotice, parseThirdPartyNotices, splitNoticeText } from '../../app/settings/third-party-notices.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const readLines = async (path) => (await read(path)).split('\n').map((line) => line.trim()).filter(Boolean)

// Config plugins and web-only packages: nothing of theirs is in the app.
const BUILD_ONLY = new Set(['expo-build-properties', 'react-dom'])

async function shipped () {
  const notices = parseThirdPartyNotices(await read('assets/licenses/third-party-notices.txt'))
  const items = notices.sections.flatMap((section) => section.data)
  return { notices, items, names: new Set(items.map((item) => item.name)) }
}

async function packageNames (dirs) {
  const names = []
  for (const dir of dirs) names.push(JSON.parse(await read(`${dir}/package.json`)).name)
  return names
}

test('the licenses list ships in the app and reads the way the app reads it', async () => {
  const { notices, items } = await shipped()
  assert.ok(notices.count > 250)
  assert.equal(items.length, notices.count)
  assert.equal(notices.sections[0].data[0].name, 'PeerSky Mobile')
  for (const item of items) {
    assert.ok(item.text.length > 40, item.name)
    assert.ok(item.license, item.name)
  }
  assert.equal(describeNotice({ version: '1.0.0', license: 'MIT' }), '1.0.0 · MIT')
  assert.equal(describeNotice({ version: '', license: 'CC-BY-4.0' }), 'CC-BY-4.0')
})

test('it names every package in the backend bundle and the app', async () => {
  const { names } = await shipped()
  const bundle = await read('app/app.bundle.mjs')
  const dirs = new Set()
  for (const match of bundle.matchAll(/((?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)+)\//gi)) {
    dirs.add(match[1].slice(1))
  }
  assert.ok(dirs.size > 100)
  for (const name of await packageNames([...dirs])) assert.ok(names.has(name), name)
  for (const name of ['yjs', 'lib0', 'katex']) assert.ok(names.has(name), name)

  const app = [...await readLines('scripts/third-party/app-packages.txt'), ...await readLines('scripts/third-party/native-packages.txt')]
  for (const name of await packageNames(app)) assert.ok(names.has(name), name)

  const dependencies = Object.keys(JSON.parse(await read('package.json')).dependencies)
  for (const name of dependencies) assert.ok(names.has(name) || BUILD_ONLY.has(name), name)
})

test('it credits the lists, models and media the app carries', async () => {
  const { names } = await shipped()
  for (const name of [
    'EasyList and EasyPrivacy',
    'NSFWJS',
    'nsfw_model (MobileNetV2)',
    'TensorFlow.js',
    'Bootstrap Icons',
    'Heroicons',
    'qrcode-generator',
    'emojilib',
    'StevenBlack/hosts (porn-only list)',
    'List of offensive words',
    'PeerChat sounds',
    'Start page wallpaper'
  ]) assert.ok(names.has(name), name)
})

// Holesail's AGPL reached the app once. Nothing copyleft goes in again
// without someone deciding it should.
test('nothing in the app is under a copyleft license', async () => {
  const { items } = await shipped()
  for (const item of items) {
    // A library offered under a choice of licenses says which one PeerSky
    // took, as "(chosen from ...)". The choice is what counts.
    const license = item.license.replace(/\(chosen from [^)]*\)/, '')
    assert.doesNotMatch(license, /\b(A|L)?GPL\b/i, item.name)
  }
})

// A few notices run to hundreds of thousands of characters, which one text
// view can draw blank on iOS. The screen shows them in pieces.
test('long license texts are shown in pieces, with nothing lost', async () => {
  const { items } = await shipped()
  const longest = items.reduce((best, item) => item.text.length > best.text.length ? item : best)
  assert.ok(longest.text.length > 100000)
  for (const text of [longest.text, 'short', 'a\n'.repeat(10) + 'x'.repeat(4500) + '\nend']) {
    const pieces = splitNoticeText(text, 2000)
    for (const piece of pieces) assert.ok(piece.length <= 2000)
    assert.equal(pieces.join('').replace(/\n/g, ''), text.replace(/\n/g, ''))
  }
})
