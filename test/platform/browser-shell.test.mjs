import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  BROWSER_HOME_URL,
  commitBrowserEntryState,
  getBrowserBackState,
  getBrowserForwardState,
  formatHyperSiteForPrompt,
  getBrowserMessagePageUrl,
  getHyperBridgeSite,
  getBrowserRequestAction,
  getHyperSiteId,
  getBrowserWebViewKey,
  getHyperDriveListingUrl,
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
  canUseP2pAppPageActions,
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

  test('repeated native back transitions terminate at the first web page', () => {
    let state = {
      history: [{ url: 'https://example.com/1', source: { kind: 'web', uri: 'https://example.com/1' } }],
      historyIndex: 0
    }
    for (let page = 2; page <= 7; page += 1) {
      state = recordBrowserWebNavigationState(state, `https://example.com/${page}`, {
        kind: 'web',
        uri: `https://example.com/${page}`
      })
    }

    for (let page = 6; page >= 1; page -= 1) {
      state = recordBrowserWebNavigationState(state, `https://example.com/${page}`, {
        kind: 'web',
        uri: `https://example.com/${page}`
      }, 'back')
    }

    assert.equal(state.history.length, 7)
    assert.equal(state.historyIndex, 0)
    assert.equal(state.currentUrl, 'https://example.com/1')
    assert.equal(state.canGoBack, false)
    assert.equal(state.canGoForward, true)
  })

  test('deep native back navigation still terminates at Home after history is bounded', () => {
    let state = {
      history: [{ url: BROWSER_HOME_URL, source: { kind: 'home' } }],
      historyIndex: 0
    }

    for (let index = 0; index < MAX_BROWSER_HISTORY_ENTRIES + 10; index++) {
      const url = `https://example.com/page-${index}`
      state = recordBrowserWebNavigationState(state, url, { kind: 'web', uri: url })
    }

    for (let index = MAX_BROWSER_HISTORY_ENTRIES + 8; index >= 0; index--) {
      const url = `https://example.com/page-${index}`
      state = recordBrowserWebNavigationState(
        state,
        url,
        { kind: 'web', uri: url },
        'back',
        index > 0
      )
    }

    assert.equal(state.historyIndex, 1)
    assert.equal(state.currentUrl, 'https://example.com/page-0')
    assert.equal(getBrowserBackState(state).currentUrl, BROWSER_HOME_URL)
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

  test('a hyper:// frame never takes the whole tab with it', () => {
    // An ad or embed pointing at hyper:// used to become a full navigation, so
    // any page could send the tab to a hyper site of its choosing.
    for (const currentSourceKind of ['web', 'hyper']) {
      assert.deepEqual(getBrowserRequestAction({
        requestUrl: 'hyper://somewhere/',
        currentSourceKind,
        isTopFrame: false
      }), { action: 'block' })
    }
  })

  // iOS reports a hyper:// page's own load, from the string the app fetched
  // under its address, as a navigation. Taken over, it loaded the page again,
  // and again.
  test('lets a hyper:// page load under its own address, and keeps links and reloads for the app', () => {
    const page = `hyper://${'ab'.repeat(32)}/docs/index.html`
    const own = (requestUrl, navigationType, more = {}) => getBrowserRequestAction({
      requestUrl,
      currentSourceKind: 'hyper',
      currentUrl: page,
      navigationType,
      ...more
    })
    assert.deepEqual(own(page, 'other'), { action: 'allow' })
    assert.deepEqual(own(`${page}#install`, 'other'), { action: 'allow' })
    // A link to it, a reload, a form or history still goes through the app.
    for (const navigationType of ['click', 'reload', 'formsubmit', 'backforward', undefined]) {
      assert.deepEqual(own(page, navigationType), { action: 'load-hyper', url: page })
    }
    // Another page, a web page's tab, or a frame never gets through.
    const other = `hyper://${'cd'.repeat(32)}/`
    assert.deepEqual(own(other, 'other'), { action: 'load-hyper', url: other })
    assert.deepEqual(own(page, 'other', { currentSourceKind: 'web' }), { action: 'load-hyper', url: page })
    assert.deepEqual(own(page, 'other', { currentUrl: '' }), { action: 'load-hyper', url: page })
    assert.deepEqual(own(page, 'other', { isTopFrame: false }), { action: 'block' })
  })

  test('knows a hyper site by its host, for the publishing permission', () => {
    const hex = 'ab'.repeat(32)
    const z32 = 'y'.repeat(52)
    assert.equal(getHyperSiteId(`hyper://${hex}/app/index.html`), hex)
    assert.equal(getHyperSiteId(`hyper://${z32.toUpperCase()}/`), z32)
    assert.equal(getHyperSiteId('hyper://localhost/?key=x'), null)
    assert.equal(getHyperSiteId('https://example.com/'), null)
    assert.equal(getHyperSiteId('about:blank'), null)
    assert.equal(formatHyperSiteForPrompt(hex), `${hex.slice(0, 8)}…${hex.slice(-4)}`)
  })

  // iOS hyper pages had no address at all before PeerSkyWebView handled
  // hyper://, and a build from before still says about:blank. Android names
  // only the origin a message came from. Only an address elsewhere means the
  // tab has left its site.
  test('lets a hyper tab use the bridge until it navigates somewhere else', () => {
    const site = 'ab'.repeat(32)
    const url = `hyper://${site}/index.html`
    assert.equal(getHyperBridgeSite({ url, reportedUrl: 'about:blank', isHyper: true }), site)
    assert.equal(getHyperBridgeSite({ url, reportedUrl: '', isHyper: true }), site)
    assert.equal(getHyperBridgeSite({ url, reportedUrl: `hyper://${site}/other#top`, isHyper: true }), site)
    assert.equal(getHyperBridgeSite({ url, reportedUrl: 'about:blank#/route', isHyper: true }), site)
    assert.equal(getHyperBridgeSite({ url, reportedUrl: 'https://evil.example/', isHyper: true }), null)
    assert.equal(getHyperBridgeSite({ url, reportedUrl: `hyper://${'cd'.repeat(32)}/`, isHyper: true }), null)
    assert.equal(getHyperBridgeSite({ url, reportedUrl: 'about:blank', isHyper: false }), null)
    assert.equal(getHyperBridgeSite({ url: 'https://example.com/', reportedUrl: '', isHyper: true }), null)
  })

  // What Android hands over, as seen on a phone: "hyper://" for every hyper://
  // page, and the bare origin for a web page. Turning "hyper://" away refused
  // every hyper:// request a page made there.
  test('takes the origin Android reports for the page in the tab', () => {
    const site = 'ab'.repeat(32)
    const url = `hyper://${site}/notes/index.html`
    assert.equal(getHyperBridgeSite({ url, reportedUrl: 'hyper://', isHyper: true }), site)
    assert.equal(getHyperBridgeSite({ url, reportedUrl: 'https://evil.example', isHyper: true }), null)
    assert.equal(getHyperBridgeSite({ url, reportedUrl: 'null', isHyper: true }), null)
    assert.equal(getHyperBridgeSite({ url, reportedUrl: 'hyper://', isHyper: false }), null)

    const page = 'https://example.com/blog/post.html?x=1'
    assert.equal(getBrowserMessagePageUrl('https://example.com', page), page)
    assert.equal(getBrowserMessagePageUrl('hyper://', url), url)
    assert.equal(getBrowserMessagePageUrl('about:blank', page), page)
    assert.equal(getBrowserMessagePageUrl('', page), page)
    // iOS gives the address itself, which can be newer than the entry.
    assert.equal(getBrowserMessagePageUrl('https://example.com/blog/next.html', page), 'https://example.com/blog/next.html')
    // A message from somewhere else keeps its own origin.
    assert.equal(getBrowserMessagePageUrl('https://ads.example', page), 'https://ads.example')
    assert.equal(getBrowserMessagePageUrl('https://example.com:8443', page), 'https://example.com:8443')
    assert.equal(getBrowserMessagePageUrl('hyper://', page), 'hyper://')
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
    assert.equal(state.history[0].url, BROWSER_HOME_URL)
    assert.equal(state.history[0].source.kind, 'home')
    assert.equal(state.history.at(-1).source.kind, 'hyper')
    assert.equal(state.history.slice(1, -1).every((entry) => entry.source.kind === 'restore'), true)
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
      'peersky://p2p/hyperdrive/',
      'peersky://p2p/p2pmd/',
      'peersky://p2p/peerchat/',
      'peersky://p2p/peertunes/',
      'peersky://holesail/'
    ])

    assert.equal(getRuntimeAppUrl('p2pmd'), 'peersky://p2p/p2pmd/')
    assert.equal(getRuntimeAppUrl('peerchat'), 'peersky://p2p/peerchat/')
    assert.equal(getRuntimeAppUrl('holesail'), 'peersky://holesail/')
    assert.equal(getRuntimeAppUrl('hyper'), 'peersky://p2p/hyperdrive/')
    assert.equal(getRuntimeAppUrl('peertunes'), 'peersky://p2p/peertunes/')
    assert.equal(getRuntimeAppUrl('unknown'), 'peersky://p2p/p2pmd/')
  })

  test('matches internal routes case-insensitively and without trailing slash sensitivity', () => {
    assert.equal(getRuntimeAppFromUrl('peersky://p2p/p2pmd'), 'p2pmd')
    assert.equal(getRuntimeAppFromUrl('peersky://p2p/p2pmd/'), 'p2pmd')
    assert.equal(getRuntimeAppFromUrl('PEERSKY://P2P/PEERCHAT////'), 'peerchat')
    // Holesail is a development tool: a release build does not answer it.
    assert.equal(getRuntimeAppFromUrl('PEERSKY://HOLESAIL////'), null)
    assert.equal(getRuntimeAppFromUrl('PEERSKY://HOLESAIL////', { devApps: true }), 'holesail')
    assert.equal(getRuntimeAppFromUrl('peersky://p2p/hyperdrive'), 'hyper')
    assert.equal(getRuntimeAppFromUrl('peersky://hyperdrive'), 'hyper')
    assert.equal(getRuntimeAppFromUrl('peersky://hyper'), 'hyper')
    assert.equal(getRuntimeAppFromUrl('peersky://unknown'), null)
  })

  test('returns display titles for local runtime apps', () => {
    assert.equal(getRuntimeAppTitle('p2pmd'), 'P2PMD')
    assert.equal(getRuntimeAppTitle('peerchat'), 'PeerChat')
    assert.equal(getRuntimeAppTitle('holesail'), 'Holesail')
    assert.equal(getRuntimeAppTitle('hyper'), 'Hyperdrive')
    assert.equal(getRuntimeAppTitle('peertunes'), 'PeerTunes')
  })

  test('enables page actions only for registered p2p app routes', () => {
    assert.equal(canUseP2pAppPageActions('hyper', 'peersky://p2p/hyperdrive'), true)
    assert.equal(canUseP2pAppPageActions('p2pmd', 'peersky://p2p/p2pmd/'), true)
    assert.equal(canUseP2pAppPageActions('peerchat', 'peersky://p2p/peerchat/'), true)
    assert.equal(canUseP2pAppPageActions('holesail', 'peersky://holesail/'), false)
    assert.equal(canUseP2pAppPageActions('p2pmd', 'peersky://p2p/peerchat/'), false)
    assert.equal(canUseP2pAppPageActions('p2pmd', 'peersky://settings/'), false)
  })
})

