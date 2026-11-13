import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  BROWSER_HOME_URL,
  commitBrowserEntryState,
  getBrowserBackState,
  getBrowserForwardState,
  formatBridgeSite,
  getBrowserMessagePageUrl,
  getHyperBridgeSite,
  getBrowserRequestAction,
  getBrowserTraversal,
  getHyperSiteId,
  recordBrowserErrorState,
  getWebSiteId,
  isBridgeSiteId,
  getBrowserWebViewKey,
  getHyperDriveListingUrl,
  getSearchUrl,
  isHyperUrl,
  isStaleBrowserLoad,
  isUncommittedNavigationFinish,
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
  test('on Android a finish for an address nothing committed is not the page on screen', () => {
    const page = 'https://phish.example/sign-in'
    const committed = new Set([page])
    // A 204 or a cancelled download reports a finish with the address it was going to.
    assert.equal(isUncommittedNavigationFinish({ platform: 'android', isLoadStart: false, committedUrls: committed, url: 'https://www.google.com/generate_204' }), true)
    // The page that did commit, or one it moved to with replaceState while loading, is.
    assert.equal(isUncommittedNavigationFinish({ platform: 'android', isLoadStart: false, committedUrls: committed, url: page }), false)
    assert.equal(isUncommittedNavigationFinish({ platform: 'android', isLoadStart: false, committedUrls: new Set([page, `${page}?clean`]), url: page }), false)
    // A start is a commit on Android, nothing known yet decides nothing, and iOS is unchanged.
    assert.equal(isUncommittedNavigationFinish({ platform: 'android', isLoadStart: true, committedUrls: committed, url: 'https://other.example/' }), false)
    assert.equal(isUncommittedNavigationFinish({ platform: 'android', isLoadStart: false, committedUrls: undefined, url: 'https://other.example/' }), false)
    assert.equal(isUncommittedNavigationFinish({ platform: 'ios', isLoadStart: false, committedUrls: committed, url: 'https://other.example/' }), false)
  })

  test('the browser keeps an aborted Android navigation out of the address bar', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    assert.match(source, /committed\.add\(event\.nativeEvent\.url\)/)
    assert.match(source, /if \(isUncommittedNavigationFinish\(\{[\s\S]*?committedUrls: browserCommittedUrlsRef\.current\.get\(tab\.id\),[\s\S]*?\}\)\) return/)
    assert.match(source, /browserCommittedUrlsRef\.current\.set\(tab\.id, new Set\(\[navigationState\.url\]\)\)/)
  })

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

  test('a frame may show a document its page made, a tab may not', () => {
    // Agregore's scratchpad draws its live preview into a data: frame, which
    // stayed blank.
    for (const requestUrl of ['data:text/html;base64,PHA+b2s8L3A+', 'blob:https://agregore.mauve.moe/0b6f', 'about:srcdoc']) {
      for (const currentSourceKind of ['web', 'hyper']) {
        assert.deepEqual(getBrowserRequestAction({ requestUrl, currentSourceKind, isTopFrame: false }), { action: 'allow' })
      }
    }
    assert.deepEqual(getBrowserRequestAction({ requestUrl: 'data:text/html,ok', currentSourceKind: 'web', isTopFrame: true }), { action: 'block' })
    assert.deepEqual(getBrowserRequestAction({ requestUrl: 'about:srcdocx', currentSourceKind: 'web', isTopFrame: false }), { action: 'block' })
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
    assert.equal(formatBridgeSite(hex), `hyper://${hex.slice(0, 8)}…${hex.slice(-4)}`)
  })

  // The Agregore scratchpad, on the web and under its hyper:// name. Neither
  // could publish from the phone, though both can on desktop.
  test('knows a hyper site by its domain name and a web site by its origin', () => {
    assert.equal(getHyperSiteId('hyper://Agregore.Mauve.Moe/apps/scratchpad.html'), 'agregore.mauve.moe')
    assert.equal(getHyperSiteId('hyper://a%20b.com/'), null)
    assert.equal(getWebSiteId('https://agregore.mauve.moe/apps/scratchpad.html?x=1#y'), 'https://agregore.mauve.moe')
    assert.equal(getWebSiteId('https://Example.com:8443/'), 'https://example.com:8443')
    assert.equal(getWebSiteId('http://example.com/'), null)
    assert.equal(getWebSiteId('hyper://agregore.mauve.moe/'), null)
    assert.equal(formatBridgeSite('agregore.mauve.moe'), 'hyper://agregore.mauve.moe')
    assert.equal(formatBridgeSite('https://agregore.mauve.moe'), 'https://agregore.mauve.moe')

    for (const id of ['ab'.repeat(32), 'y'.repeat(52), 'agregore.mauve.moe', 'https://agregore.mauve.moe', 'https://example.com:8443']) {
      assert.equal(isBridgeSiteId(id), true, id)
    }
    for (const id of ['', 'localhost', 'http://example.com', 'https://example.com/', 'https://EXAMPLE.com', 'hyper://agregore.mauve.moe', 'not a site']) {
      assert.equal(isBridgeSiteId(id), false, id)
    }
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

    const named = 'hyper://agregore.mauve.moe/apps/scratchpad.html'
    assert.equal(getHyperBridgeSite({ url: named, reportedUrl: 'hyper://', isHyper: true }), 'agregore.mauve.moe')
    assert.equal(getHyperBridgeSite({ url: named, reportedUrl: 'hyper://agregore.mauve.moe/docs/', isHyper: true }), 'agregore.mauve.moe')
    assert.equal(getHyperBridgeSite({ url: named, reportedUrl: 'hyper://other.example/', isHyper: true }), null)
  })

  // iOS reports a web page's address and Android its origin. An https:// page
  // gets the bridge as a site of its own, and only while the tab is on it.
  test('lets an https:// page use the bridge as its origin', () => {
    const url = 'https://agregore.mauve.moe/apps/scratchpad.html'
    const site = 'https://agregore.mauve.moe'
    assert.equal(getHyperBridgeSite({ url, reportedUrl: site, isHyper: false, isWeb: true }), site)
    assert.equal(getHyperBridgeSite({ url, reportedUrl: `${url}#top`, isHyper: false, isWeb: true }), site)
    assert.equal(getHyperBridgeSite({ url, reportedUrl: 'https://agregore.mauve.moe/docs/', isHyper: false, isWeb: true }), site)
    // A frame or a page the tab moved on to, and messages naming nowhere.
    for (const reportedUrl of ['https://ads.example', 'https://agregore.mauve.moe:8443', 'http://agregore.mauve.moe', 'null', 'about:blank', '']) {
      assert.equal(getHyperBridgeSite({ url, reportedUrl, isHyper: false, isWeb: true }), null, reportedUrl)
    }
    // Plain http, and the app's own pages, never.
    assert.equal(getHyperBridgeSite({ url: 'http://example.com/', reportedUrl: 'http://example.com', isHyper: false, isWeb: true }), null)
    assert.equal(getHyperBridgeSite({ url, reportedUrl: site, isHyper: false, isWeb: false }), null)
    assert.equal(getHyperBridgeSite({ url, reportedUrl: site, isHyper: false }), null)
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
  assert.match(button, /p2pmdViewMode === 'edit' \? t\('Preview'\) : t\('Edit'\)/)
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
test('the p2p address lists the P2P sites this phone has opened', async () => {
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
  // Typed, restored with the tab, or opened by the lock screen button: all
  // land on the same screen.
  assert.equal((index.match(/isBrowserP2pUrl\(/g) || []).length, 3)
  // The hyper:// sites from history, searchable by title. The apps are on the
  // home screen, where Holesail, a development tool, is not listed.
  const p2pStart = index.indexOf("browserSource.kind === 'p2p'")
  const screen = index.slice(p2pStart, index.indexOf("browserSource.kind === 'home'", p2pStart))
  assert.ok(p2pStart > 0 && screen.length > 0)
  assert.match(screen, /<P2pSitesPage\s+history=\{browserVisitHistory\}/)
  assert.equal((index.match(/setBrowserTitle\(t\('P2P sites'\)\)/g) || []).length, 2)
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
  assert.match(change, /const loading = navigationState\.loading \|\|\s+\(Platform\.OS === 'ios' && browserLoadStartsRef\.current\.has\(navigationState\)\)/)
  assert.doesNotMatch(change, /navigationState\.loading(?! \|\|)/)
  assert.match(change, /canGoForward: navigationState\.canGoForward,\s+loading\s+\}, tab\.id, pageMove, traversal\)/)
})

// Android sends a page that moves on its own (history.pushState: a video
// picked on YouTube, most single page sites) as a load start with loading
// false, and no load end follows. Taken as a start, as iOS needs, it was never
// recorded: back went past every page of the site, straight to Home.
test('a page that moves on its own is a step back on Android', () => {
  const web = (url) => ({ kind: 'web', uri: url })
  const youtube = 'https://m.youtube.com/'
  const video = 'https://m.youtube.com/watch?v=abc'
  let state = commitBrowserEntryState(
    { history: [{ url: BROWSER_HOME_URL, source: { kind: 'home' } }], historyIndex: 0 },
    youtube,
    web(youtube)
  )
  // The pushState: loading false, the WebView has the page before it.
  state = recordBrowserWebNavigationState(state, video, web(video), null, true, false)
  assert.deepEqual(state.history.map((entry) => entry.url), [BROWSER_HOME_URL, youtube, video])
  assert.equal(getBrowserBackState(state).currentUrl, youtube)
})

// Back and Forward loaded the page again in a new WebView every time, so a
// page came back at the top, with what was typed in it gone, its own history
// gone and a form's result posted again. Safari and Chrome bring the page back
// as it was left. The tab's WebView does that when it has the page.
describe('Back and Forward in the tab\'s own WebView', () => {
  const VIEW = 41
  const page = (url, view = VIEW) => ({ url, source: { kind: 'web', uri: url, ...(view === null ? {} : { view }) } })
  const home = { url: BROWSER_HOME_URL, source: { kind: 'home' } }
  const hyper = { url: 'hyper://site/', source: { kind: 'restore', url: 'hyper://site/' } }
  const A = 'https://example.com/a'
  const B = 'https://example.com/b'
  const C = 'https://example.com/c'
  const said = (canGoBack = false, canGoForward = false, view = VIEW) => ({ view, canGoBack, canGoForward })

  test('steps in the WebView to a page it showed', () => {
    const state = { history: [home, page(A), page(B), page(C)], historyIndex: 2 }
    assert.deepEqual(getBrowserTraversal(state, 'back', said()), { mode: 'webview' })
    assert.deepEqual(getBrowserTraversal(state, 'forward', said()), { mode: 'webview' })
  })

  test('builds the page again when the WebView never had it', () => {
    // After a restart the steps are there and the WebView is new: none of
    // them came from it.
    const restored = { history: [page(A, null), page(B, null), page(C)], historyIndex: 2 }
    const back = getBrowserTraversal(restored, 'back', said())
    assert.equal(back.mode, 'rebuild')
    assert.equal(back.state.currentUrl, B)
    // A WebView built again since, for a step built again or a hyper:// page
    // in between, is another WebView with a list of its own.
    const rebuilt = { history: [page(A, 7), page(B, 7), page(C)], historyIndex: 1 }
    assert.equal(getBrowserTraversal({ ...rebuilt, historyIndex: 2 }, 'back', said()).mode, 'rebuild')
    // Home, a hyper:// site and a page of the app's own are never in it.
    assert.equal(getBrowserTraversal({ history: [home, page(A)], historyIndex: 1 }, 'back', said()).mode, 'rebuild')
    assert.equal(getBrowserTraversal({ history: [hyper, page(A)], historyIndex: 1 }, 'back', said()).mode, 'rebuild')
    assert.equal(getBrowserTraversal({ history: [page(A), hyper], historyIndex: 1 }, 'back', said(true)).mode, 'rebuild')
    // A WebView that has said nothing yet, or another tab's, has nothing.
    assert.equal(getBrowserTraversal({ history: [page(A), page(B)], historyIndex: 1 }, 'back', null).mode, 'rebuild')
    assert.equal(getBrowserTraversal({ history: [page(A), page(B)], historyIndex: 1 }, 'back', said(true, false, 9)).mode, 'rebuild')
    assert.equal(getBrowserTraversal({ history: [page(A, null), page(B, null)], historyIndex: 1 }, 'back', said(true, false, null)).mode, 'rebuild')
    // Nowhere to go at all.
    assert.equal(getBrowserTraversal({ history: [page(A)], historyIndex: 0 }, 'back', said()), null)
  })

  test('takes the WebView\'s yes for a step only it has', () => {
    // A menu a page opened under its own address: the tab kept one step, the
    // WebView two, and Back closes the menu.
    const state = { history: [home, page(A)], historyIndex: 1 }
    assert.deepEqual(getBrowserTraversal(state, 'back', said(true)), { mode: 'webview' })
    assert.deepEqual(getBrowserTraversal({ history: [hyper, page(A)], historyIndex: 1 }, 'back', said(true)), { mode: 'webview' })
    // Its no is not believed over the tab on iOS: WKWebView has said it
    // cannot go forward with a page ahead of it. Android's is.
    assert.deepEqual(getBrowserTraversal({ history: [page(A), page(B)], historyIndex: 0 }, 'forward', said(false, false)), { mode: 'webview' })
    const believed = getBrowserTraversal({ history: [page(A), page(B)], historyIndex: 0 }, 'forward', said(false, false), true)
    assert.equal(believed.mode, 'rebuild')
    assert.equal(believed.state.currentUrl, B)
  })

  test('lands on the page the WebView went to, past steps it did not keep', () => {
    // A page that sent the tab on before it loaded stayed a step in the tab,
    // and the WebView, like Safari, went past it.
    const state = { history: [page(A), page('https://example.com/refresh'), page(C)], historyIndex: 2 }
    const back = recordBrowserWebNavigationState(state, A, { kind: 'web', uri: A, view: VIEW }, 'back')
    assert.equal(back.historyIndex, 0)
    assert.equal(back.history.length, 3)
    assert.equal(back.history[2].url, C)
    const forward = recordBrowserWebNavigationState(back, C, { kind: 'web', uri: C, view: VIEW }, 'forward')
    assert.equal(forward.historyIndex, 2)
    assert.equal(forward.history.length, 3)
  })

  test('takes the address as the WebView has it', () => {
    // Typed without its slash: handed to the WebView as it was, it would go
    // there again as a new page.
    const state = { history: [page('https://example.com', null), page(B)], historyIndex: 1 }
    const back = recordBrowserWebNavigationState(state, 'https://example.com/', { kind: 'web', uri: 'https://example.com/', view: VIEW }, 'back')
    assert.equal(back.historyIndex, 0)
    assert.deepEqual(back.history[0], { url: 'https://example.com/', source: { kind: 'web', uri: 'https://example.com/', view: VIEW } })
    // The same page as it was stays the same step.
    const same = { history: [page(A), page(B)], historyIndex: 1 }
    assert.equal(recordBrowserWebNavigationState(same, A, page(A).source, 'back').history[0], same.history[0])
  })

  test('puts a page only the WebView kept next to the step it came from', () => {
    const back = recordBrowserWebNavigationState({ history: [page(A), page(C)], historyIndex: 1 }, B, page(B).source, 'back')
    assert.deepEqual(back.history.map((entry) => entry.url), [A, B, C])
    assert.equal(back.historyIndex, 1)
    const forward = recordBrowserWebNavigationState({ history: [page(A), page(C)], historyIndex: 0 }, B, page(B).source, 'forward')
    assert.deepEqual(forward.history.map((entry) => entry.url), [A, B, C])
    assert.equal(forward.historyIndex, 1)
    // The WebView's list starts after the tab's last page that was not on
    // the web, so an older step with the address is not the one, and nor is
    // one another WebView showed.
    const across = recordBrowserWebNavigationState({ history: [page(A), hyper, page(C)], historyIndex: 2 }, A, page(A).source, 'back')
    assert.deepEqual(across.history.map((entry) => entry.url), [A, 'hyper://site/', A, C])
    assert.equal(across.historyIndex, 2)
    const other = recordBrowserWebNavigationState({ history: [page(A, 9), page(C)], historyIndex: 1 }, A, page(A).source, 'back')
    assert.deepEqual(other.history.map((entry) => [entry.url, entry.source.view]), [[A, 9], [A, VIEW], [C, VIEW]])
    assert.equal(other.historyIndex, 1)
  })

  test('a step back to the same address closes what the page opened, and stays', () => {
    const state = { history: [home, page(A)], historyIndex: 1 }
    const back = recordBrowserWebNavigationState(state, A, page(A).source, 'back')
    assert.equal(back.historyIndex, 1)
    assert.equal(back.history.length, 2)
  })

  test('keeps to the bound, dropping the step furthest from the new one', () => {
    let history = [home]
    for (let index = 1; index < MAX_BROWSER_HISTORY_ENTRIES; index++) history.push(page(`https://example.com/${index}`))
    const back = recordBrowserWebNavigationState({ history, historyIndex: 1 }, 'https://example.com/0', page('https://example.com/0').source, 'back')
    assert.equal(back.history.length, MAX_BROWSER_HISTORY_ENTRIES)
    assert.equal(back.historyIndex, 1)
    assert.equal(back.currentUrl, 'https://example.com/0')
    assert.equal(back.history.at(-1).url, `https://example.com/${MAX_BROWSER_HISTORY_ENTRIES - 2}`)

    history = [home]
    for (let index = 1; index < MAX_BROWSER_HISTORY_ENTRIES; index++) history.push(page(`https://example.com/${index}`))
    const forward = recordBrowserWebNavigationState({ history, historyIndex: history.length - 1 }, 'https://example.com/next', page('https://example.com/next').source, 'forward')
    assert.equal(forward.history.length, MAX_BROWSER_HISTORY_ENTRIES)
    assert.equal(forward.currentUrl, 'https://example.com/next')
    assert.equal(forward.history[0].url, BROWSER_HOME_URL)
    assert.equal(forward.historyIndex, MAX_BROWSER_HISTORY_ENTRIES - 1)
  })

  test('the app steps in the WebView and keeps the tab in step with it', async () => {
    const { readFile } = await import('node:fs/promises')
    const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    const body = (name) => app.slice(app.indexOf(`function ${name} (`), app.indexOf('\n  }\n', app.indexOf(`function ${name} (`)))
    for (const [name, direction] of [['onBrowserBack', 'back'], ['onBrowserForward', 'forward']]) {
      const step = body(name)
      assert.match(step, new RegExp(`if \\(queueBrowserStep\\(tabId, '${direction}'\\)\\) return`))
      assert.match(step, new RegExp(`getBrowserTraversal\\([\\s\\S]*?'${direction}',\\s+getLiveBrowserWebHistory\\(tabId\\),[^\\n]*\\n[^\\n]*\\n\\s+Platform\\.OS === 'android'`))
      assert.match(step, new RegExp(`traversal\\?\\.mode === 'webview' && startBrowserWebViewTraversal\\(tabId, '${direction}'\\)`))
      assert.match(step, /rebuildBrowserStep\(tabId, /)
      assert.doesNotMatch(step, /remountBrowserWebView\(/)
    }
    // Only a step built again gets a new WebView.
    assert.match(body('rebuildBrowserStep'), /remountBrowserWebView\(tabId\)/)
    const start = body('startBrowserWebViewTraversal')
    assert.match(start, /if \(direction === 'back'\) webView\.goBack\(\)\s+else webView\.goForward\(\)/)
    assert.match(start, /setTimeout\(\(\) => \{[\s\S]*?traversal\.moved\) return[\s\S]*?rebuildBrowserStep\(/)
    // Where it went comes from the WebView, with the WebView it was seen in.
    const change = app.slice(app.indexOf('onNavigationStateChange={(navigationState) => {'), app.indexOf('onMessage={(event) => {', app.indexOf('onNavigationStateChange={(navigationState) => {')))
    assert.match(change, /const view = getNativeViewTag\(\{ nativeEvent: navigationState \}\)\s+browserWebHistoryRef\.current\.set\(tab\.id, \{\s+key: webViewKey,\s+view,/)
    assert.match(change, /const traversal = takeBrowserTraversal\(tab\.id, webViewGeneration, loading\)/)
    assert.match(change, /uri: navigationState\.url,\s+\.\.\.\(view !== null \? \{ view \} : \{\}\)/)
    assert.match(change, /syncBackgroundBrowserTab\(tab\.id, entry, navigationState, pageMove, traversal\)/)
    // The WebView is known by the key it is drawn with.
    assert.match(app, /const webViewKey = getBrowserWebViewInstanceKey\(tab, entry, webViewGeneration\)/)
    assert.match(app, /<WebView\s+key=\{webViewKey\}/)
    assert.match(body('getLiveBrowserWebHistory'), /record\.key === getBrowserWebViewInstanceKey\(tab, entry, generation\)/)
    // A step only the WebView has can be taken too.
    assert.match(app, /const canBrowserGoBack = browserCanGoBack \|\| activeBrowserWebHistory\?\.canGoBack === true/)
  })

  // WebKit ends a page Back brings back from its cache in another process
  // with a cancelled load, and react-native-webview said nothing of it: the
  // page was back and the app still named the one left.
  test('on iOS a page that fails once it is on screen is heard as finished', async () => {
    const { readFile } = await import('node:fs/promises')
    const template = await readFile(new URL('../../plugins/templates/PeerSkyWebViewManager.m.template', import.meta.url), 'utf8')
    assert.match(template, /- \(void\)webView:\(WKWebView \*\)webView didFailNavigation:\(WKNavigation \*\)navigation withError:\(NSError \*\)error\n\{\n {2}if \(self\.onLoadingFinish\) self\.onLoadingFinish\(\[self baseEvent\]\);\n\}/)
  })

  test('a page\'s WebView is never saved with its tab', async () => {
    const { restoreBrowserTabsState, serializeBrowserTabsState } = await import('../../app/browser-tabs.mjs')
    const state = {
      tabs: [{ id: 'tab-1', title: 'A', desktopView: false, history: [page(A), page(B)], historyIndex: 1, pageZoom: 100, webCanGoBack: true, webCanGoForward: false }],
      activeTabId: 'tab-1',
      nextTabIndex: 2,
      viewMode: 'grid'
    }
    const restored = restoreBrowserTabsState(serializeBrowserTabsState(state))
    assert.deepEqual(restored.tabs[0].history.map((entry) => entry.source), [{ kind: 'web', uri: A }, { kind: 'web', uri: B }])
  })
})

// Typed google.com lands on www.google.com, and http:// on https://: two steps
// in the tab where the WebView had one, so Back had to be pressed twice, and
// after a restart it went to google.com, which sent the tab on again.
describe('a load the app started', () => {
  const web = (url) => ({ kind: 'web', uri: url })
  const typed = 'https://google.com'
  const landed = 'https://www.google.com/?zx=1'

  test('is one step, under the address it lands on', () => {
    let state = commitBrowserEntryState(
      { history: [{ url: 'https://example.com/', source: web('https://example.com/') }], historyIndex: 0 },
      typed,
      web(typed)
    )
    // The WebView has the page before it, so this is no first page.
    state = recordBrowserWebNavigationState(state, landed, web(landed), null, true, false, { move: 'replace', from: typed })
    assert.deepEqual(state.history.map((entry) => entry.url), ['https://example.com/', landed])
    assert.equal(getBrowserBackState(state).currentUrl, 'https://example.com/')
  })

  test('only takes the step it made', () => {
    // A link tapped on the page still on screen landed first: the typed
    // step is gone, and the link is a step of its own.
    const state = { history: [{ url: 'https://example.com/', source: web('https://example.com/') }], historyIndex: 0 }
    const linked = recordBrowserWebNavigationState(state, landed, web(landed), null, true, false, { move: 'replace', from: typed })
    assert.deepEqual(linked.history.map((entry) => entry.url), ['https://example.com/', landed])
  })

  test('the app marks the load it started and takes it as the first page lands', async () => {
    const { readFile } = await import('node:fs/promises')
    const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    const typedLoad = app.slice(app.indexOf('    if (isWebUrl(nextUrl)) {'), app.indexOf('    cancelPendingBrowserLoad()\n    showBrowserError(nextUrl'))
    assert.match(typedLoad, /browserStartedLoadsRef\.current\.set\(/)
    const take = app.slice(app.indexOf('function takeBrowserStartedLoad ('), app.indexOf('\n  }\n', app.indexOf('function takeBrowserStartedLoad (')))
    assert.match(take, /browserStartedLoadsRef\.current\.delete\(tabId\)/)
    assert.match(take, /return url \? \{ move: 'replace' as const, from: url \} : null/)
    const change = app.slice(app.indexOf('onNavigationStateChange={(navigationState) => {'), app.indexOf('onMessage={(event) => {', app.indexOf('onNavigationStateChange={(navigationState) => {')))
    assert.match(change, /const landedLoad = loading \? null : takeBrowserStartedLoad\(tab\.id\)/)
    // Back, Forward and a WebView built again leave nothing of it behind.
    assert.match(app.slice(app.indexOf('function startBrowserWebViewTraversal ('), app.indexOf('function clearBrowserTraversal (')), /browserStartedLoadsRef\.current\.delete\(tabId\)/)
    assert.match(app.slice(app.indexOf('function remountBrowserWebView ('), app.indexOf('function getBrowserWebViewInstanceKey (')), /browserStartedLoadsRef\.current\.delete\(tabId\)/)
  })
})

// A link to a site that is not there took the place of the page it was on,
// and the error page named that page: "could not reach" the page still open.
describe('a page that would not load', () => {
  const web = (url) => ({ url, source: { kind: 'web', uri: url } })
  const error = { kind: 'error', html: '<p>failed</p>' }
  const page = 'https://example.com/'
  const dead = 'https://does-not-exist.example/'

  test('is a step of its own after the page a link left', () => {
    const state = recordBrowserErrorState({ history: [web('https://start.example/'), web(page)], historyIndex: 1 }, dead, error)
    assert.deepEqual(state.history.map((entry) => entry.url), ['https://start.example/', page, dead])
    assert.equal(state.history[2].source, error)
    assert.equal(getBrowserBackState(state).currentUrl, page)
  })

  test('is the step itself when that step failed', () => {
    // An address typed, or a reload.
    const state = recordBrowserErrorState({ history: [web(page), web(dead)], historyIndex: 1 }, dead, error)
    assert.deepEqual(state.history.map((entry) => entry.url), [page, dead])
    assert.equal(state.history[1].source, error)
  })

  test('is the step Back or Forward was going to', () => {
    const state = recordBrowserErrorState({ history: [web(dead), web(page)], historyIndex: 1 }, dead, error, 'back')
    assert.equal(state.historyIndex, 0)
    assert.deepEqual(state.history.map((entry) => entry.url), [dead, page])
    assert.equal(state.history[0].source, error)
    assert.equal(state.canGoForward, true)
  })

  test('names the address that failed, which iOS gives apart', async () => {
    const { readFile } = await import('node:fs/promises')
    const patch = await readFile(new URL('../../patches/react-native-webview+13.16.0.patch', import.meta.url), 'utf8')
    assert.match(patch, /\+ {4}id failingURL = error\.userInfo\[NSURLErrorFailingURLErrorKey\];/)
    assert.match(patch, /\+ {6}event\[@"failingUrl"\] = failingUrl;/)
    const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    const onError = app.slice(app.indexOf('              onError={(event) => {'), app.indexOf('            />', app.indexOf('              onError={(event) => {')))
    assert.match(onError, /const failingUrl = \(event\.nativeEvent as \{ failingUrl\?: unknown \}\)\.failingUrl/)
    assert.match(onError, /const candidateUrl = \(typeof failingUrl === 'string' && failingUrl\) \|\| event\.nativeEvent\.url \|\| entry\.url/)
    assert.match(onError, /applyBrowserState\(recordBrowserErrorState\(/)
    assert.doesNotMatch(onError, /replaceBrowserEntry\(failedUrl/)
  })
})
