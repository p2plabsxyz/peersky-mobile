import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  BROWSER_HOME_URL,
  commitBrowserEntryState,
  getBrowserBackState,
  getBrowserForwardState,
  getBrowserRequestAction,
  getBrowserWebViewKey,
  getSearchUrl,
  isHyperUrl,
  isStaleBrowserLoad,
  isWebUrl,
  MAX_BROWSER_HISTORY_ENTRIES,
  MAX_BROWSER_URL_LENGTH,
  normalizeBrowserAddress,
  recordBrowserWebNavigationState,
  normalizeCustomSearchUrl,
  replaceBrowserEntryState,
  syncBrowserEntryState
} from '../../app/browser-shell.mjs'
import {
  INTERNAL_APPS,
  getRuntimeAppFromUrl,
  getRuntimeAppTitle,
  getRuntimeAppUrl
} from '../../app/internal-apps-registry.mjs'

describe('browser shell navigation helpers', () => {
  test('normalizes address bar input before routing', () => {
    assert.equal(normalizeBrowserAddress(''), BROWSER_HOME_URL)
    assert.equal(normalizeBrowserAddress('  peersky://home  '), BROWSER_HOME_URL)
    assert.equal(normalizeBrowserAddress('hyper://akhilesh.art/'), 'hyper://akhilesh.art/')
    assert.equal(normalizeBrowserAddress('mailto:test@example.com'), 'mailto:test@example.com')
    assert.equal(normalizeBrowserAddress('https://example.com/path'), 'https://example.com/path')
    assert.equal(normalizeBrowserAddress('localhost:3000'), 'http://localhost:3000')
    assert.equal(normalizeBrowserAddress('127.0.0.1:9090/doc'), 'http://127.0.0.1:9090/doc')
    assert.equal(normalizeBrowserAddress('10.0.2.2:8080'), 'http://10.0.2.2:8080')
    assert.equal(normalizeBrowserAddress('akhilesh.art'), 'https://akhilesh.art')
    assert.equal(normalizeBrowserAddress('search words'), 'https://duckduckgo.com/?q=search%20words')
    assert.equal(normalizeBrowserAddress('peersky'), 'https://duckduckgo.com/?q=peersky')
    assert.equal(
      normalizeBrowserAddress('search words', 'custom', 'https://example.com/find?q=%s'),
      'https://example.com/find?q=search%20words'
    )
    assert.equal(getSearchUrl('unknown', 'fallback search'), 'https://duckduckgo.com/?q=fallback%20search')
  })

  test('validates custom search URLs and safely substitutes encoded queries', () => {
    assert.equal(
      normalizeCustomSearchUrl(' https://example.com/find?q=%s '),
      'https://example.com/find?q=%s'
    )
    assert.equal(
      getSearchUrl('custom', 'privacy & p2p', 'https://example.com/?q=%s'),
      'https://example.com/?q=privacy%20%26%20p2p'
    )
    assert.equal(
      getSearchUrl('custom', 'fallback', 'http://example.com/?q=%s'),
      'https://duckduckgo.com/?q=fallback'
    )
    assert.equal(normalizeCustomSearchUrl('https://example.com/search'), null)
    assert.equal(normalizeCustomSearchUrl('https://user:pass@example.com/?q=%s'), null)
  })

  test('detects supported web and hyper schemes only', () => {
    assert.equal(isWebUrl('https://example.com'), true)
    assert.equal(isWebUrl('http://example.com'), true)
    assert.equal(isWebUrl('hyper://example.com'), false)
    assert.equal(isHyperUrl('hyper://example.com'), true)
    assert.equal(isHyperUrl('https://example.com'), false)
  })

  test('isolates native WebView history across rendering modes', () => {
    assert.equal(getBrowserWebViewKey('tab-1', 'web'), 'tab-1:web')
    assert.equal(getBrowserWebViewKey('tab-1', 'hyper'), 'tab-1:hyper')
    assert.notEqual(
      getBrowserWebViewKey('tab-1', 'web'),
      getBrowserWebViewKey('tab-1', 'hyper')
    )
  })

  test('commits replaces and syncs active browser history entries', () => {
    const initial = {
      history: [{ url: BROWSER_HOME_URL, source: { kind: 'home' } }],
      historyIndex: 0
    }

    const first = commitBrowserEntryState(initial, 'hyper://site/', {
      kind: 'hyper',
      html: '<h1>site</h1>',
      baseUrl: 'hyper://site/'
    })

    assert.equal(first.history.length, 2)
    assert.equal(first.historyIndex, 1)
    assert.equal(first.currentUrl, 'hyper://site/')
    assert.equal(first.address, 'hyper://site/')
    assert.equal(first.canGoBack, true)
    assert.equal(first.canGoForward, false)
    assert.equal(first.webCanGoBack, false)
    assert.equal(first.webCanGoForward, false)

    const replaced = replaceBrowserEntryState(first, 'hyper://site/index.html', {
      kind: 'hyper',
      html: '<h1>index</h1>',
      baseUrl: 'hyper://site/index.html'
    })

    assert.equal(replaced.history.length, 2)
    assert.equal(replaced.history[1].url, 'hyper://site/index.html')
    assert.equal(replaced.currentUrl, 'hyper://site/index.html')

    const synced = syncBrowserEntryState(replaced, 'https://example.com/final', {
      kind: 'web',
      uri: 'https://example.com/final'
    })

    assert.equal(synced.history.length, 2)
    assert.deepEqual(synced.history[1], {
      url: 'https://example.com/final',
      source: { kind: 'web', uri: 'https://example.com/final' }
    })
  })

  test('navigates back and forward across browser history state', () => {
    const initial = {
      history: [{ url: BROWSER_HOME_URL, source: { kind: 'home' } }],
      historyIndex: 0
    }
    const withHyper = commitBrowserEntryState(initial, 'hyper://site/', { kind: 'hyper', html: '', baseUrl: 'hyper://site/' })
    const withWeb = commitBrowserEntryState(withHyper, 'https://example.com', { kind: 'web', uri: 'https://example.com' })

    const back = getBrowserBackState(withWeb)
    assert.equal(back.currentUrl, 'hyper://site/')
    assert.equal(back.canGoBack, true)
    assert.equal(back.canGoForward, true)

    const backHome = getBrowserBackState(back)
    assert.equal(backHome.currentUrl, BROWSER_HOME_URL)
    assert.equal(backHome.address, '')
    assert.equal(backHome.canGoBack, false)
    assert.equal(backHome.canGoForward, true)

    const forward = getBrowserForwardState(backHome)
    assert.equal(forward.currentUrl, 'hyper://site/')
    assert.equal(forward.canGoBack, true)
    assert.equal(forward.canGoForward, true)

    assert.equal(getBrowserBackState(initial), null)
    assert.equal(getBrowserForwardState(withWeb), null)
  })

  test('mirrors native web navigation into restorable browser history', () => {
    const initial = {
      history: [{ url: 'https://peersky.p2plabs.xyz/', source: { kind: 'web', uri: 'https://peersky.p2plabs.xyz/' } }],
      historyIndex: 0
    }
    const pageOne = recordBrowserWebNavigationState(initial, 'https://peersky.p2plabs.xyz/#features', {
      kind: 'web',
      uri: 'https://peersky.p2plabs.xyz/#features'
    })
    const pageTwo = recordBrowserWebNavigationState(pageOne, 'https://peersky.p2plabs.xyz/#downloads', {
      kind: 'web',
      uri: 'https://peersky.p2plabs.xyz/#downloads'
    })
    const back = recordBrowserWebNavigationState(pageTwo, 'https://peersky.p2plabs.xyz/#features', {
      kind: 'web',
      uri: 'https://peersky.p2plabs.xyz/#features'
    }, 'back')

    assert.equal(pageTwo.history.length, 3)
    assert.equal(pageTwo.historyIndex, 2)
    assert.equal(back.history.length, 3)
    assert.equal(back.historyIndex, 1)
    assert.equal(back.canGoForward, true)
  })

  test('replaces a first-load redirect so Back returns to Home', () => {
    const initial = commitBrowserEntryState({
      history: [{ url: BROWSER_HOME_URL, source: { kind: 'home' } }],
      historyIndex: 0
    }, 'http://peersky.p2plabs.xyz/', {
      kind: 'web',
      uri: 'http://peersky.p2plabs.xyz/'
    })

    const redirected = recordBrowserWebNavigationState(
      initial,
      'https://peersky.p2plabs.xyz/',
      { kind: 'web', uri: 'https://peersky.p2plabs.xyz/' },
      null,
      false
    )

    assert.equal(redirected.history.length, 2)
    assert.equal(getBrowserBackState(redirected).currentUrl, BROWSER_HOME_URL)
  })

  test('classifies WebView navigation requests from hyper-rendered pages', () => {
    assert.deepEqual(getBrowserRequestAction({ requestUrl: 'about:blank', currentSourceKind: 'hyper' }), { action: 'allow' })
    assert.deepEqual(getBrowserRequestAction({ requestUrl: 'data:text/html,ok', currentSourceKind: 'hyper' }), { action: 'block' })
    assert.deepEqual(getBrowserRequestAction({ requestUrl: 'hyper://next/', currentSourceKind: 'hyper' }), {
      action: 'load-hyper',
      url: 'hyper://next/'
    })
    assert.deepEqual(getBrowserRequestAction({ requestUrl: 'mailto:test@example.com', currentSourceKind: 'hyper' }), {
      action: 'open-external',
      scheme: 'mailto',
      url: 'mailto:test@example.com'
    })
    assert.deepEqual(getBrowserRequestAction({
      requestUrl: 'mailto:test@example.com',
      currentSourceKind: 'web',
      isTopFrame: false
    }), { action: 'block' })
    assert.deepEqual(getBrowserRequestAction({
      requestUrl: 'https://frame.example.com',
      currentSourceKind: 'web',
      isTopFrame: false
    }), { action: 'allow' })
    assert.deepEqual(getBrowserRequestAction({ requestUrl: 'intent://scan/#Intent;end', currentSourceKind: 'web' }), { action: 'block' })
    assert.deepEqual(getBrowserRequestAction({ requestUrl: 'https://example.com', currentSourceKind: 'hyper' }), {
      action: 'commit-web',
      url: 'https://example.com',
      source: { kind: 'web', uri: 'https://example.com' }
    })
    assert.deepEqual(getBrowserRequestAction({ requestUrl: 'https://example.com', currentSourceKind: 'web' }), { action: 'allow' })
  })

  test('guards stale async hyper loads by sequence number', () => {
    assert.equal(isStaleBrowserLoad(1, 2), true)
    assert.equal(isStaleBrowserLoad(2, 2), false)
  })

  test('bounds history and releases rendered Hyper pages once they are no longer current', () => {
    let state = {
      history: [{ url: BROWSER_HOME_URL, source: { kind: 'home' } }],
      historyIndex: 0
    }

    for (let index = 0; index < MAX_BROWSER_HISTORY_ENTRIES + 5; index++) {
      state = commitBrowserEntryState(state, `hyper://site/${index}`, {
        kind: 'hyper',
        html: `<h1>${index}</h1>`,
        baseUrl: `hyper://site/${index}`
      })
    }

    assert.equal(state.history.length, MAX_BROWSER_HISTORY_ENTRIES)
    assert.equal(state.history.at(-1).source.kind, 'hyper')
    assert.equal(state.history.slice(0, -1).every((entry) => entry.source.kind === 'restore'), true)
  })

  test('blocks oversized WebView navigation URLs', () => {
    assert.deepEqual(getBrowserRequestAction({
      requestUrl: `https://example.com/${'a'.repeat(MAX_BROWSER_URL_LENGTH)}`,
      currentSourceKind: 'web'
    }), { action: 'block' })
  })
})