test('keeps subframe web requests inside a Hyper page instead of navigating', () => {
  // An embed on a hyper site used to replace the page the user was reading.
  assert.deepEqual(getBrowserRequestAction({
    requestUrl: 'https://pixelfed.social/akhileshthite/embed',
    currentSourceKind: 'hyper',
    isTopFrame: false
  }), { action: 'allow' })

  // A real click still takes the tab to the web.
  assert.deepEqual(getBrowserRequestAction({
    requestUrl: 'https://example.com/',
    currentSourceKind: 'hyper',
    isTopFrame: true
  }), {
    action: 'commit-web',
    url: 'https://example.com/',
    source: { kind: 'web', uri: 'https://example.com/' }
  })
})

// P2PMD publishes a note as index.html, and hypercore-fetch serves that for a
// directory that has one, so opening its app data opened the note instead of
// the files behind it.
test('a drive address can ask for its listing instead of its page', () => {
  assert.equal(
    getHyperDriveListingUrl(`hyper://${'a'.repeat(52)}/`),
    `hyper://${'a'.repeat(52)}/?noResolve`
  )
  assert.equal(
    getHyperDriveListingUrl(`hyper://${'a'.repeat(52)}/?version=3`),
    `hyper://${'a'.repeat(52)}/?version=3&noResolve`
  )
  assert.equal(
    getHyperDriveListingUrl(`hyper://${'a'.repeat(52)}/#top`),
    `hyper://${'a'.repeat(52)}/?noResolve#top`
  )
})

