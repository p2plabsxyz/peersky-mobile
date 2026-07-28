import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
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

  test('shows a site address without path details when requested', () => {
    assert.equal(formatBrowserAddress('https://example.com/path?q=1', false), 'example.com')
    assert.equal(formatBrowserAddress('hyper://akhilesh.art/posts/one', false), 'akhilesh.art')
    assert.equal(formatBrowserAddress('https://example.com/path?q=1', true), 'https://example.com/path?q=1')
  })

  test('preserves incomplete input and the home address', () => {
    assert.equal(formatBrowserAddress('example', false), 'example')
    assert.equal(formatBrowserAddress('peersky://home', false), 'peersky://home')
  })
})
