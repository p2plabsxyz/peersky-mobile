import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import {
  BROWSER_PALETTES,
  formatBrowserAddress,
  resolveBrowserDarkMode
} from '../../app/browser-appearance.mjs'

describe('browser appearance helpers', () => {
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
    assert.match(toolbar, /setMenuOffset\(event\.nativeEvent\.layout\.height\)/)
    // The seam belongs to whichever panel is open, not to both.
    assert.match(toolbar, /borderTopWidth: isAddressFocused \? 0 : 1/)
    assert.match(toolbar, /borderBottomWidth: isAddressFocused \? 0 : 1/)
  })

  test('the suggestion list sits on the toolbar edge', async () => {
    const source = await readFile(
      new URL('../../app/history/HistorySuggestions.tsx', import.meta.url),
      'utf8'
    )
    assert.match(source, /position === 'bottom' \? \{ bottom: offset \} : \{ top: offset \}/)
    assert.match(source, /styles\.attachedBelow : styles\.attachedAbove/)
    for (const edge of ['attachedBelow', 'attachedAbove']) {
      assert.ok(source.includes(`${edge}: {`), `${edge} should exist`)
    }
    assert.match(source, /borderBottomWidth: 0/)
    assert.match(source, /borderTopWidth: 0/)
  })

  test('the overflow menu sits on the toolbar edge', async () => {
    const source = await readFile(
      new URL('../../app/settings/BrowserOverflowMenu.tsx', import.meta.url),
      'utf8'
    )
    assert.match(source, /\{ bottom: offset \+ insets\.bottom \}/)
    assert.match(source, /\{ top: offset \+ insets\.top \}/)
    assert.match(source, /menuAttachment/)
    assert.match(source, /borderBottomLeftRadius: 0/)
    assert.match(source, /borderTopLeftRadius: 0/)
  })
})