test('asking twice does not stack up', () => {
  const once = getHyperDriveListingUrl(`hyper://${'a'.repeat(52)}/`)
  assert.equal(getHyperDriveListingUrl(once), once)
})

test('only hyper addresses are rewritten', () => {
  assert.equal(getHyperDriveListingUrl('https://example.com/'), 'https://example.com/')
  assert.equal(getHyperDriveListingUrl(''), '')
  assert.equal(getHyperDriveListingUrl(null), '')
})

// A note key tapped in PeerChat opens a new tab, and a new tab goes through the
// restored path rather than loadBrowserUrl, so the link that already worked
// from the address bar came back as "Unsupported restored URL scheme".
test('a note key opens P2PMD however the tab was opened', async () => {
  const { readFile } = await import('node:fs/promises')
  const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

  const restored = index.slice(
    index.indexOf('async function loadRestoredBrowserUrl'),
    index.indexOf('async function loadHyperBrowserUrl')
  )
  assert.match(restored, /parseP2pmdNoteLink\(url\)/)
  assert.match(restored, /setP2pmdJoinKey\(noteKey\)/)
  // Ahead of the error it used to fall through to.
  assert.ok(restored.indexOf('parseP2pmdNoteLink') < restored.indexOf('Unsupported restored URL scheme'))

  // And the address bar path still does it too.
  const typed = index.slice(index.indexOf('const noteKey = parseP2pmdNoteLink(nextUrl)'))
  assert.match(typed.slice(0, 400), /openInternalApp\('p2pmd'\)/)
})

