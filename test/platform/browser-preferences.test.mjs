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
      customSearchUrl: 'https://example.com/search?q=%s',
      enforceManualPageZoom: true,
      externalLinkBehavior: 'allow',
      restoreTabsOnStartup: false,
      searchEngine: 'custom',
      showFullAddress: true,
      theme: 'dark',
      websiteTextScale: 150
    }

    assert.deepEqual(
      parseBrowserPreferences(serializeBrowserPreferences(preferences)),
      preferences
    )
  })

  test('rejects unsupported preference values independently', () => {
    assert.deepEqual(parseBrowserPreferences({
      addressBarPosition: 'side',
      customSearchUrl: 'http://example.com/search?q=%s',
      enforceManualPageZoom: 'yes',
      externalLinkBehavior: 'always',
      restoreTabsOnStartup: 'yes',
      searchEngine: 'brave',
      showFullAddress: 'yes',
      theme: 'sepia',
      websiteTextScale: 500
    }), DEFAULT_BROWSER_PREFERENCES)
  })

  test('fills missing appearance preferences with defaults', () => {
    assert.deepEqual(parseBrowserPreferences({
      restoreTabsOnStartup: false,
      searchEngine: 'custom',
      customSearchUrl: 'https://search.example/?query=%s'
    }), {
      ...DEFAULT_BROWSER_PREFERENCES,
      restoreTabsOnStartup: false,
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
