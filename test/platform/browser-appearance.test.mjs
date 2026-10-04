import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { describe, test } from 'node:test'
import {
  BROWSER_PALETTES,
  formatBrowserAddress,
  getBrowserStatusBarStyle,
  resolveBrowserDarkMode
} from '../../app/browser-appearance.mjs'

describe('browser appearance helpers', () => {
  // A status bar set to one colour on iOS missed the system's switch between
  // light and dark until PeerSky restarted. Following the system, iOS picks.
  test('lets iOS colour the status bar when PeerSky follows the system', async () => {
    assert.equal(getBrowserStatusBarStyle('ios', 'system', true), 'default')
    assert.equal(getBrowserStatusBarStyle('ios', 'system', false), 'default')
    assert.equal(getBrowserStatusBarStyle('ios', 'dark', true), 'light-content')
    assert.equal(getBrowserStatusBarStyle('ios', 'light', false), 'dark-content')
    assert.equal(getBrowserStatusBarStyle('android', 'system', true), 'light-content')
    assert.equal(getBrowserStatusBarStyle('android', 'system', false), 'dark-content')

    const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    assert.doesNotMatch(app, /barStyle=\{browserIsDark/)
    assert.equal(app.match(/barStyle=\{browserStatusBarStyle\}/g).length, 6)
  })

  test('resolves explicit and system themes', () => {
    assert.equal(resolveBrowserDarkMode('dark', 'light'), true)
    assert.equal(resolveBrowserDarkMode('light', 'dark'), false)
    assert.equal(resolveBrowserDarkMode('system', 'dark'), true)
    assert.equal(resolveBrowserDarkMode('system', 'light'), false)
    assert.equal(resolveBrowserDarkMode('unexpected', 'dark'), true)
  })

  test('keeps the dark browser chrome aligned with PeerSky Desktop', () => {
    assert.deepEqual(BROWSER_PALETTES.dark, {
      accent: '#3b82f6',
      address: '#18181b',
      border: '#6b7280',
      button: '#27272a',
      mutedText: '#9ca3af',
      selectedBackground: '#3f3f46',
      selectedControl: '#e5e7eb',
      shell: '#18181b',
      surface: '#27272a',
      text: '#ffffff'
    })
  })

  test('shows a site address without path details when requested', () => {
    assert.equal(formatBrowserAddress('https://example.com/path?q=1', false), 'example.com')
    assert.equal(formatBrowserAddress('hyper://akhilesh.art/posts/one', false), 'akhilesh.art')
    assert.equal(formatBrowserAddress('https://example.com/path?q=1', true), 'https://example.com/path?q=1')
  })

  test('preserves incomplete input and the home address', () => {
    assert.equal(formatBrowserAddress('example', false), 'example')
    assert.equal(formatBrowserAddress('peersky://home', false), 'peersky://home')
    assert.equal(formatBrowserAddress('peersky://p2p/p2pmd/', false), 'peersky://p2p/p2pmd/')
    assert.equal(formatBrowserAddress('peersky://p2p/hyperdrive/', false), 'peersky://p2p/hyperdrive/')
  })
})

// The suggestion list and the overflow menu both floated four points clear of
// the toolbar with a full border, which reads as a card that happens to be
// nearby rather than the control opening out.
describe('popups attached to the toolbar', () => {
  test('the toolbar hands over its own height, with nothing added', async () => {
    const toolbar = await readFile(new URL('../../app/BrowserToolbar.tsx', import.meta.url), 'utf8')
    assert.match(toolbar, /setBarHeight\(event\.nativeEvent\.layout\.height\)/)
    // The seam belongs to whichever panel is open, not to both, but it keeps
    // its width either way so nothing below it moves.
    assert.match(toolbar, /const seamColor = isAddressFocused \? 'transparent' : palette\.border/)
  })

  test('the suggestion list sits on the toolbar edge', async () => {
    const toolbar = await readFile(new URL('../../app/BrowserToolbar.tsx', import.meta.url), 'utf8')
    const source = await readFile(
      new URL('../../app/history/HistorySuggestions.tsx', import.meta.url),
      'utf8'
    )

    // Siblings in a stack with no padding, so the offset is the bar's height
    // and nothing else. Inside the bar it also had to clear the bar's padding,
    // which is where the gap kept coming back.
    assert.match(toolbar, /<View style=\{styles\.browserToolbarStack\}>/)
    assert.match(source, /position === 'bottom' \? \{ bottom: offset \} : \{ top: offset \}/)
    assert.match(source, /styles\.attachedBelow : styles\.attachedAbove/)

    // Edge to edge, and only the far edge drawn, so it reads as one surface.
    assert.match(source, /left: 0/)
    assert.match(source, /right: 0/)
    // Padding, not a margin: the panel keeps reaching both screen edges while
    // its rows step in, so a row lines up with the address field rather than
    // starting against the notch in landscape.
    assert.match(source, /paddingLeft: insets\.left/)
    assert.match(source, /paddingRight: insets\.right/)
    assert.doesNotMatch(source, /borderWidth: 1/)
    // The far edge is a hairline: a full point read as a heavy rule. In the
    // light border colour a hairline all but vanished on a white page.
    assert.match(source, /borderColor: `\$\{palette\.mutedText\}66`/)
    assert.match(source, /attachedBelow: \{\n\s+borderBottomLeftRadius: 0,\n\s+borderBottomRightRadius: 0,\n\s+borderTopWidth: StyleSheet\.hairlineWidth,/)
    assert.match(source, /attachedAbove: \{\n\s+borderBottomWidth: StyleSheet\.hairlineWidth,\n\s+borderTopLeftRadius: 0,\n\s+borderTopRightRadius: 0\n\s+\}/)
    // Above a bar at the bottom, the shadow goes up onto the page. Cast down,
    // it lay across the bar as a second line where the two meet.
    const below = source.slice(source.indexOf('attachedBelow: {'), source.indexOf('attachedAbove: {'))
    assert.match(below, /shadowOffset: \{ width: 0, height: -4 \}/)
    assert.match(below, /elevation: 0/)
  })

  test('the history suggestions still hang off the toolbar', async () => {
    const source = await readFile(
      new URL('../../app/history/HistorySuggestions.tsx', import.meta.url),
      'utf8'
    )

    // The menu became a bottom sheet and stopped needing to be told where the
    // toolbar is. Suggestions still do: they belong to the address bar.
    assert.match(source, /offset/)
    assert.match(source, /position/)
  })
})

// The app allows every orientation, but a <Modal> on iOS is portrait-only
// unless it is told otherwise, so opening a sheet on a phone lying on its side
// rotated the whole app upright.
describe('sheets follow the phone', () => {
  test('every modal supports the orientations the app does', async () => {
    const root = new URL('../../app/', import.meta.url)
    const files = (await readdir(root, { recursive: true }))
      .filter((name) => name.endsWith('.tsx'))

    const missing = []
    for (const name of files) {
      const source = await readFile(new URL(name, root), 'utf8')
      for (const match of source.matchAll(/<Modal\b/g)) {
        const opening = source.slice(match.index, source.indexOf('>', match.index))
        if (!opening.includes('supportedOrientations')) missing.push(`${name}:${match.index}`)
      }
    }

    assert.deepEqual(missing, [], 'a portrait-only modal rotates the app')
  })

  test('the list is what the app itself allows', async () => {
    const source = await readFile(
      new URL('../../app/modal-orientations.ts', import.meta.url),
      'utf8'
    )
    assert.match(source, /'portrait'/)
    assert.match(source, /'landscape'/)
  })
})

// Insetting the whole shell left the toolbar stopping short of both screen
// edges in landscape, with the page colour showing beside it.
describe('chrome reaches the screen edges', () => {
  test('the shell is not inset sideways', async () => {
    const source = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /edges=\{\['left', 'right'\]\}/)
    assert.match(source, /paddingLeft: browserInsets\.left/)
  })

  test('the toolbar steps its own controls around the notch', async () => {
    const source = await readFile(new URL('../../app/BrowserToolbar.tsx', import.meta.url), 'utf8')
    assert.match(source, /paddingLeft: TOOLBAR_SIDE_PADDING \+ insets\.left/)
    assert.match(source, /paddingRight: TOOLBAR_SIDE_PADDING \+ insets\.right/)
  })

  test('the suggestion list wears the toolbar colour, not a second one', async () => {
    const toolbar = await readFile(new URL('../../app/BrowserToolbar.tsx', import.meta.url), 'utf8')
    const list = await readFile(
      new URL('../../app/history/HistorySuggestions.tsx', import.meta.url),
      'utf8'
    )
    assert.match(toolbar, /background=\{toolbarBackground\}/)
    assert.match(list, /backgroundColor: background/)
    assert.doesNotMatch(list, /backgroundColor: palette\.surface/)
  })
})
