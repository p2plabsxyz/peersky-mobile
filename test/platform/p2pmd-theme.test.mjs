// P2PMD was written dark and only dark, with colours spelled out wherever they
// were needed. The rule now is that every colour is a token, because a literal
// anywhere is a colour that cannot follow the theme.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const server = await readFile(new URL('../../backend/p2pmd/server.mjs', import.meta.url), 'utf8')
const stylesheet = server.slice(server.indexOf('    <style>'), server.indexOf('    </style>'))
const rootBlocks = stylesheet.slice(0, stylesheet.indexOf('body {'))
const rules = stylesheet.slice(stylesheet.indexOf('body {'))

test('P2PMD spells its colours out once, in the palettes', () => {
  const literals = rules.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []
  assert.deepEqual(literals, [], `literal colours outside the palettes: ${literals.join(', ')}`)
})

test('P2PMD defines a light palette, not a filter over the dark one', () => {
  assert.match(rootBlocks, /:root \{/)
  assert.match(rootBlocks, /@media \(prefers-color-scheme: light\)/)
  assert.match(rootBlocks, /:root\[data-theme="light"\] \{/)

  // Every token the dark palette defines has to exist in light too, or that
  // one colour stays dark on a light page and nobody notices until it looks
  // wrong on someone's phone.
  const tokensIn = (block) => new Set([...block.matchAll(/^\s*(--[a-z-]+):/gm)].map((m) => m[1]))
  const dark = tokensIn(rootBlocks.slice(0, rootBlocks.indexOf('@media')))
  const light = tokensIn(rootBlocks.slice(rootBlocks.indexOf(':root[data-theme="light"]')))

  const fonts = new Set(['--ui-font', '--editor-font', '--editor-font-size', '--editor-line-height'])
  // Slides are paper in both themes, so they are deliberately not overridden.
  const missing = [...dark].filter((token) => (
    !light.has(token) && !fonts.has(token) && !token.startsWith('--slide-')
  ))
  assert.deepEqual(missing, [], `tokens with no light value: ${missing.join(', ')}`)
})

test('P2PMD keeps slides on paper in both themes', () => {
  // A deck is projected at a room, not read in bed.
  const lightBlock = rootBlocks.slice(rootBlocks.indexOf(':root[data-theme="light"]'))
  assert.doesNotMatch(lightBlock, /--slide-/)
})

test('the app tells the page which theme it is in', async () => {
  const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

  // The browser has its own light/dark/system setting and the WebView cannot
  // see it, so the media query alone would follow the phone instead.
  assert.match(app, /injectedJavaScriptBeforeContentLoaded=\{p2pmdThemeScript\(browserIsDark\)\}/)
  assert.match(app, /document\.documentElement\.dataset\.theme/)
  // And again when the setting changes with the editor already open.
  assert.match(app, /useEffect\(\(\) => \{\s*p2pmdWebViewRef\.current\?\.injectJavaScript\(p2pmdThemeScript\(browserIsDark\)\)/)
})

test('the chrome around the editor turns light too', async () => {
  const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  const sheet = await readFile(new URL('../../app/styles.ts', import.meta.url), 'utf8')

  assert.match(app, /const p2pmdTheme = browserIsDark \? null : p2pmdLight/)
  // A status bar left dark over a light header is the tell that the chrome
  // was forgotten.
  assert.doesNotMatch(app, /backgroundColor='#1f2027' barStyle='light-content'/)

  // Every override has to name a style that exists, or it silently does
  // nothing.
  const overrides = [...sheet.slice(sheet.indexOf('export const p2pmdLight'))
    .matchAll(/^ {2}([a-zA-Z0-9]+):/gm)].map((m) => m[1])
  assert.ok(overrides.length > 20, `only ${overrides.length} overrides`)
  for (const key of overrides) {
    assert.ok(sheet.includes(`  ${key}: {`), `${key} has no base style`)
  }
})

test('every override is actually reached by the screen that needs it', async () => {
  const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  const sheet = await readFile(new URL('../../app/styles.ts', import.meta.url), 'utf8')

  // An override defined but never applied is the failure that left the start
  // screen with dark inputs and unreadable headings on a white page. It type
  // checks and lints clean; only looking at it on a phone catches it.
  const overrides = [...sheet.slice(sheet.indexOf('export const p2pmdLight'))
    .matchAll(/^ {2}([a-zA-Z0-9]+):/gm)].map((m) => m[1])
  const unused = overrides.filter((key) => !app.includes(`p2pmdTheme?.${key}`))
  assert.deepEqual(unused, [], `overrides nothing uses: ${unused.join(', ')}`)
})

test('nothing with a colour is left without a light value by accident', async () => {
  const sheet = await readFile(new URL('../../app/styles.ts', import.meta.url), 'utf8')
  const base = sheet.slice(0, sheet.indexOf('export const p2pmdLight'))
  const overrides = new Set([...sheet.slice(sheet.indexOf('export const p2pmdLight'))
    .matchAll(/^ {2}([a-zA-Z0-9]+):/gm)].map((m) => m[1]))

  // These stay as they are on purpose: white sitting on an accent fill reads
  // the same either way, and a camera viewfinder is dark in both themes.
  const deliberate = new Set([
    'p2pmdPreviewButton', 'p2pmdPreviewButtonText', 'p2pmdEyeIcon', 'p2pmdEyeIconDot',
    'p2pmdPencilBody', 'p2pmdPencilTip', 'p2pmdPrimaryAction', 'p2pmdPrimaryActionText',
    'p2pmdActionHint', 'p2pmdScanner', 'p2pmdScanCorner', 'p2pmdScanHint',
    'p2pmdScannerCloseText'
  ])

  const unthemed = [...base.matchAll(/^ {2}(p2pmd[A-Za-z]+): \{(.*?)^ {2}\},?$/gms)]
    .filter(([, , body]) => /#[0-9a-fA-F]{3,8}/.test(body))
    .map(([, key]) => key)
    .filter((key) => !overrides.has(key) && !deliberate.has(key))

  assert.deepEqual(unthemed, [], `dark-only styles with no light value: ${unthemed.join(', ')}`)
})

test('the P2PMD tab says note, not room', async () => {
  const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  const start = app.indexOf("activeTab === 'p2pmd' && (")
  const tab = app.slice(start, app.indexOf('onBarcodeScanned', start))

  // Only what a reader sees. roomKey, p2pmdRoom and the rest are the wire
  // names and stay as they are.
  const labels = [...tab.matchAll(/>([^<>{}]*\broom\b[^<>{}]*)</gi)].map((m) => m[1].trim())
  assert.deepEqual(labels, [], `still says room: ${labels.join(' | ')}`)
})
