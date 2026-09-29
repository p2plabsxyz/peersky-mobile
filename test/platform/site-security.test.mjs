import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeSiteSecurity, getSiteSecurity, SITE_SECURITY } from '../../app/site-security.mjs'

test('https is encrypted and http is not', () => {
  assert.equal(getSiteSecurity('https://example.com/page'), SITE_SECURITY.SECURE)
  assert.equal(getSiteSecurity('HTTPS://EXAMPLE.COM'), SITE_SECURITY.SECURE)
  assert.equal(getSiteSecurity('http://example.com'), SITE_SECURITY.INSECURE)
})

// The loopback server is how PeerTunes and P2PMD are served. It says http, but
// nothing leaves the device, and warning about it would be crying wolf.
test('the loopback server is not an insecure site', () => {
  assert.equal(getSiteSecurity('http://127.0.0.1:53792/'), SITE_SECURITY.INTERNAL)
  assert.equal(getSiteSecurity('http://localhost:8080/x'), SITE_SECURITY.INTERNAL)
  // Somebody else's server is, whatever it calls itself.
  assert.equal(getSiteSecurity('http://localhost.example.com'), SITE_SECURITY.INSECURE)
})

// A key in the address is a different promise from a certificate, so it gets
// its own answer rather than being squeezed into secure or insecure.
test('peer-served pages say so', () => {
  for (const url of ['hyper://key/', 'hs://key', 'ipfs://cid', 'ipns://name']) {
    assert.equal(getSiteSecurity(url), SITE_SECURITY.PEER)
  }
})

test('the app\'s own pages are named as such', () => {
  assert.equal(getSiteSecurity('peersky://home'), SITE_SECURITY.INTERNAL)
  assert.equal(getSiteSecurity('about:blank'), SITE_SECURITY.INTERNAL)
})

test('nothing to say is said, rather than guessed at', () => {
  assert.equal(getSiteSecurity(''), SITE_SECURITY.UNKNOWN)
  assert.equal(getSiteSecurity(null), SITE_SECURITY.UNKNOWN)
  assert.equal(getSiteSecurity('not a url'), SITE_SECURITY.UNKNOWN)
  assert.equal(getSiteSecurity('mailto:someone@example.com'), SITE_SECURITY.UNKNOWN)
})

test('every state has words a person can act on', () => {
  for (const state of Object.values(SITE_SECURITY)) {
    const { title, body } = describeSiteSecurity(state)
    assert.ok(title.length > 0 && body.length > 0, state)
  }
  // The one that matters most says what not to do.
  assert.match(describeSiteSecurity(SITE_SECURITY.INSECURE).body, /password or card number/)
})

// The shield, and what it refuses to claim.
test('the address bar shows the shield, and hides it while typing', async () => {
  const { readFile } = await import('node:fs/promises')
  const toolbar = await readFile(new URL('../../app/BrowserToolbar.tsx', import.meta.url), 'utf8')

  // The shield describes the page that loaded, not the half-typed draft: those
  // two disagree the moment you type an address and tap away without going.
  assert.match(toolbar, /getSiteSecurity\(getBrowserAddressForUrl\(currentUrl\)\)/)
  // Editing an address is not describing a page, so the shield steps aside.
  assert.match(toolbar, /!isAddressFocused && siteSecurity !== SITE_SECURITY\.UNKNOWN/)
  // Only the unencrypted case is coloured: a padlock on every page teaches
  // people to ignore it.
  assert.match(toolbar, /siteSecurity === SITE_SECURITY\.INSECURE\s*\n\s*\? <ShieldSlashIcon/)
})

test('the sheet states blocking rather than inventing a count', async () => {
  const { readFile } = await import('node:fs/promises')
  const sheet = await readFile(new URL('../../app/BrowserSiteInfoSheet.tsx', import.meta.url), 'utf8')

  assert.match(sheet, /Ads and trackers are blocked/)
  assert.match(sheet, /Ads and trackers are not blocked/)
  // Neither platform hands a number back, so there is none to show.
  assert.doesNotMatch(sheet, /blockedCount|blockCount|trackersBlocked/)
  // And it leads somewhere the switch can actually be changed.
  assert.match(sheet, /onOpenPrivacySettings/)
})