// The button offers what pressing it does, not what you are looking at. Naming
// it after the current view is the easy mistake, and it reads backwards.
test('the P2PMD button names the view it takes you to', async () => {
  const { readFile } = await import('node:fs/promises')
  const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  const server = await readFile(new URL('../../backend/p2pmd/server.mjs', import.meta.url), 'utf8')

  const button = index.slice(
    index.indexOf('onPress={onP2pmdTogglePreview}'),
    index.indexOf('<BrowserOverflowMenu')
  )
  // Editing offers Preview; anything else offers Edit.
  assert.match(button, /p2pmdViewMode === 'edit' \? 'Preview' : 'Edit'/)
  // And the icon agrees with the words: a pencil to go and edit, an eye to go
  // and look.
  assert.ok(button.indexOf('p2pmdViewMode !== \'edit\'') < button.indexOf('p2pmdPencilIcon'))
  assert.ok(button.indexOf('p2pmdPencilIcon') < button.indexOf('p2pmdEyeIcon'))

  // The label follows the page rather than guessing: every change of view is
  // announced, and both sides start in the same one.
  assert.match(server, /notifyNative\('p2pmd-view-mode', \{ mode: viewMode \}\)/)
  assert.match(server, /let viewMode = 'edit'/)
  assert.match(index, /useState<P2pmdViewMode>\('edit'\)/)
})

