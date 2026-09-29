import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hasSeenWelcome, markWelcomeSeen, WELCOME_FILE_NAME } from '../../app/welcome-state.mjs'

// The screen says what PeerSky is, which does not change with a release, so it
// is keyed on having been seen at all rather than on a version.
test('the marker is what decides, not a version', () => {
  assert.equal(WELCOME_FILE_NAME, 'welcome-seen')
  assert.equal(hasSeenWelcome({ exists: false }), false)
  assert.equal(hasSeenWelcome({ exists: true }), true)
})

test('storage that cannot be read does not mean a first run', () => {
  // Otherwise an unreadable file would greet somebody on every single launch,
  // which is worse than never greeting them at all.
  const broken = { get exists () { throw new Error('no') } }
  assert.equal(hasSeenWelcome(broken), true)
})

test('marking it is best effort and says whether it stuck', () => {
  const created = []
  assert.equal(markWelcomeSeen({ create: (options) => created.push(options) }), true)
  assert.deepEqual(created, [{ overwrite: true }])
  assert.equal(markWelcomeSeen({ create: () => { throw new Error('read-only') } }), false)
})
