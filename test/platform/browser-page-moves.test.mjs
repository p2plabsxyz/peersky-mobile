import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import vm from 'node:vm'
import {
  BROWSER_PAGE_MOVE_MESSAGE_TYPE,
  classifyBrowserPageMove,
  createBrowserPageMoveScript,
  parseBrowserPageMoveMessage
} from '../../app/browser-page-moves.mjs'
import {
  BROWSER_HOME_URL,
  getBrowserBackState,
  recordBrowserWebNavigationState,
  settleLateBrowserPageMove
} from '../../app/browser-shell.mjs'

const TOKEN = 'a'.repeat(32)
const RESULTS = 'https://m.youtube.com/results?search_query=ncs'
const VIDEO = 'https://m.youtube.com/watch?v=3nQNiWdeH2Q&pp=ygU'
const VIDEO_RA = `${VIDEO}&ra=m`

const web = (url) => ({ url, source: { kind: 'web', uri: url } })

// A page with the script in it, as a WebView runs it: its own history and
// address, and the bridge the app reads. With `api`, the WebView has the
// Navigation API, and the page's changes come as its events.
function pageWith (script, { url = RESULTS, length = 1, navigation = 'navigate', api = null } = {}) {
  const posted = []
  const listeners = {}
  const navigationListeners = {}
  const location = { href: url }
  const entryChange = (navigationType, from) => navigationListeners.currententrychange?.({
    navigationType,
    from: { url: from }
  })
  const history = {
    length,
    pushState (state, title, next) {
      const from = location.href
      location.href = new URL(next, location.href).href
      history.length += 1
      if (api) entryChange('push', from)
    },
    replaceState (state, title, next) {
      const from = location.href
      const target = new URL(next, location.href)
      if (target.origin !== new URL(location.href).origin) throw new Error('SecurityError')
      location.href = target.href
      if (api) entryChange('replace', from)
    }
  }
  const window = {
    ReactNativeWebView: { postMessage: (message) => posted.push(JSON.parse(message)) },
    history,
    addEventListener: (type, listener) => { listeners[type] = listener }
  }
  window.window = window
  if (api) {
    window.navigation = {
      activation: api.activation ? { navigationType: api.activation, from: api.from ? { url: api.from } : null } : null,
      addEventListener: (type, listener) => { navigationListeners[type] = listener }
    }
  }
  const document = {
    addEventListener: (type, listener) => { listeners[`document ${type}`] = listener }
  }
  // The page's own JSON, Object and the rest, as a page has, for it to
  // tamper with.
  const context = vm.createContext({
    window,
    document,
    location,
    history,
    performance: { getEntriesByType: () => [{ type: navigation }] }
  })
  vm.runInContext(script, context)
  return {
    posted,
    history,
    location,
    // A step back or forward, or a link to a part of the page followed.
    traverse (to) {
      const from = location.href
      location.href = to
      if (api) entryChange('traverse', from)
      listeners.popstate?.({})
    },
    // From a step behind, the new step cuts the one ahead: the count stays.
    followLink (to, { cuts = false } = {}) {
      const from = location.href
      listeners['document click']?.({ target: { closest: () => ({ href: to }) } })
      location.href = to
      if (!cuts) history.length += 1
      if (api) entryChange('push', from)
      listeners.popstate?.({})
      listeners.hashchange?.({})
    },
    run: (code) => vm.runInContext(code, context)
  }
}

const kinds = (page) => page.posted.slice(1).map(({ kind, from, url, length }) => ({ kind, from, url, length }))

