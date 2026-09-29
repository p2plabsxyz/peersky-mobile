import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  APP_LOGO_COLORS,
  DEFAULT_APP_LOGO_COLOR,
  getAppLogoColor,
  normalizeAppLogoColor
} from '../../app/app-logo-colors.mjs'

test('every colour is a usable option', () => {
  assert.ok(APP_LOGO_COLORS.length >= 2)
  for (const color of APP_LOGO_COLORS) {
    assert.match(color.background, /^#[0-9a-f]{6}$/)
    assert.ok(color.title.length > 0)
    assert.equal(getAppLogoColor(color.id).id, color.id)
  }
  assert.equal(new Set(APP_LOGO_COLORS.map((c) => c.id)).size, APP_LOGO_COLORS.length)
})

test('an unknown colour falls back rather than leaving the badge blank', () => {
  // A preference file written by a newer build, or edited by hand, must not
  // leave a hole where the logo goes.
  assert.equal(normalizeAppLogoColor('chartreuse'), DEFAULT_APP_LOGO_COLOR)
  assert.equal(normalizeAppLogoColor(undefined), DEFAULT_APP_LOGO_COLOR)
  assert.equal(getAppLogoColor(null).background, getAppLogoColor(DEFAULT_APP_LOGO_COLOR).background)
})

test('the startup screen replaces the loading line with the apps being started', async () => {
  const { readFile } = await import('node:fs/promises')
  const startup = await readFile(new URL('../../app/StartupScreen.tsx', import.meta.url), 'utf8')
  const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

  assert.match(startup, /<AppLogo color=\{logoColor\}/)
  assert.match(startup, />\s*PeerSky\s*</)
  // The apps themselves, not a spinner and not the word Starting.
  // The transparent set, the same artwork each app shows while it starts.
  assert.match(startup, /assets\/images\/loading\/peerchat\.png/)
  assert.equal((startup.match(/assets\/images\/loading\//g) || []).length, 4)
  assert.doesNotMatch(startup, /ActivityIndicator/)
  // It has to come down on its own, or a failed boot is a screen you cannot
  // leave.
  assert.match(index, /if \(!browserSessionReady\) \{\s*\n\s*return <StartupScreen/)
})

test('the logo is drawn, so a colour change is immediate and costs no assets', async () => {
  const { readFile } = await import('node:fs/promises')
  const logo = await readFile(new URL('../../app/AppLogo.tsx', import.meta.url), 'utf8')
  const appearance = await readFile(new URL('../../app/settings/Appearance.tsx', import.meta.url), 'utf8')

  assert.match(logo, /borderRadius: size \/ 2/)
  assert.match(logo, /backgroundColor: background/)
  assert.match(appearance, /APP_LOGO_COLORS\.map/)
  assert.match(appearance, /<AppLogo color=\{color\.id\} size=\{48\} \/>/)
})
