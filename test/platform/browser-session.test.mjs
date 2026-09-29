import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  createBrowserResetSession,
  getSettingsReturnPage,
  resolveBrowserStartupSession
} from '../../app/browser-session.mjs'
import {
  addBrowserTabState,
  createBrowserTabsState,
  serializeBrowserTabsState
} from '../../app/browser-tabs.mjs'

describe('browser session lifecycle', () => {
  test('always restores a saved session', () => {
    const saved = addBrowserTabState(createBrowserTabsState())
    const restored = resolveBrowserStartupSession({
      serializedSession: serializeBrowserTabsState(saved),
      userInteracted: false
    })

    assert.equal(restored.tabs.length, 2)
    assert.equal(restored.activeTabId, saved.activeTabId)
  })

  test('skips restoration only when there is no saved session', () => {
    assert.equal(resolveBrowserStartupSession({
      serializedSession: null,
      userInteracted: false
    }), null)

    // A first run has nothing to restore. Every later start does, and there is
    // no longer a switch that can throw it away.
    assert.notEqual(resolveBrowserStartupSession({
      serializedSession: serializeBrowserTabsState(createBrowserTabsState()),
      userInteracted: false
    }), null)
  })

  test('falls back safely when the saved session is malformed', () => {
    const restored = resolveBrowserStartupSession({
      serializedSession: '{invalid',
      userInteracted: false
    })

    assert.equal(restored.tabs.length, 1)
    assert.equal(restored.tabs[0].history[0].source.kind, 'home')
  })

  test('does not overwrite navigation started while restoration was loading', () => {
    assert.equal(resolveBrowserStartupSession({
      serializedSession: serializeBrowserTabsState(createBrowserTabsState()),
      userInteracted: true
    }), null)
  })

  test('resets tabs live views and persisted state to one fresh home tab', () => {
    const webViewRefs = new Map([
      ['tab-1', {}],
      ['tab-2', {}]
    ])
    const reset = createBrowserResetSession(webViewRefs, 'list')
    const restored = resolveBrowserStartupSession({
      serializedSession: reset.serializedSession,
      userInteracted: false
    })

    assert.equal(reset.tabsState.tabs.length, 1)
    assert.equal(webViewRefs.size, 0)
    assert.deepEqual(reset.liveTabIds, [reset.tabsState.activeTabId])
    assert.equal(reset.tabsState.tabs[0].history[0].source.kind, 'home')
    assert.equal(reset.tabsState.viewMode, 'list')
    assert.equal(restored.tabs.length, 1)
    assert.equal(restored.tabs[0].history[0].source.kind, 'home')
    assert.equal(restored.viewMode, 'list')
  })

  // Settings closes to show the link, so back had nothing of settings left to
  // return to and dropped the user wherever the tab was before.
  test('back returns to the settings page a link was opened from', () => {
    const pending = { page: 'about', tabId: 'tab-1', url: 'https://github.com/p2plabsxyz/peersky-mobile' }

    assert.equal(
      getSettingsReturnPage(pending, { tabId: 'tab-1', url: pending.url }),
      'about'
    )
    // Followed a link from there: back belongs to history again.
    assert.equal(
      getSettingsReturnPage(pending, { tabId: 'tab-1', url: `${pending.url}/issues` }),
      null
    )
    // A different tab is a different place entirely.
    assert.equal(
      getSettingsReturnPage(pending, { tabId: 'tab-2', url: pending.url }),
      null
    )
    assert.equal(getSettingsReturnPage(null, { tabId: 'tab-1', url: pending.url }), null)
  })
})
