import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createBrowserAccessibilityScript } from '../../app/browser-accessibility.mjs'

describe('browser accessibility', () => {
  test('creates a script with validated text scaling and zoom enforcement', () => {
    const script = createBrowserAccessibilityScript({
      applyTextScale: true,
      enforceManualPageZoom: true,
      pageZoom: 125,
      websiteTextScale: 120
    })

    assert.match(script, /-webkit-text-size-adjust', '150%'/)
    assert.match(script, /user-scalable=yes/)
    assert.match(script, /maximum-scale=5/)
    assert.match(script, /\^\(user-scalable\|maximum-scale\)/)
    assert.doesNotMatch(script, /\^\(width\|initial-scale/)
  })

  test('falls back to safe values for unsupported input', () => {
    const script = createBrowserAccessibilityScript({
      applyTextScale: 'yes',
      enforceManualPageZoom: 'yes',
      pageZoom: 999,
      websiteTextScale: '100%); alert(1)'
    })

    assert.match(script, /-webkit-text-size-adjust', '100%'/)
    assert.doesNotMatch(script, /alert/)
    assert.match(script, /if \(false\)/)
  })

  test('restores the original viewport when zoom enforcement is disabled', () => {
    const script = createBrowserAccessibilityScript({
      applyTextScale: false,
      enforceManualPageZoom: false,
      websiteTextScale: 100
    })

    assert.match(script, /viewport\.hasAttribute\(marker\)/)
    assert.match(script, /viewport\.setAttribute\('content', original\)/)
    assert.match(script, /width=device-width, initial-scale=1/)
    assert.doesNotMatch(script, /viewport\.remove\(\)/)
  })

  test('can request a desktop-width viewport', () => {
    const script = createBrowserAccessibilityScript({
      applyTextScale: false,
      desktopView: true,
      enforceManualPageZoom: false,
      websiteTextScale: 100
    })

    assert.match(script, /width=1024/)
    assert.match(script, /initial-scale=/)
    assert.match(script, /minimum-scale=/)
    assert.match(script, /window\.screen/)
    assert.match(script, /\^\(width\|initial-scale\|minimum-scale\|user-scalable\|maximum-scale\)/)
  })
})
