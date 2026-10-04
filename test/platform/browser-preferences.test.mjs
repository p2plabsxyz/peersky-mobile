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
        ['b'.repeat(52)]: 'block'
      },
      searchEngine: 'custom',
      showFullAddress: true,
      theme: 'dark',
      websiteTextScale: 150,
      youtubeAdBlockingEnabled: false
    }

    assert.deepEqual(
      parseBrowserPreferences(serializeBrowserPreferences(preferences)),
      preferences
    )
  })

  test('keeps only real hyper sites and real answers for publishing', () => {
    const parsed = parseBrowserPreferences({
      publishingSites: {
        ['a'.repeat(64)]: 'allow',
        'example.com': 'allow',
        ['c'.repeat(64)]: 'maybe',
        ['d'.repeat(52)]: 'block'
      }
    })
    assert.deepEqual(parsed.publishingSites, { ['a'.repeat(64)]: 'allow', ['d'.repeat(52)]: 'block' })
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
