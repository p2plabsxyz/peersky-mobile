import assert from 'node:assert/strict'
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
    assert.equal(formatBrowserAddress('peersky://hyperdrive/', false), 'peersky://hyperdrive/')
  })
})
