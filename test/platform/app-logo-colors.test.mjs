import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  APP_LOGO_COLORS,
  DEFAULT_APP_LOGO_COLOR,
  getAppLogoColor,
  normalizeAppLogoColor
} from '../../app/app-logo-colors.mjs'
import { BROWSER_PALETTES } from '../../app/browser-appearance.mjs'

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

test('the startup screen is the launch image, still', async () => {
  const { readFile } = await import('node:fs/promises')
  const startup = await readFile(new URL('../../app/StartupScreen.tsx', import.meta.url), 'utf8')
  const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  const { expo } = JSON.parse(await readFile(new URL('../../app.json', import.meta.url), 'utf8'))

  // Anything the launch image does not also have is a visible change at the
  // handover, and anything that moves draws the eye to a wait.
  assert.doesNotMatch(startup, /Animated|ActivityIndicator|Easing/)
  assert.doesNotMatch(startup, /PeerSky</)
  assert.match(startup, /const BIRD_SIZE = 140/)
  // One badge for both themes: the bird alone is drawn with black outlines
  // and needs something behind it whichever background it lands on.
  assert.match(startup, /logo-badge\.png/)
  // One image, not one per theme. Only the screen behind it follows the theme.
  assert.equal((startup.match(/require\(/g) || []).length, 1)

  // The launch screen draws the same badge, at the same size, on the same
  // background as the screen that follows it.
  const [, splash] = expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen')
  assert.equal(splash.image, './assets/images/logo-badge.png')
  assert.equal(splash.dark.image, './assets/images/logo-badge.png')
  assert.equal(splash.imageWidth, 140)
  assert.equal(splash.backgroundColor, BROWSER_PALETTES.light.shell)
  assert.equal(splash.dark.backgroundColor, BROWSER_PALETTES.dark.shell)
  // The old top level key left Android 12 and later showing the launcher icon.
  assert.equal(expo.splash, undefined)

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

test('the bare bird launches, the tile sits among the other tiles', async () => {
  const { readFile } = await import('node:fs/promises')
  const apps = await readFile(new URL('../../app/internal-apps.ts', import.meta.url), 'utf8')
  const startup = await readFile(new URL('../../app/StartupScreen.tsx', import.meta.url), 'utf8')

  // The tab strip and the home grid are full of tiles, and a loose bird among
  // them reads as a missing icon rather than a different one.
  assert.match(apps, /BROWSER_HOME_ICON[^\n]*home-icon\.png/)
  // The launch image shows the badge, so the screen that follows it does too.
  assert.match(startup, /logo-badge\.png/)
  assert.doesNotMatch(startup, /home-icon\.png/)
})
