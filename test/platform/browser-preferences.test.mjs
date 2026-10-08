import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  DEFAULT_BROWSER_PREFERENCES,
  parseBrowserPreferences,
  serializeBrowserPreferences
} from '../../app/settings/browser-preferences.mjs'

describe('browser preferences', () => {
  test('uses safe defaults for missing or malformed preferences', () => {
    assert.deepEqual(parseBrowserPreferences(null), DEFAULT_BROWSER_PREFERENCES)
    assert.deepEqual(parseBrowserPreferences('{invalid'), DEFAULT_BROWSER_PREFERENCES)
  })

  test('restores supported browser preferences', () => {
    const preferences = {
      addressBarPosition: 'bottom',
      appLogoColor: 'violet',
      contentBlockingEnabled: false,
      customSearchUrl: 'https://example.com/search?q=%s',
      downloadOnlyOnWifi: true,
      enforceManualPageZoom: true,
      externalLinkBehavior: 'allow',
      forceDarkWebsites: true,
      publishingSites: {
        ['a'.repeat(64)]: 'allow',
        ['b'.repeat(52)]: 'block',
        'agregore.mauve.moe': 'allow',
        'https://agregore.mauve.moe': 'block'
      },
      searchEngine: 'custom',
      showFullAddress: true,
      theme: 'dark',
      toolbarButton: 'new-tab',
      websiteTextScale: 150,
      youtubeAdBlockingEnabled: false
    }

    assert.deepEqual(
      parseBrowserPreferences(serializeBrowserPreferences(preferences)),
      preferences
    )
  })

  // The middle of the bottom bar: the burn button unless another is chosen,
  // and the burn button again for anything this build does not know.
  test('keeps the toolbar button to the ones the bar can show', () => {
    assert.equal(parseBrowserPreferences({}).toolbarButton, 'burn')
    assert.equal(parseBrowserPreferences({ toolbarButton: 'zoom' }).toolbarButton, 'zoom')
    assert.equal(parseBrowserPreferences({ toolbarButton: 'launch-rockets' }).toolbarButton, 'burn')
    assert.equal(parseBrowserPreferences({ toolbarButton: 42 }).toolbarButton, 'burn')
  })

  test('keeps only real sites and real answers for publishing', () => {
    const parsed = parseBrowserPreferences({
      publishingSites: {
        ['a'.repeat(64)]: 'allow',
        'not a site': 'allow',
        'http://example.com': 'allow',
        'https://example.com/path': 'allow',
        ['c'.repeat(64)]: 'maybe',
        ['d'.repeat(52)]: 'block',
        'example.com': 'block',
        'https://example.com': 'allow'
      }
    })
    assert.deepEqual(parsed.publishingSites, {
      ['a'.repeat(64)]: 'allow',
      ['d'.repeat(52)]: 'block',
      'example.com': 'block',
      'https://example.com': 'allow'
    })
    assert.deepEqual(parseBrowserPreferences({ publishingSites: ['allow'] }).publishingSites, {})
  })

  test('rejects unsupported preference values independently', () => {
    assert.deepEqual(parseBrowserPreferences({
      addressBarPosition: 'side',
      appLogoColor: 'chartreuse',
      contentBlockingEnabled: 'yes',
      customSearchUrl: 'http://example.com/search?q=%s',
      downloadOnlyOnWifi: 'yes',
      enforceManualPageZoom: 'yes',
      externalLinkBehavior: 'always',
      forceDarkWebsites: 'yes',
      searchEngine: 'brave',
      showFullAddress: 'yes',
      theme: 'sepia',
      websiteTextScale: 500,
      youtubeAdBlockingEnabled: 'yes'
    }), DEFAULT_BROWSER_PREFERENCES)
  })

  test('fills missing appearance preferences with defaults', () => {
    assert.deepEqual(parseBrowserPreferences({
      searchEngine: 'custom',
      customSearchUrl: 'https://search.example/?query=%s'
    }), {
      ...DEFAULT_BROWSER_PREFERENCES,
      searchEngine: 'custom',
      customSearchUrl: 'https://search.example/?query=%s'
    })
  })

  test('drops malformed and credentialed custom search URLs', () => {
    for (const customSearchUrl of [
      'https://example.com/search',
      'http://example.com/?q=%s',
      'https://user:password@example.com/?q=%s',
      'not-a-url?q=%s'
    ]) {
      assert.equal(parseBrowserPreferences({ customSearchUrl }).customSearchUrl, '')
    }
  })
})
