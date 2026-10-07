import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

import {
  createPullRefreshScript,
  parsePullRefreshMessage,
  PULL_REFRESH_MAX,
  PULL_REFRESH_MESSAGE_TYPE,
  PULL_REFRESH_TRIGGER,
  pullRefreshOffset,
  shouldReloadOnRelease
} from '../../app/browser-pull-refresh.mjs'

const TOKEN = 'b'.repeat(32)
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// Pull down at the top of a page to reload it. iOS has it in the WebView;
// Android's page reports the pull and the app draws the spinner.

// Just enough of a page for the script: listeners, a scrolling root, a body,
// and the messages it posts.
function page ({ scrollTop = 0, overscroll = 'auto', scale = 1, pixelRatio = 2 } = {}) {
  const listeners = {}
  const posted = []
  const body = { nodeType: 1, scrollTop: 0, parentElement: null }
  const root = { nodeType: 1, scrollTop, parentElement: null }
  body.parentElement = root
  const window = {
    ReactNativeWebView: { postMessage: (message) => posted.push(JSON.parse(message)) },
    addEventListener: (type, listener) => { listeners[type] = listener },
    devicePixelRatio: pixelRatio,
    document: { body, documentElement: root, scrollingElement: root },
    getComputedStyle: () => ({ overscrollBehaviorY: overscroll }),
    scrollY: scrollTop,
    visualViewport: { scale }
  }
  window.window = window
  vm.runInNewContext(createPullRefreshScript(TOKEN), window)
  const touch = (type, y, { x = 100, target = body, touches = 1, defaultPrevented = false } = {}) => {
    listeners[type]({
      defaultPrevented,
      target,
      touches: Array.from({ length: type === 'touchend' ? 0 : touches }, () => ({ clientX: x, clientY: y }))
    })
  }
  return { body, posted, root, touch, window }
}

test('a pull down from the top of the page is reported, then the release', () => {
  const { posted, touch } = page()
  touch('touchstart', 100)
  touch('touchmove', 105)
  assert.equal(posted.length, 0, 'a few pixels is a tap, not a pull')
  touch('touchmove', 150)
  touch('touchmove', 200)
  touch('touchend', 200)
  assert.deepEqual(posted.map((message) => message.phase), ['move', 'move', 'end'])
  assert.ok(posted.every((message) => message.type === PULL_REFRESH_MESSAGE_TYPE && message.token === TOKEN))
  // In screen pixels: 100 CSS pixels on a 2x screen.
  assert.equal(posted.at(-1).distance, 200)
})

test('a page scrolled down, or a box that can still scroll up, keeps the pull', () => {
  const scrolled = page({ scrollTop: 40 })
  scrolled.touch('touchstart', 100)
  scrolled.touch('touchmove', 200)
  scrolled.touch('touchend', 200)
  assert.equal(scrolled.posted.length, 0)

  const inBox = page()
  const box = { nodeType: 1, scrollTop: 30, parentElement: inBox.body }
  inBox.touch('touchstart', 100, { target: box })
  inBox.touch('touchmove', 200, { target: box })
  inBox.touch('touchend', 200, { target: box })
  assert.equal(inBox.posted.length, 0)
})

test('a page that turned overscroll off, or one zoomed in, is left alone', () => {
  for (const options of [{ overscroll: 'none' }, { overscroll: 'contain' }, { scale: 2 }]) {
    const { posted, touch } = page(options)
    touch('touchstart', 100)
    touch('touchmove', 220)
    touch('touchend', 220)
    assert.equal(posted.length, 0, JSON.stringify(options))
  }
})

