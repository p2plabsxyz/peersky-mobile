import assert from 'node:assert/strict'
import { test } from 'node:test'

import { APP_WELCOME_FILE_NAMES, hasSeenWelcome, markWelcomeSeen, WELCOME_FILE_NAME } from '../../app/welcome-state.mjs'
import { PHONE_BACKUP_FILES } from '../../backend/backup/phone-backup.mjs'

// The screen says what PeerSky is, which does not change with a release, so it
// is keyed on having been seen at all rather than on a version.
test('the marker is what decides, not a version', () => {
  assert.equal(WELCOME_FILE_NAME, 'welcome-seen')
  assert.equal(hasSeenWelcome({ exists: false }), false)
  assert.equal(hasSeenWelcome({ exists: true }), true)
})

// Each app greets once on each phone, so a phone set up from a backup still
// says what P2PMD is the first time it is opened there.
test('an app welcome has a marker of its own that stays on this phone', () => {
  assert.equal(APP_WELCOME_FILE_NAMES.p2pmd, 'p2pmd-welcome-seen')
  assert.equal(APP_WELCOME_FILE_NAMES.hyperdrive, 'hyperdrive-welcome-seen')
  for (const name of [WELCOME_FILE_NAME, ...Object.values(APP_WELCOME_FILE_NAMES)]) {
    assert.ok(!PHONE_BACKUP_FILES.includes(name), name)
  }
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

// The first screen anybody sees, so it is written for somebody who has never
// heard of any of this.
test('the welcome screen explains itself without jargon', async () => {
  const { readFile } = await import('node:fs/promises')
  const screen = await readFile(new URL('../../app/WelcomeScreen.tsx', import.meta.url), 'utf8')

  assert.match(screen, /A browser that works for you, not for advertisers\./)
  // A scheme nobody has typed before is not an explanation, and "nobody in the
  // middle" reads as a riddle rather than a promise.
  assert.doesNotMatch(screen, /hyper:\/\//)
  assert.doesNotMatch(screen, /nobody in the middle/)
  assert.match(screen, /We collect nothing about you, so there is nothing to sell/)
  assert.match(screen, /No ads, no trackers, no account/)
})

// What PeerSky stands for is read first; ordinary websites, the part nobody
// needs convincing of, come late, and the code anyone can check comes last.
test('the welcome screen leads with what PeerSky stands for', async () => {
  const { readFile } = await import('node:fs/promises')
  const screen = await readFile(new URL('../../app/WelcomeScreen.tsx', import.meta.url), 'utf8')
  const cards = screen.slice(screen.indexOf('const QUALITIES'), screen.indexOf('const PEERSKY_WELCOME'))
  const titles = [...cards.matchAll(/title: '([^']+)'/g)].map((match) => match[1])

  assert.deepEqual(titles, [
    'You are not the product',
    'Device to device',
    'Your data stays yours',
    'The whole web, minus the junk',
    'Free and open source'
  ])
  assert.match(screen, /There is no server\. Your phone is the server\./)
  // The old card needed a second read to follow.
  assert.doesNotMatch(screen, /Every site, plus peer to peer ones/)
})

test('about offers one place to write to, not three', async () => {
  const { readFile } = await import('node:fs/promises')
  const settings = await readFile(new URL('../../app/settings/SettingsScreen.tsx', import.meta.url), 'utf8')

  assert.match(settings, /Send feedback/)
  // Both the row and the mail subject read the version off the config, so a
  // report says which build it came from without anybody editing a string.
  assert.equal((settings.match(/Constants\.expoConfig\?\.version/g) || []).length, 2)
  assert.doesNotMatch(settings, /PeerSky [0-9]+\.[0-9]+\.[0-9]+/)
  assert.doesNotMatch(settings, /Report harmful content/)
  assert.doesNotMatch(settings, /Send \{platformName\} feedback/)
  assert.doesNotMatch(settings, /CONTENT_REPORT_URL/)
})