// peersky://p2p is an address the app hands out, and it used to resolve to
// nothing and come back as an unsupported scheme.
test('the p2p address lists the built-in apps', async () => {
  const { BROWSER_P2P_URL, isBrowserP2pUrl } = await import('../../app/browser-shell.mjs')
  const { P2P_APPS } = await import('../../app/internal-apps-registry.mjs')

  assert.equal(BROWSER_P2P_URL, 'peersky://p2p')
  assert.equal(isBrowserP2pUrl('peersky://p2p'), true)
  assert.equal(isBrowserP2pUrl('peersky://p2p/'), true)
  assert.equal(isBrowserP2pUrl('PEERSKY://P2P/'), true)
  // Not the apps themselves, which have screens of their own.
  assert.equal(isBrowserP2pUrl('peersky://p2p/peerchat/'), false)
  assert.equal(isBrowserP2pUrl('peersky://home'), false)
  assert.equal(isBrowserP2pUrl(''), false)

  const { readFile } = await import('node:fs/promises')
  const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  // Typed, or restored with the tab: both land on the same screen.
  assert.equal((index.match(/isBrowserP2pUrl\(/g) || []).length, 2)
  // Every app people use. Holesail is a development tool and is not listed.
  const p2pStart = index.indexOf("browserSource.kind === 'p2p'")
  const screen = index.slice(p2pStart, index.indexOf("browserSource.kind === 'home'", p2pStart))
  assert.ok(p2pStart > 0 && screen.length > 0)
  assert.match(screen, /P2P_APPS\.map/)
  assert.ok(!P2P_APPS.some((app) => app.id === 'holesail'))

  test('following a search result keeps the search behind it', () => {
    const web = (url) => ({ kind: 'web', uri: url })
    const search = 'https://duckduckgo.com/?q=jj'
    const result = 'https://example.com/article'

    let state = commitBrowserEntryState(
      { history: [{ url: BROWSER_HOME_URL, source: { kind: 'home' } }], historyIndex: 0 },
      search,
      web(search)
    )
    // The search settles with nothing behind it in the WebView's own list.
    state = recordBrowserWebNavigationState(state, search, web(search), null, false, false)
    // Tapping a result fires once while it is still loading, when the WebView
    // has not added it to that list yet, and again when it lands.
    state = recordBrowserWebNavigationState(state, result, web(result), null, false, true)
    state = recordBrowserWebNavigationState(state, result, web(result), null, true, false)

    assert.deepEqual(state.history.map((entry) => entry.url), [BROWSER_HOME_URL, search, result])
    assert.equal(getBrowserBackState(state).currentUrl, search)
  })
})

// iOS reports a link's page as it starts with loading false, since the page
// being left is done, and with no back entry when that page is the first in
// the tab. Taken as a page that had landed, it looked like the first page
// redirecting: the new page took its place, and back skipped it.
test('a link on the first page in a tab keeps that page behind it on iOS', async () => {
  const { readFile } = await import('node:fs/promises')
  const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  assert.match(app, /onLoadStart=\{\(event\) => \{\s+browserLoadStartsRef\.current\.add\(event\.nativeEvent\)/)
  const start = app.indexOf('onNavigationStateChange={(navigationState) => {')
  const change = app.slice(start, app.indexOf('onMessage={(event) => {', start))
  assert.match(change, /const loading = navigationState\.loading \|\| browserLoadStartsRef\.current\.has\(navigationState\)/)
  assert.doesNotMatch(change, /navigationState\.loading(?! \|\|)/)
  assert.match(change, /canGoForward: navigationState\.canGoForward,\s+loading\s+\}, tab\.id\)/)
})
