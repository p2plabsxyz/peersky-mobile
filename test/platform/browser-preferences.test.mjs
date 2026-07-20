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
      restoreTabsOnStartup: false,
      searchEngine: 'brave',
      showFullAddress: true,
      theme: 'dark'
    }

    assert.deepEqual(
      parseBrowserPreferences(serializeBrowserPreferences(preferences)),
      preferences
    )
  })

  test('rejects unsupported preference values independently', () => {
    assert.deepEqual(parseBrowserPreferences({
      addressBarPosition: 'side',
      restoreTabsOnStartup: 'yes',
      searchEngine: 'custom',
      showFullAddress: 'yes',
      theme: 'sepia'
    }), DEFAULT_BROWSER_PREFERENCES)
  })

  test('fills missing appearance preferences with defaults', () => {
    assert.deepEqual(parseBrowserPreferences({
      restoreTabsOnStartup: false,
      searchEngine: 'google'
    }), {
      ...DEFAULT_BROWSER_PREFERENCES,
      restoreTabsOnStartup: false,
      searchEngine: 'google'
    })
  })
})