describe('page moves', () => {
  test('the script is only made with a tab token', () => {
    assert.equal(createBrowserPageMoveScript(''), '')
    assert.equal(createBrowserPageMoveScript('not a token'), '')
    assert.match(createBrowserPageMoveScript(TOKEN), /peersky-browser-page-move/)
  })

  test('with the Navigation API, a page says what each change was, as the WebView says it', () => {
    const page = pageWith(createBrowserPageMoveScript(TOKEN), { api: { activation: 'push' } })
    assert.deepEqual(page.posted.map(({ kind, navigation, from }) => [kind, navigation, from]), [['document', 'push', '']])

    page.history.pushState({}, '', '/watch?v=3nQNiWdeH2Q&pp=ygU')
    page.history.replaceState({}, '', '/watch?v=3nQNiWdeH2Q&pp=ygU&ra=m')
    page.history.replaceState({}, '', page.location.href)
    page.followLink(`${VIDEO_RA}#comments`)
    page.traverse(VIDEO_RA)
    assert.deepEqual(kinds(page), [
      { kind: 'push', from: RESULTS, url: VIDEO, length: 2 },
      { kind: 'replace', from: VIDEO, url: VIDEO_RA, length: 2 },
      { kind: 'push', from: VIDEO_RA, url: `${VIDEO_RA}#comments`, length: 3 },
      { kind: 'traverse', from: '', url: VIDEO_RA, length: 3 }
    ])

    // A page put in another's place, by location.replace, says so when it
    // opens, and which page it took the place of.
    const replaced = pageWith(createBrowserPageMoveScript(TOKEN), { api: { activation: 'replace', from: VIDEO }, url: VIDEO_RA })
    assert.deepEqual(replaced.posted.map(({ kind, navigation, from }) => [kind, navigation, from]), [['document', 'replace', VIDEO]])
    // The API names that page only on the same site.
    const elsewhere = pageWith(createBrowserPageMoveScript(TOKEN), { api: { activation: 'replace' }, url: VIDEO_RA })
    assert.deepEqual(elsewhere.posted.map(({ kind, navigation, from }) => [kind, navigation, from]), [['document', 'replace', '']])
  })

  test('an older WebView: pushState and replaceState are wrapped, and a popstate is read with care', () => {
    const page = pageWith(createBrowserPageMoveScript(TOKEN), { navigation: 'navigate' })
    assert.deepEqual(page.posted.map(({ kind, navigation }) => [kind, navigation]), [['document', 'push']])

    page.history.pushState({}, '', '/watch?v=3nQNiWdeH2Q&pp=ygU')
    page.history.replaceState({}, '', '/watch?v=3nQNiWdeH2Q&pp=ygU&ra=m')
    // A rewrite to the same address, or to another site, is no change. A push
    // to the same address still adds a page, so it is told for the count.
    page.history.replaceState({}, '', page.location.href)
    assert.throws(() => page.history.replaceState({}, '', 'https://example.com/'))
    page.history.pushState({}, '', page.location.href)
    // A link to a part of the page fires popstate too, and is a new step.
    page.followLink(`${VIDEO_RA}#comments`)
    page.traverse(VIDEO_RA)
    assert.deepEqual(kinds(page), [
      { kind: 'push', from: RESULTS, url: VIDEO, length: 2 },
      { kind: 'replace', from: VIDEO, url: VIDEO_RA, length: 2 },
      { kind: 'push', from: VIDEO_RA, url: VIDEO_RA, length: 3 },
      { kind: 'push', from: VIDEO_RA, url: `${VIDEO_RA}#comments`, length: 4 },
      { kind: 'traverse', from: '', url: VIDEO_RA, length: 4 }
    ])
    for (const report of page.posted) {
      assert.equal(report.type, BROWSER_PAGE_MOVE_MESSAGE_TYPE)
      assert.equal(report.token, TOKEN)
    }

    // A page reached by Back, or reloaded. Without the API, a page put in
    // another's place can't say so, and is a new page.
    assert.equal(pageWith(createBrowserPageMoveScript(TOKEN), { navigation: 'back_forward' }).posted[0].navigation, 'traverse')
    assert.equal(pageWith(createBrowserPageMoveScript(TOKEN), { navigation: 'reload' }).posted[0].navigation, 'reload')
  })

  test('an older WebView: a link to a part of the page from a step behind is a new step too', () => {
    const page = pageWith(createBrowserPageMoveScript(TOKEN), { url: VIDEO, length: 3 })
    // The count stays 3 when the link cuts the step ahead: only the click tells.
    page.followLink(`${VIDEO}#comments`, { cuts: true })
    assert.equal(page.history.length, 3)
    assert.equal(page.posted.at(-1).kind, 'push')
    page.traverse(VIDEO)
    assert.equal(page.posted.at(-1).kind, 'traverse')
  })

  test('the script runs once a page, and not without the bridge', () => {
    const script = createBrowserPageMoveScript(TOKEN)
    const page = pageWith(script)
    page.run(script)
    page.history.pushState({}, '', '/a')
    assert.equal(page.posted.filter((report) => report.kind === 'push').length, 1)

    const apiPage = pageWith(script, { api: { activation: 'push' } })
    apiPage.run(script)
    apiPage.history.pushState({}, '', '/a')
    assert.equal(apiPage.posted.filter((report) => report.kind === 'push').length, 1)

    const context = vm.createContext({ window: {}, location: { href: RESULTS }, history: { length: 1 } })
    context.window.window = context.window
    assert.doesNotThrow(() => vm.runInContext(script, context))
  })

  test('a page that swaps JSON.stringify or adds toJSON later never sees the token', () => {
    for (const api of [null, { activation: 'push' }]) {
      const page = pageWith(createBrowserPageMoveScript(TOKEN), { api })
      page.run(`
        window.seen = [];
        JSON.stringify = function (value) { window.seen.push(value && value.token); return '{}'; };
        Object.prototype.toJSON = function () { window.seen.push(this.token); return {}; };
        Object.assign = function (target) { window.seen.push(target && target.token); return target; };
      `)
      page.history.pushState({}, '', '/watch?v=3nQNiWdeH2Q&pp=ygU')
      assert.equal(page.run('window.seen.length'), 0)
      assert.equal(page.posted.at(-1).kind, 'push')
      assert.equal(page.posted.at(-1).token, TOKEN)
    }
  })

  test('only reports with the tab token, about web pages, are read', () => {
    const message = (fields) => JSON.stringify({
      type: BROWSER_PAGE_MOVE_MESSAGE_TYPE,
      token: TOKEN,
      kind: 'replace',
      from: VIDEO,
      url: VIDEO_RA,
      length: 2,
      navigation: '',
      ...fields
    })

    assert.deepEqual(parseBrowserPageMoveMessage(message(), TOKEN), {
      kind: 'replace', url: VIDEO_RA, from: VIDEO, length: 2, navigation: ''
    })
    // A new page names the one it took the place of only on its own site, and
    // a step back names none.
    assert.equal(parseBrowserPageMoveMessage(message({ kind: 'document', navigation: 'replace' }), TOKEN).from, VIDEO)
    assert.equal(parseBrowserPageMoveMessage(message({ kind: 'document', navigation: 'replace', from: 'https://bank.example/' }), TOKEN).from, null)
    assert.equal(parseBrowserPageMoveMessage(message({ kind: 'document', from: '' }), TOKEN).from, null)
    assert.equal(parseBrowserPageMoveMessage(message({ kind: 'traverse' }), TOKEN).from, null)
    assert.equal(parseBrowserPageMoveMessage(message({ token: 'b'.repeat(32) }), TOKEN), null)
    assert.equal(parseBrowserPageMoveMessage(message(), ''), null)
    assert.equal(parseBrowserPageMoveMessage(message({ type: 'peersky-browser-media-long-press' }), TOKEN), null)
    assert.equal(parseBrowserPageMoveMessage(message({ kind: 'teleport' }), TOKEN), null)
    assert.equal(parseBrowserPageMoveMessage(message({ url: 'hyper://example/' }), TOKEN), null)
    assert.equal(parseBrowserPageMoveMessage(message({ url: 'javascript:alert(1)' }), TOKEN), null)
    assert.equal(parseBrowserPageMoveMessage(message({ length: 0 }), TOKEN), null)
    assert.equal(parseBrowserPageMoveMessage(message({ length: 2.5 }), TOKEN), null)
    // replaceState never crosses sites.
    assert.equal(parseBrowserPageMoveMessage(message({ from: 'https://bank.example/' }), TOKEN), null)
    assert.equal(parseBrowserPageMoveMessage(message({ from: '' }), TOKEN), null)
    assert.equal(parseBrowserPageMoveMessage(`${message()}${' '.repeat(20000)}`, TOKEN), null)
    assert.equal(parseBrowserPageMoveMessage('not json', TOKEN), null)
    assert.equal(parseBrowserPageMoveMessage(message({ kind: 'document', from: 'whatever', navigation: 'warp' }), TOKEN).navigation, '')
  })

  test('a report is a replace of the page it names, a step back or forward, or a new page', () => {
    const report = (kind, from = null, navigation = '') => ({ kind, from, navigation })
    assert.deepEqual(classifyBrowserPageMove(report('replace', VIDEO)), { move: 'replace', from: VIDEO })
    assert.deepEqual(classifyBrowserPageMove(report('traverse')), { move: 'traverse', from: null })
    assert.equal(classifyBrowserPageMove(report('push', RESULTS)), null)
    assert.deepEqual(classifyBrowserPageMove(report('document', VIDEO, 'replace')), { move: 'replace', from: VIDEO })
    assert.deepEqual(classifyBrowserPageMove(report('document', null, 'traverse')), { move: 'traverse', from: null })
    // Put in the place of a page it can't name, or opened, or reloaded: new.
    assert.equal(classifyBrowserPageMove(report('document', null, 'replace')), null)
    assert.equal(classifyBrowserPageMove(report('document', null, 'push')), null)
    assert.equal(classifyBrowserPageMove(report('document', null, 'reload')), null)
  })
})

