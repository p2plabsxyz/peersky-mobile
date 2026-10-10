import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// A browser that answers a tap at once: a ripple on Android, a dim on iOS, and
// a line that fills as the page loads.

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8')

test('the bottom bar, the address bar and the menu answer a press', async () => {
  const feedback = await read('app/press-feedback.ts')
  assert.match(feedback, /export const ICON_RIPPLE[\s\S]{0,120}Platform\.OS === 'android'/)
  assert.match(feedback, /return pressed && Platform\.OS !== 'android' \? DIMMED : null/)
  // A borderless ripple never drew; a bounded one clipped round does.
  assert.doesNotMatch(feedback, /borderless: true/)
  assert.match(feedback, /export const ROUND_PRESS = Platform\.OS === 'android'\s+\? \{ borderRadius: 999, overflow: 'hidden' as const \}/)

  const nav = await read('app/BrowserNavBar.tsx')
  assert.equal(nav.match(/android_ripple=\{ICON_RIPPLE\}/g)?.length, 2)
  const toolbar = await read('app/BrowserToolbar.tsx')
  assert.equal(toolbar.match(/android_ripple=\{SMALL_ICON_RIPPLE\}/g)?.length, 5)
  const menu = await read('app/settings/BrowserOverflowMenu.tsx')
  assert.equal(menu.match(/android_ripple=\{ROW_RIPPLE\}/g)?.length, 2)
  assert.match(menu, /android_ripple=\{ICON_RIPPLE\}/)
})

test('a line along the address bar fills as the page loads', async () => {
  const toolbar = await read('app/BrowserToolbar.tsx')
  assert.match(toolbar, /<BrowserLoadProgress[\s\S]{0,200}isLoading=\{isLoading && !isAddressFocused\}/)
  const app = await read('app/index.tsx')
  assert.match(app, /onLoadProgress=\{\(event\) => \{\s+if \(browserTabsStateRef\.current\.activeTabId !== tab\.id\) return/)
  assert.match(app, /toValue: Math\.max\(0\.08, progress\),\s+useNativeDriver: false/)
  // On Android a load shows as loading from its first progress, not from when
  // the server answers.
  assert.match(app, /const loading = progress < 1\s+if \(loading !== browserIsLoadingRef\.current\) \{\s+browserIsLoadingRef\.current = loading\s+setBrowserIsLoading\(loading\)/)
  const bar = await read('app/BrowserLoadProgress.tsx')
  assert.match(bar, /width: progress\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \['0%', '100%'\] \}\)/)
})
