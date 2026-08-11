import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { BROWSER_HOME_URL } from '../../app/browser-shell.mjs'
import {
  addBackgroundBrowserTabState,
  addBrowserTabState,
  closeBrowserTabState,
  createBrowserTabsState,
  getActiveBrowserTab,
  isCurrentBrowserTabEntry,
  MAX_BROWSER_TITLE_LENGTH,
  MAX_BROWSER_TABS,
  normalizeBrowserPageZoom,
  restoreBrowserTabsState,
  setBrowserTabViewModeState,
  serializeBrowserTabsState,
  suspendInactiveBrowserTabsState,
  switchBrowserTabState,
  touchLiveBrowserTabIds,
  updateBrowserTabState
} from '../../app/browser-tabs.mjs'

describe('browser tab state helpers', () => {
  test('creates an initial home tab', () => {
    const state = createBrowserTabsState()
    const active = getActiveBrowserTab(state)

    assert.equal(state.tabs.length, 1)
    assert.equal(state.activeTabId, 'tab-1')
    assert.equal(state.viewMode, 'grid')
    assert.equal(active.title, 'PeerSky')
    assert.deepEqual(active.history, [
      { url: BROWSER_HOME_URL, source: { kind: 'home' } }
    ])
  })

  test('adds and switches tabs without losing existing tab state', () => {
    let state = createBrowserTabsState()
    state = updateBrowserTabState(state, 'tab-1', {
      title: 'Akhilesh',
      history: [
        { url: BROWSER_HOME_URL, source: { kind: 'home' } },
        { url: 'hyper://akhilesh.art/', source: { kind: 'hyper', html: '<h1>A</h1>', baseUrl: 'hyper://akhilesh.art/' } }
      ],
      historyIndex: 1
    })
    state = addBrowserTabState(state)

    assert.equal(state.tabs.length, 2)
    assert.equal(state.activeTabId, 'tab-2')
    assert.equal(getActiveBrowserTab(state).history[0].url, BROWSER_HOME_URL)

    state = switchBrowserTabState(state, 'tab-1')

    assert.equal(getActiveBrowserTab(state).title, 'Akhilesh')
    assert.equal(getActiveBrowserTab(state).historyIndex, 1)
  })

  test('closes active tabs and selects a neighboring tab', () => {
    let state = createBrowserTabsState()
    state = addBrowserTabState(state)
    state = addBrowserTabState(state)

    assert.equal(state.activeTabId, 'tab-3')

    state = closeBrowserTabState(state, 'tab-3')

    assert.equal(state.tabs.length, 2)
    assert.equal(state.activeTabId, 'tab-2')
  })

  test('closing the last tab opens a fresh home tab', () => {
    const state = closeBrowserTabState(createBrowserTabsState(), 'tab-1')
    const active = getActiveBrowserTab(state)

    assert.equal(state.tabs.length, 1)
    assert.equal(state.activeTabId, 'tab-2')
    assert.equal(active.history[0].url, BROWSER_HOME_URL)
  })

  test('caps the number of open tabs', () => {
    let state = createBrowserTabsState()

    while (state.tabs.length < MAX_BROWSER_TABS) {
      state = addBrowserTabState(state)
    }

    assert.equal(addBrowserTabState(state), state)
  })

  test('restores bounded page history for each tab', () => {
    let state = createBrowserTabsState()
    state = updateBrowserTabState(state, 'tab-1', {
      title: 'Example',
      history: [
        { url: 'https://peersky.p2plabs.xyz/', source: { kind: 'web', uri: 'https://peersky.p2plabs.xyz/' } },
        { url: 'https://peersky.p2plabs.xyz/#features', source: { kind: 'web', uri: 'https://peersky.p2plabs.xyz/#features' } },
        { url: 'https://peersky.p2plabs.xyz/#downloads', source: { kind: 'web', uri: 'https://peersky.p2plabs.xyz/#downloads' } }
      ],
      historyIndex: 2
    })
    state = addBrowserTabState(state)

    const restored = restoreBrowserTabsState(serializeBrowserTabsState(state))

    assert.equal(restored.tabs.length, 2)
    assert.equal(restored.activeTabId, 'tab-2')
    assert.equal(restored.tabs[0].history.length, 3)
    assert.equal(restored.tabs[0].historyIndex, 2)
    assert.equal(restored.tabs[0].history[1].url, 'https://peersky.p2plabs.xyz/#features')
    assert.equal(restored.tabs[0].history[2].url, 'https://peersky.p2plabs.xyz/#downloads')
  })

  test('falls back safely when persisted state is malformed', () => {
    const restored = restoreBrowserTabsState('{not-json')

    assert.equal(restored.tabs.length, 1)
    assert.equal(restored.tabs[0].history[0].url, BROWSER_HOME_URL)
  })

  test('restores Hyper pages by URL so local proxy assets are regenerated', () => {
    let state = createBrowserTabsState()
    state = updateBrowserTabState(state, 'tab-1', {
      history: [{
        url: 'hyper://example/',
        source: {
          kind: 'hyper',
          html: '<h1>Cached page</h1>',
          baseUrl: 'hyper://example/'
        }
      }]
    })

    const restored = restoreBrowserTabsState(serializeBrowserTabsState(state))

    assert.deepEqual(restored.tabs[0].history[0].source, {
      kind: 'restore',
      url: 'hyper://example/'
    })
  })

  test('drops duplicate tab identifiers and advances the next tab id safely', () => {
    const restored = restoreBrowserTabsState(JSON.stringify({
      version: 1,
      activeTabId: 'tab-8',
      nextTabIndex: 2,
      tabs: [
        { id: 'tab-8', title: 'First', entry: { url: BROWSER_HOME_URL, source: { kind: 'home' } } },
        { id: 'tab-8', title: 'Duplicate', entry: { url: BROWSER_HOME_URL, source: { kind: 'home' } } }
      ]
    }))

    assert.equal(restored.tabs.length, 1)
    assert.equal(restored.nextTabIndex, 9)
  })

  test('preserves the active tab when a background tab closes', () => {
    let state = addBrowserTabState(createBrowserTabsState())
    state = closeBrowserTabState(state, 'tab-1')

    assert.equal(state.activeTabId, 'tab-2')
    assert.equal(state.tabs.length, 1)
  })

  test('adds a deferred background tab without changing the active tab', () => {
    const initialState = setBrowserTabViewModeState(createBrowserTabsState(), 'list')
    const state = addBackgroundBrowserTabState(
      initialState,
      'https://example.com/image.jpg',
      'Image'
    )

    assert.equal(state.activeTabId, 'tab-1')
    assert.equal(state.viewMode, 'list')
    assert.equal(state.tabs.length, 2)
    assert.deepEqual(state.tabs[1].history[0], {
      url: 'https://example.com/image.jpg',
      source: { kind: 'restore', url: 'https://example.com/image.jpg' }
    })
  })

  test('bounds remote-controlled tab titles', () => {
    const state = updateBrowserTabState(createBrowserTabsState(), 'tab-1', {
      title: 'x'.repeat(MAX_BROWSER_TITLE_LENGTH + 50)
    })

    assert.equal(state.tabs[0].title.length, MAX_BROWSER_TITLE_LENGTH)
  })

  test('normalizes and persists per-tab page zoom', () => {
    let state = updateBrowserTabState(createBrowserTabsState(), 'tab-1', {
      pageZoom: 125
    })

    assert.equal(state.tabs[0].pageZoom, 125)

    state = restoreBrowserTabsState(serializeBrowserTabsState(state))

    assert.equal(state.tabs[0].pageZoom, 125)
    assert.equal(normalizeBrowserPageZoom(999), 100)
  })

  test('normalizes and persists per-tab desktop view', () => {
    let state = updateBrowserTabState(createBrowserTabsState(), 'tab-1', {
      desktopView: true
    })

    assert.equal(state.tabs[0].desktopView, true)

    state = restoreBrowserTabsState(serializeBrowserTabsState(state))

    assert.equal(state.tabs[0].desktopView, true)
  })

  test('normalizes and persists the tab manager view mode', () => {
    let state = setBrowserTabViewModeState(createBrowserTabsState(), 'list')

    assert.equal(state.viewMode, 'list')

    state = restoreBrowserTabsState(serializeBrowserTabsState(state))

    assert.equal(state.viewMode, 'list')
    assert.equal(
      restoreBrowserTabsState({
        ...JSON.parse(serializeBrowserTabsState(state)),
        viewMode: 'unsupported'
      }).viewMode,
      'grid'
    )
  })

  test('preserves list view when closing the last tab', () => {
    const listState = setBrowserTabViewModeState(createBrowserTabsState(), 'list')
    const state = closeBrowserTabState(listState, 'tab-1')

    assert.equal(state.tabs.length, 1)
    assert.equal(state.viewMode, 'list')
  })

  test('accepts callbacks from the same synchronized native WebView only', () => {
    const originalEntry = { url: 'https://example.com/', source: { kind: 'web', uri: 'https://example.com/' } }
    let state = updateBrowserTabState(createBrowserTabsState(), 'tab-1', { history: [originalEntry] })
    state = updateBrowserTabState(state, 'tab-1', {
      history: [{ url: 'https://example.com/final', source: { kind: 'web', uri: 'https://example.com/final' } }]
    })

    assert.equal(isCurrentBrowserTabEntry(state, 'tab-1', originalEntry), true)
    assert.equal(isCurrentBrowserTabEntry(state, 'missing', originalEntry), false)
  })

  test('rejects persisted web sources that do not match a safe entry URL', () => {
    const restored = restoreBrowserTabsState(JSON.stringify({
      version: 1,
      activeTabId: 'tab-1',
      nextTabIndex: 2,
      tabs: [{
        id: 'tab-1',
        title: 'Unsafe',
        entry: {
          url: 'https://example.com/',
          source: { kind: 'web', uri: 'file:///data/local/private' }
        }
      }]
    }))

    assert.deepEqual(restored.tabs[0].history[0].source, {
      kind: 'restore',
      url: 'https://example.com/'
    })
  })

  test('keeps only the five most recently used WebViews live', () => {
    let liveTabIds = []
    for (const tabId of ['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5', 'tab-6']) {
      liveTabIds = touchLiveBrowserTabIds(liveTabIds, tabId)
    }

    assert.deepEqual(liveTabIds, ['tab-2', 'tab-3', 'tab-4', 'tab-5', 'tab-6'])
  })

  test('releases rendered state for inactive Hyper tabs', () => {
    let state = createBrowserTabsState()
    const originalEntry = {
      url: 'hyper://example/',
      source: { kind: 'hyper', html: '<h1>large page</h1>', baseUrl: 'hyper://example/' }
    }
    state = updateBrowserTabState(state, 'tab-1', { history: [originalEntry] })
    state = addBrowserTabState(state)
    state = suspendInactiveBrowserTabsState(state, ['tab-2'])

    assert.deepEqual(state.tabs[0].history[0], {
      url: 'hyper://example/',
      source: { kind: 'restore', url: 'hyper://example/' }
    })
    assert.equal(isCurrentBrowserTabEntry(state, 'tab-1', originalEntry), false)
  })

  test('never suspends the active tab while the live-view list catches up', () => {
    let state = createBrowserTabsState()
    const entry = {
      url: 'hyper://active/',
      source: { kind: 'hyper', html: '<h1>active</h1>', baseUrl: 'hyper://active/' }
    }
    state = updateBrowserTabState(state, 'tab-1', { history: [entry] })

    const nextState = suspendInactiveBrowserTabsState(state, [])

    assert.equal(nextState.tabs[0].history[0], entry)
  })
})
