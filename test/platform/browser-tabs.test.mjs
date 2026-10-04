import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { BROWSER_HOME_URL } from '../../app/browser-shell.mjs'
import {
  addBackgroundBrowserTabState,
  addBrowserTabState,
  appendIncomingBrowserTabs,
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
    assert.equal(active.title, 'New tab')
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

  test('closing a tab goes back to the tab that opened it, while that is open', () => {
    let state = createBrowserTabsState()
    state = addBrowserTabState(state)
    state = addBrowserTabState({ ...addBrowserTabState(state), activeTabId: 'tab-1' })

    assert.equal(state.activeTabId, 'tab-4')
    assert.equal(closeBrowserTabState(state, 'tab-4', 'tab-1').activeTabId, 'tab-1')
    // Its opener is gone: the neighbour, as before.
    assert.equal(closeBrowserTabState(state, 'tab-4', 'tab-9').activeTabId, 'tab-3')
    // A tab that is not on screen goes without moving the one that is.
    assert.equal(closeBrowserTabState(state, 'tab-2', 'tab-1').activeTabId, 'tab-4')
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

  test('restores every built-in app tab, suffix and all', () => {
    // The old hardcoded URL map went stale whenever an app was added, and
    // compared exact strings, so a shared link carrying a #playlist suffix
    // dropped to the restore spinner instead of opening the app.
    const cases = [
      ['peersky://p2p/peertunes/', 'peertunes'],
      ['peersky://p2p/peertunes/#playlist=hyper%3A%2F%2Fabc%2Fmusic%2F', 'peertunes'],
      ['peersky://p2p/peerchat/', 'peerchat'],
      ['peersky://p2p/hyperdrive/', 'hyper'],
      ['peersky://p2p/p2pmd/', 'p2pmd']
    ]

    for (const [url, app] of cases) {
      const restored = restoreBrowserTabsState(JSON.stringify({
        version: 1,
        activeTabId: 'tab-1',
        viewMode: 'grid',
        tabs: [{
          id: 'tab-1',
          title: app,
          historyIndex: 0,
          history: [{ url, source: { kind: 'app', app } }]
        }]
      }))

      assert.deepEqual(
        restored.tabs[0].history[0].source,
        { kind: 'app', app },
        `${url} should restore straight into ${app}`
      )
    }
  })

  // A tab left on the Holesail check in a debug build must not reopen the
  // development tool in a release build. It restores as a plain address.
  test('a Holesail tab does not reopen the dev tool in a release build', () => {
    const restored = restoreBrowserTabsState(JSON.stringify({
      version: 1,
      activeTabId: 'tab-1',
      viewMode: 'grid',
      tabs: [{
        id: 'tab-1',
        title: 'Holesail',
        historyIndex: 0,
        history: [{ url: 'peersky://holesail/', source: { kind: 'app', app: 'holesail' } }]
      }]
    }))

    assert.deepEqual(restored.tabs[0].history[0].source, { kind: 'restore', url: 'peersky://holesail/' })
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

// Tabs that arrive from the desktop through Link Device. They used to replace
// browser-tabs.json with a file the phone could not read, which left one empty
// tab: the phone's tabs gone and none of the desktop's.
describe('tabs from another device', () => {
  const open = (url) => ({ url, source: { kind: 'web', uri: url } })

  test('join the tabs already open, and the tab on screen stays on screen', () => {
    const state = restoreBrowserTabsState(JSON.stringify({
      version: 1,
      activeTabId: 'tab-4',
      nextTabIndex: 5,
      viewMode: 'grid',
      tabs: [{ id: 'tab-4', title: 'Phone', historyIndex: 0, history: [open('https://phone.example/')] }]
    }))

    const next = appendIncomingBrowserTabs(state, {
      tabs: [
        { url: 'https://desktop.example/', title: 'Desktop' },
        { url: `hyper://${'a'.repeat(52)}/`, title: 'A hyper site' },
        // Already open here, so not opened twice.
        { url: 'https://phone.example/', title: 'Duplicate' },
        { url: 'peersky://settings', title: 'Desktop only' },
        { url: 'javascript:alert(1)', title: 'No' },
        { title: 'No address' }
      ]
    })

    assert.equal(next.activeTabId, 'tab-4')
    assert.deepEqual(next.tabs.map((tab) => tab.id), ['tab-4', 'tab-5', 'tab-6'])
    assert.deepEqual(next.tabs.map((tab) => tab.history[0].url), [
      'https://phone.example/',
      'https://desktop.example/',
      `hyper://${'a'.repeat(52)}/`
    ])
    assert.deepEqual(next.tabs[1].history[0].source, { kind: 'web', uri: 'https://desktop.example/' })
    assert.deepEqual(next.tabs[2].history[0].source, { kind: 'restore', url: `hyper://${'a'.repeat(52)}/` })
    assert.equal(next.tabs[1].title, 'Desktop')
    assert.equal(next.nextTabIndex, 7)

    // The result survives a save and a restart.
    const saved = restoreBrowserTabsState(serializeBrowserTabsState(next))
    assert.equal(saved.tabs.length, 3)
  })

  test('never go past the tab limit or reuse an id', () => {
    const state = createBrowserTabsState()
    const many = Array.from({ length: MAX_BROWSER_TABS + 10 }, (_, index) => ({ url: `https://example.com/${index}` }))
    const next = appendIncomingBrowserTabs({ ...state, nextTabIndex: 1 }, { tabs: many })

    assert.equal(next.tabs.length, MAX_BROWSER_TABS)
    assert.equal(new Set(next.tabs.map((tab) => tab.id)).size, MAX_BROWSER_TABS)
    assert.equal(appendIncomingBrowserTabs(state, { tabs: [] }), state)
    assert.equal(appendIncomingBrowserTabs(state, null), state)
  })
})

// Chrome and Safari keep tabs in the order they were opened, newest last, and
// open the tab screen on the tab you are on.
describe('tab order', () => {
  test('a new tab, in front or behind, goes after the others', () => {
    let state = createBrowserTabsState()
    state = addBrowserTabState(state)
    state = addBackgroundBrowserTabState(state, 'https://example.com/', 'Example')
    assert.deepEqual(state.tabs.map((tab) => tab.id), ['tab-1', 'tab-2', 'tab-3'])
    assert.equal(state.activeTabId, 'tab-2')
  })

  test('the tab screen opens scrolled to the active tab', async () => {
    const { readFile } = await import('node:fs/promises')
    const screen = await readFile(new URL('../../app/tabs/BrowserTabsScreen.tsx', import.meta.url), 'utf8')
    assert.match(screen, /const activeRow = activeIndex < 0 \? 0 : isList \? activeIndex : Math\.floor\(activeIndex \/ 2\)/)
    assert.match(screen, /onLayout=\{scrollToActiveTab\}/)
    assert.match(screen, /scrollToIndex\(\{ index: activeRow, viewPosition: 0\.5, animated: false \}\)/)
  })
})
