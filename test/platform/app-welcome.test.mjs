import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// The first look at an app, for somebody who has never heard of any of it.
test('P2PMD says what it is in four lines, without the plumbing', async () => {
  const welcomes = await read('app/app-welcomes.tsx')
  const p2pmd = welcomes.slice(welcomes.indexOf('export const P2PMD_WELCOME'))
  assert.equal(p2pmd.match(/\bid: '/g).length, 4)
  assert.match(p2pmd, /Every new note is private/)
  assert.match(p2pmd, /action: 'Start writing'/)
  assert.doesNotMatch(p2pmd, /hs:\/\/|hyper:\/\/|Holesail|Yjs|DHT/)
})

test('the welcome moves only when motion is welcome', async () => {
  const welcome = await read('app/AppWelcome.tsx')
  assert.match(welcome, /AccessibilityInfo\.isReduceMotionEnabled\(\)/)
  assert.match(welcome, /if \(reduceMotion\) \{\s+appear\.forEach\(\(value\) => value\.setValue\(1\)\)/)
  assert.match(welcome, /useNativeDriver: true/)
})

test('P2PMD shows its welcome once, before the start screen', async () => {
  const app = await read('app/index.tsx')
  assert.match(app, /useState\(\(\) => !hasSeenWelcome\(getAppWelcomeFile\('p2pmd'\)\)\)/)
  assert.match(app, /: activeTab === 'p2pmd' && showP2pmdWelcome\s+\? \(\s+<AppWelcome\s+content=\{P2PMD_WELCOME\}/)
  assert.match(app, /markWelcomeSeen\(getAppWelcomeFile\('p2pmd'\)\)\s+setShowP2pmdWelcome\(false\)/)
})
