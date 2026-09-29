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
  assert.match(toolbar, /siteSecurity === SITE_SECURITY\.INSECURE/)
  // And it is one of the address bar's icons, not a badge beside them: same
  // size, same colour, same weight, on the same centre line.
  const shieldStart = toolbar.indexOf('{showSiteSecurity && (')
  const shield = toolbar.slice(shieldStart, toolbar.indexOf('<TextInput', shieldStart))
  assert.ok(shieldStart > 0 && shield.length > 0)
  assert.equal((shield.match(/width=\{ADDRESS_SECURITY_ICON_SIZE\}/g) || []).length, 2)
  assert.equal((shield.match(/opacity=\{0\.76\}/g) || []).length, 2)
  assert.match(shield, /color=\{addressActionIconColor\}/)
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

test('the sheet clears the home indicator once, not twice', async () => {
  const { readFile } = await import('node:fs/promises')
  const sheet = await readFile(new URL('../../app/BrowserSiteInfoSheet.tsx', import.meta.url), 'utf8')

  // Padding the safe area on the container and the sheet both left a band of
  // empty sheet under the last row.
  assert.doesNotMatch(sheet, /edges=\{\['top', 'left', 'right', 'bottom'\]\}/)
  assert.match(sheet, /paddingBottom: Math\.max\(insets\.bottom, 16\)/)
})

test('privacy settings point at a test nobody here controls', async () => {
  const { readFile } = await import('node:fs/promises')
  const privacy = await readFile(new URL('../../app/settings/Privacy.tsx', import.meta.url), 'utf8')

  // It sits with the switch it tests, not off in its own section.
  const protection = privacy.slice(
    privacy.indexOf("title='Block ads and trackers'"),
    privacy.indexOf("title='YouTube'")
  )
  assert.match(protection, /https:\/\/coveryourtracks\.eff\.org\//)
})

test('the address bar keeps one rhythm', async () => {
  const { readFile } = await import('node:fs/promises')
  const toolbar = await readFile(new URL('../../app/BrowserToolbar.tsx', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../../app/styles.ts', import.meta.url), 'utf8')

  const read = (name, key) => {
    const block = styles.slice(styles.indexOf(`${name}: {`))
    return Number(new RegExp(`${key}: ([0-9]+)`).exec(block.slice(0, block.indexOf('}')))?.[1])
  }
  const actionWidth = read('browserAddressAction', 'width')
  const actionIcon = Number(/const ADDRESS_ACTION_ICON_SIZE = ([0-9]+)/.exec(toolbar)[1])
  const securityIcon = Number(/const ADDRESS_SECURITY_ICON_SIZE = ([0-9]+)/.exec(toolbar)[1])

  // Reload sits beside share, so their gap is the padding either side of both.
  assert.equal(actionWidth - actionIcon, read('browserAddressBesideSecurity', 'paddingLeft'))
  // A solid shield next to two thin outlines has to be drawn smaller to look
  // the same size.
  assert.ok(securityIcon < actionIcon)
  // The narrower box gives back in touch area what it takes in width.
  assert.equal((toolbar.match(/hitSlop=\{6\}/g) || []).length, 2)
})