describe('tab history with page moves', () => {
  test('a video YouTube rewrites the address of is one step, so one Back leaves it', () => {
    let state = { history: [web(BROWSER_HOME_URL), web(RESULTS)], historyIndex: 1 }
    state = recordBrowserWebNavigationState(state, VIDEO, { kind: 'web', uri: VIDEO })
    state = recordBrowserWebNavigationState(state, VIDEO_RA, { kind: 'web', uri: VIDEO_RA }, null, true, false, { move: 'replace', from: VIDEO })

    assert.deepEqual(state.history.map((entry) => entry.url), [BROWSER_HOME_URL, RESULTS, VIDEO_RA])
    assert.equal(getBrowserBackState(state).currentUrl, RESULTS)

    // As before: without the page's word, the rewrite is a new page.
    let old = { history: [web(RESULTS)], historyIndex: 0 }
    old = recordBrowserWebNavigationState(old, VIDEO, { kind: 'web', uri: VIDEO })
    old = recordBrowserWebNavigationState(old, VIDEO_RA, { kind: 'web', uri: VIDEO_RA })
    assert.equal(old.history.length, 3)
  })

  test('a replace while the page is still loading waits for it', () => {
    const state = { history: [web(RESULTS), web(VIDEO)], historyIndex: 1 }
    const loading = recordBrowserWebNavigationState(state, VIDEO_RA, { kind: 'web', uri: VIDEO_RA }, null, true, true, { move: 'replace', from: VIDEO })
    assert.equal(loading.currentUrl, VIDEO)
  })

  test('a page that moves on before it was ever a step leaves the step before it', () => {
    // [start] and a link to a redirect page that put another in its place
    // while it loaded: the tab never had the redirect page, so the new page
    // is a step of its own.
    const START = 'https://example.com/start'
    const REDIRECT = 'https://example.com/redirect'
    const LANDED = 'https://example.com/landed'
    const state = { history: [web(BROWSER_HOME_URL), web(START)], historyIndex: 1 }
    const landed = recordBrowserWebNavigationState(state, LANDED, { kind: 'web', uri: LANDED }, null, true, false, { move: 'replace', from: REDIRECT })
    assert.deepEqual(landed.history.map((entry) => entry.url), [BROWSER_HOME_URL, START, LANDED])

    // The redirect page finished loading first, so it was a step: it goes.
    const recorded = { history: [web(BROWSER_HOME_URL), web(START), web(REDIRECT)], historyIndex: 2 }
    const replaced = recordBrowserWebNavigationState(recorded, LANDED, { kind: 'web', uri: LANDED }, null, true, false, { move: 'replace', from: REDIRECT })
    assert.deepEqual(replaced.history.map((entry) => entry.url), [BROWSER_HOME_URL, START, LANDED])
    assert.equal(getBrowserBackState(replaced).currentUrl, START)
  })

  test('the page going back by itself lands on the step behind, with this one ahead', () => {
    const state = { history: [web(RESULTS), web(VIDEO), web(`${VIDEO}#comments`)], historyIndex: 2 }
    const traverse = { move: 'traverse', from: null }
    const back = recordBrowserWebNavigationState(state, VIDEO, { kind: 'web', uri: VIDEO }, null, true, false, traverse)
    assert.equal(back.historyIndex, 1)
    assert.equal(back.history.length, 3)
    assert.equal(back.canGoForward, true)

    const forward = recordBrowserWebNavigationState(back, `${VIDEO}#comments`, { kind: 'web', uri: `${VIDEO}#comments` }, null, true, false, traverse)
    assert.equal(forward.historyIndex, 2)

    // Back to a page the tab doesn't have next to this one is a new step.
    const elsewhere = recordBrowserWebNavigationState(state, 'https://m.youtube.com/', { kind: 'web', uri: 'https://m.youtube.com/' }, null, true, false, traverse)
    assert.deepEqual(elsewhere.history.map((entry) => entry.url), [RESULTS, VIDEO, `${VIDEO}#comments`, 'https://m.youtube.com/'])
  })

  test('a report after the WebView\'s folds back the page it was taken for', () => {
    // [results, video] took the rewrite as [results, video, video&ra=m].
    const state = { history: [web(RESULTS), web(VIDEO), web(VIDEO_RA)], historyIndex: 2 }
    const added = { url: VIDEO_RA, index: 2 }
    const settled = settleLateBrowserPageMove(state, { move: 'replace', url: VIDEO_RA, from: VIDEO }, added)
    assert.deepEqual(settled.history.map((entry) => entry.url), [RESULTS, VIDEO_RA])
    assert.equal(settled.historyIndex, 1)

    // The page went back to the results: [results, video, results] is
    // [results, video] on the results.
    const traversed = { history: [web(RESULTS), web(VIDEO), web(RESULTS)], historyIndex: 2 }
    const back = settleLateBrowserPageMove(traversed, { move: 'traverse', url: RESULTS }, { url: RESULTS, index: 2 })
    assert.deepEqual(back.history.map((entry) => entry.url), [RESULTS, VIDEO])
    assert.equal(back.historyIndex, 0)
    assert.equal(back.canGoForward, true)

    // Nothing to fold: another page on screen, a report about another page,
    // a rewrite of a page that wasn't the one before, or no page just added.
    assert.equal(settleLateBrowserPageMove({ ...state, historyIndex: 1 }, { move: 'replace', url: VIDEO_RA, from: VIDEO }, added), null)
    assert.equal(settleLateBrowserPageMove(state, { move: 'replace', url: RESULTS, from: VIDEO }, added), null)
    assert.equal(settleLateBrowserPageMove(state, { move: 'replace', url: VIDEO_RA, from: RESULTS }, added), null)
    assert.equal(settleLateBrowserPageMove(state, { move: 'replace', url: VIDEO_RA, from: VIDEO }, null), null)
    assert.equal(settleLateBrowserPageMove(traversed, { move: 'traverse', url: VIDEO }, { url: VIDEO, index: 2 }), null)
  })
})