describe('internal app route registry', () => {
  test('keeps local apps on stable peersky routes', () => {
    assert.deepEqual(INTERNAL_APPS.map((app) => app.url), [
      'peersky://p2p/p2pmd/',
      'peersky://p2p/peerchat/',
      'peersky://holesail/',
      'peersky://hyperdrive/'
    ])

    assert.equal(getRuntimeAppUrl('p2pmd'), 'peersky://p2p/p2pmd/')
    assert.equal(getRuntimeAppUrl('peerchat'), 'peersky://p2p/peerchat/')
    assert.equal(getRuntimeAppUrl('holesail'), 'peersky://holesail/')
    assert.equal(getRuntimeAppUrl('hyper'), 'peersky://hyperdrive/')
    assert.equal(getRuntimeAppUrl('unknown'), 'peersky://p2p/p2pmd/')
  })

  test('matches internal routes case-insensitively and without trailing slash sensitivity', () => {
    assert.equal(getRuntimeAppFromUrl('peersky://p2p/p2pmd'), 'p2pmd')
    assert.equal(getRuntimeAppFromUrl('peersky://p2p/p2pmd/'), 'p2pmd')
    assert.equal(getRuntimeAppFromUrl('PEERSKY://P2P/PEERCHAT////'), 'peerchat')
    assert.equal(getRuntimeAppFromUrl('PEERSKY://HOLESAIL////'), 'holesail')
    assert.equal(getRuntimeAppFromUrl('peersky://hyperdrive'), 'hyper')
    assert.equal(getRuntimeAppFromUrl('peersky://hyper'), 'hyper')
    assert.equal(getRuntimeAppFromUrl('peersky://unknown'), null)
  })

  test('returns display titles for local runtime apps', () => {
    assert.equal(getRuntimeAppTitle('p2pmd'), 'P2PMD')
    assert.equal(getRuntimeAppTitle('peerchat'), 'PeerChat')
    assert.equal(getRuntimeAppTitle('holesail'), 'Holesail')
    assert.equal(getRuntimeAppTitle('hyper'), 'Hyperdrive')
  })
})