test('sideways, upward, two fingers or a page that takes the touch is not a pull', () => {
  const sideways = page()
  sideways.touch('touchstart', 100, { x: 100 })
  sideways.touch('touchmove', 130, { x: 180 })
  sideways.touch('touchmove', 200, { x: 180 })
  assert.equal(sideways.posted.length, 0)

  const upward = page()
  upward.touch('touchstart', 100)
  upward.touch('touchmove', 90)
  upward.touch('touchmove', 200)
  assert.equal(upward.posted.length, 0)

  const pinch = page()
  pinch.touch('touchstart', 100, { touches: 2 })
  pinch.touch('touchmove', 200, { touches: 2 })
  assert.equal(pinch.posted.length, 0)

  // A page dragging something of its own takes the touch part way through.
  const taken = page()
  taken.touch('touchstart', 100)
  taken.touch('touchmove', 150)
  taken.touch('touchmove', 200, { defaultPrevented: true })
  taken.touch('touchend', 200)
  assert.deepEqual(taken.posted.map((message) => message.phase), ['move', 'cancel'])
})

test('the script runs once a page, however often it is injected', () => {
  const { posted, touch, window } = page()
  vm.runInNewContext(createPullRefreshScript(TOKEN), window)
  touch('touchstart', 100)
  touch('touchmove', 200)
  assert.equal(posted.length, 1)
})

test('only a message with the tab\'s token is a pull, in points', () => {
  const message = (fields) => JSON.stringify({ type: PULL_REFRESH_MESSAGE_TYPE, token: TOKEN, phase: 'move', distance: 300, ...fields })
  assert.deepEqual(parsePullRefreshMessage(message(), TOKEN, 3), { phase: 'move', distance: 100 })
  assert.deepEqual(parsePullRefreshMessage(message({ phase: 'end' }), TOKEN, 0), { phase: 'end', distance: 300 })
  assert.equal(parsePullRefreshMessage(message({ token: 'c'.repeat(32) }), TOKEN, 3), null)
  assert.equal(parsePullRefreshMessage(message({ phase: 'reload' }), TOKEN, 3), null)
  assert.equal(parsePullRefreshMessage(message({ type: 'peersky-media' }), TOKEN, 3), null)
  assert.equal(parsePullRefreshMessage(message(), '', 3), null)
  assert.equal(parsePullRefreshMessage('{"type":', TOKEN, 3), null)
  assert.equal(parsePullRefreshMessage({ phase: 'move' }, TOKEN, 3), null)
  // Nonsense distances come out as no pull at all, or a capped one.
  assert.equal(parsePullRefreshMessage(message({ distance: 'far' }), TOKEN, 1).distance, 0)
  assert.equal(parsePullRefreshMessage(message({ distance: -50 }), TOKEN, 1).distance, 0)
  assert.equal(parsePullRefreshMessage(message({ distance: 1e9 }), TOKEN, 1).distance, 2000)
})

test('the spinner follows the finger slower, stops coming down, and arms at the trigger', () => {
  assert.equal(pullRefreshOffset(0), 0)
  assert.equal(pullRefreshOffset(-20), 0)
  assert.equal(pullRefreshOffset(50), 30)
  assert.equal(pullRefreshOffset(10000), PULL_REFRESH_MAX)
  assert.equal(shouldReloadOnRelease(PULL_REFRESH_TRIGGER - 1), false)
  assert.equal(shouldReloadOnRelease(PULL_REFRESH_TRIGGER), true)
  assert.equal(shouldReloadOnRelease(undefined), false)
})

test('the browser reloads on a pull: the system one on iOS, the page\'s report on Android', async () => {
  const index = await read('app/index.tsx')
  assert.match(index, /pullToRefreshEnabled=\{Platform\.OS === 'ios'\}/)
  assert.match(index, /Platform\.OS === 'android' \? createPullRefreshScript\(browserMediaToken\) : ''/)
  assert.match(index, /parsePullRefreshMessage\(event\.nativeEvent\.data, browserMediaToken, PixelRatio\.get\(\)\)/)
  // Only the tab on screen moves the spinner.
  assert.match(index, /if \(browserTabsStateRef\.current\.activeTabId === tab\.id\) onBrowserPull\(pull\)/)
  // A pull reloads even a page that is still loading, where the address bar's
  // button would stop it.
  assert.match(index, /function onBrowserPull[\s\S]{0,900}reloadBrowserPage\(\)/)
  assert.match(index, /<BrowserPullRefresh\s/)
})
