import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// The desktop asks Private or not, plus UDP, a host and a port. A phone asks
// only the first, in plain words, and starts every new note private.
test('Create Note asks private or public, and starts on private every time', async () => {
  const sheet = await read('app/P2pmdNewNoteSheet.tsx')
  assert.match(sheet, /useState\(true\)/)
  assert.match(sheet, /if \(visible\) setIsPrivate\(true\)/)
  assert.match(sheet, /title: 'Private'/)
  assert.match(sheet, /title: 'Public'/)
  assert.match(sheet, /Only this phone can host it\./)
  assert.match(sheet, /accessibilityRole='radio'/)
  // Two choices and nothing to type: no host, port or UDP on a phone.
  assert.equal(sheet.match(/title: '/g).length, 2)
  assert.doesNotMatch(sheet, /TextInput|Switch/)
})

test('the choice reaches the backend, and reopening keeps how a note was made', async () => {
  const app = await read('app/index.tsx')
  assert.match(app, /onPress=\{\(\) => setP2pmdNewNoteVisible\(true\)\}/)
  assert.match(app, /void onP2pmdRoomCreate\(null, \{ secure: isPrivate \}\)/)
  assert.match(app, /\{ requireCopy = false, secure = true \}/)
  assert.match(app, /\.\.\.\(requireCopy \? \{ requireCopy: true \} : \{\}\),\s+secure,\s+udp: false/)
  // A recent note reopens by its key alone; the backend knows public from private.
  assert.match(app, /: onP2pmdRoomCreate\(room\.key\)\)\}/)
})

// Refresh only ever picked up a note the backend was still running. Opening
// P2PMD does that now, so the start screen is one button with an icon.
test('the start screen has Create Note alone, and picks up a running note itself', async () => {
  const app = await read('app/index.tsx')
  const start = app.slice(app.indexOf('Start a collaborative note'), app.indexOf('<P2pmdNewNoteSheet'))
  assert.match(start, /<PencilSquareIcon width=\{18\} height=\{18\} color='#ffffff' \/>\s+<Text style=\{styles\.p2pmdPrimaryActionText\}>Create Note<\/Text>/)
  assert.doesNotMatch(start, />Refresh</)
  assert.doesNotMatch(app, /onP2pmdRoomRefresh/)
  assert.match(app, /if \(activeTab !== 'p2pmd' \|\| browserSource\.kind !== 'app' \|\| p2pmdRoom \|\| isBooting \|\| !rpcRef\.current\) return\s+void reattachRunningP2pmdRoom\(\)/)
})

test('the note header shares from an icon before Publish', async () => {
  const app = await read('app/index.tsx')
  const share = app.indexOf("accessibilityLabel='Share note'")
  const publish = app.indexOf('>Publish</Text>')
  assert.ok(share > 0 && share < publish)
  assert.match(app.slice(share, publish), /<ShareIcon width=\{16\} height=\{16\}/)
})