describe('the app and page moves', () => {
  test('every web page gets the script with its tab\'s token, and only a web page is heard', async () => {
    const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    const early = app.slice(app.indexOf('const browserBeforeContentScript = combineBrowserInjectedScripts('))
    assert.match(early.slice(0, early.indexOf('\n          )')), /\n\s+createBrowserPageMoveScript\(browserMediaToken\),\n/)
    const start = app.indexOf('onNavigationStateChange={(navigationState) => {')
    const message = app.slice(app.indexOf('onMessage={(event) => {', start))
    assert.match(message, /const pageMove = parseBrowserPageMoveMessage\(event\.nativeEvent\.data, browserMediaToken\)[^\n]*\n\s+if \(pageMove\) \{\n\s+if \(entry\.source\.kind === 'web'\) onBrowserPageMove\(tab\.id, webViewGeneration, pageMove\)\n\s+return\n/)
    // A report is used only for the change it was about, once a page is there.
    const change = app.slice(start, app.indexOf('onMessage={(event) => {', start))
    assert.match(change, /const pageMove = loading \? null : takeBrowserPageMove\(tab\.id, webViewGeneration, navigationState\.url\)/)
  })

  test('a page that redirects as soon as it loads is let through, by its own WebView only', async () => {
    const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    const start = app.indexOf('  function onBrowserShouldStartLoad (')
    const check = app.slice(start, app.indexOf('const action = getBrowserRequestAction(', start))
    assert.match(check, /\(browserWebViewGenerationsRef\.current\.get\(tabId\) \|\| 0\) !== webViewGeneration \|\|\n\s+!isCurrentBrowserTabEntry\(browserTabsStateRef\.current, tabId, expectedEntry\)\n\s+\) return false/)
    assert.doesNotMatch(check, /!== expectedEntry/)
    assert.match(app, /onShouldStartLoadWithRequest=\{\(request\) => onBrowserShouldStartLoad\(tab\.id, entry, webViewGeneration, request\)\}/)
  })
})
