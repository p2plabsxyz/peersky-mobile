import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  createBrowserResetSession,
  resolveBrowserStartupSession
} from '../../app/browser-session.mjs'
import {
  addBrowserTabState,
  createBrowserTabsState,
  serializeBrowserTabsState
} from '../../app/browser-tabs.mjs'

describe('browser session lifecycle', () => {
  test('restores a saved session when startup restoration is enabled', () => {
    const saved = addBrowserTabState(createBrowserTabsState())
    const restored = resolveBrowserStartupSession({
      restoreTabsOnStartup: true,
      serializedSession: serializeBrowserTabsState(saved),
      userInteracted: false
    })

    assert.equal(restored.tabs.length, 2)
    assert.equal(restored.activeTabId, saved.activeTabId)
  })

  test('skips restoration when disabled or when no session exists', () => {
    const serializedSession = serializeBrowserTabsState(createBrowserTabsState())

    assert.equal(resolveBrowserStartupSession({
      restoreTabsOnStartup: false,
      serializedSession,
      userInteracted: false
    }), null)
    assert.equal(resolveBrowserStartupSession({
      restoreTabsOnStartup: true,
      serializedSession: null,
      userInteracted: false
    }), null)
  })

  test('falls back safely when the saved session is malformed', () => {
    const restored = resolveBrowserStartupSession({
      restoreTabsOnStartup: true,
      serializedSession: '{invalid',
      userInteracted: false
    })

    assert.equal(restored.tabs.length, 1)
    assert.equal(restored.tabs[0].history[0].source.kind, 'home')
  })

  test('does not overwrite navigation started while restoration was loading', () => {
    assert.equal(resolveBrowserStartupSession({
      restoreTabsOnStartup: true,
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
      restoreTabsOnStartup: true,
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
})
