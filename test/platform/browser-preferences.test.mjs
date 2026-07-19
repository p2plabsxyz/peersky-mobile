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
      restoreTabsOnStartup: false,
      searchEngine: 'brave'
    }

    assert.deepEqual(
      parseBrowserPreferences(serializeBrowserPreferences(preferences)),
      preferences
    )
  })

  test('rejects unsupported preference values independently', () => {
    assert.deepEqual(parseBrowserPreferences({
      restoreTabsOnStartup: 'yes',
      searchEngine: 'custom'
    }), DEFAULT_BROWSER_PREFERENCES)
  })
})
