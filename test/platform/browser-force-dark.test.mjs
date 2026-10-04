import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import vm from 'node:vm'
import {
  createForceDarkScript,
  createForceDarkRemovalScript,
  FORCE_DARK_STYLE_ID
} from '../../app/browser-force-dark.mjs'

// Enough of a page to run the script in. Each element has a background, and
// the point in the middle of the screen lands on `content`.
function createPage ({ root = 'rgb(255, 255, 255)', content = 'rgba(0, 0, 0, 0)' } = {}) {
  const styles = new Map()
  const make = (tagName, backgroundColor, parentElement = null) => ({ tagName, backgroundColor, parentElement })
  const documentElement = make('HTML', root)
  const body = make('BODY', 'rgba(0, 0, 0, 0)', documentElement)
  const main = make('MAIN', content, body)
  const timers = []
  const listeners = {}
  let observer = null
  const document = {
    documentElement,
    body,
    readyState: 'complete',
    head: { appendChild: (style) => styles.set(style.id, style) },
    createElement: () => ({ id: '', textContent: '', remove () { styles.delete(this.id) } }),
    getElementById: (id) => styles.get(id) || null,
    elementFromPoint: () => main,
    addEventListener: () => {}
  }
  const history = { pushState () {}, replaceState () {} }
  const window = {}
  const context = vm.createContext({
    window,
    document,
    history,
    innerWidth: 400,
    innerHeight: 800,
    getComputedStyle: (element) => ({ backgroundColor: element.backgroundColor, colorScheme: 'normal' }),
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (callback) => callback(),
    setTimeout: (callback) => { timers.push(callback); return timers.length },
    addEventListener: (name, listener) => { (listeners[name] ||= []).push(listener) },
    MutationObserver: class {
      constructor (callback) { observer = callback }
      observe () {}
    }
  })
  return {
    context,
    documentElement,
    main,
    history,
    inverted: () => styles.has(FORCE_DARK_STYLE_ID),
    mutate: () => observer && observer(),
    runTimers: () => timers.splice(0).forEach((callback) => callback())
  }
}

const run = (page, script) => vm.runInContext(script, page.context)

describe('force dark mode', () => {
  test('turning it off removes what turning it on added', () => {
    // The same id both ways, or switching it off leaves the page inverted
    // until it is reloaded.
    assert.match(createForceDarkScript(false), new RegExp(FORCE_DARK_STYLE_ID))
    assert.equal(createForceDarkScript(false), createForceDarkRemovalScript())
    assert.match(createForceDarkRemovalScript(), /style\.remove\(\)/)
  })

  test('media is inverted back, so photos are not negatives', () => {
    const script = createForceDarkScript(true)

    assert.match(script, /html\{filter:invert\(1\) hue-rotate\(180deg\)/)
    assert.match(script, /img,picture,video,canvas,svg,iframe,embed,object,/)
  })

  test('a light page is darkened and a dark one is left alone', () => {
    const light = createPage({ content: 'rgb(255, 255, 255)' })
    run(light, createForceDarkScript(true))
    assert.equal(light.inverted(), true)

    const dark = createPage({ root: 'rgb(15, 15, 15)', content: 'rgb(15, 15, 15)' })
    run(dark, createForceDarkScript(true))
    assert.equal(dark.inverted(), false)
  })

  // A video page on YouTube has a black root under a white list. Judged by
  // the root, it was taken for dark and left white.
  test('the page is judged by what is on screen, not by its root', () => {
    const page = createPage({ root: 'rgb(15, 15, 15)', content: 'rgb(255, 255, 255)' })
    run(page, createForceDarkScript(true))
    assert.equal(page.inverted(), true)
  })

  // The first answer used to stay for good. YouTube moves between pages and
  // themes without loading a new document, and a page that had gone dark
  // came out inverted, with its own white icons on a light bar.
  test('a page that turns dark later is put back, and a light one darkened again', () => {
    const page = createPage({ content: 'rgb(255, 255, 255)' })
    run(page, createForceDarkScript(true))
    assert.equal(page.inverted(), true)

    page.main.backgroundColor = 'rgb(15, 15, 15)'
    page.history.pushState({}, '', '/watch')
    page.runTimers()
    assert.equal(page.inverted(), false)

    page.main.backgroundColor = 'rgb(250, 250, 250)'
    page.mutate()
    assert.equal(page.inverted(), true)
  })

  test('turned off, it stays off when the page changes', () => {
    const page = createPage({ content: 'rgb(255, 255, 255)' })
    run(page, createForceDarkScript(true))
    run(page, createForceDarkRemovalScript())
    assert.equal(page.inverted(), false)

    page.mutate()
    page.runTimers()
    assert.equal(page.inverted(), false)

    // And on again without a reload.
    run(page, createForceDarkScript(true))
    assert.equal(page.inverted(), true)
  })

  // A site with a dark theme of its own does better with it than inverted.
  // On iOS the tab is told dark is preferred, so YouTube and the like use
  // theirs, and only sites without one are left to the script.
  test('iOS tabs ask sites for their own dark theme', async () => {
    const { readFile } = await import('node:fs/promises')
    const manager = await readFile(new URL('../../plugins/templates/PeerSkyWebViewManager.m.template', import.meta.url), 'utf8')
    assert.match(manager, /RCT_EXPORT_VIEW_PROPERTY\(forceDarkScheme, BOOL\)/)
    assert.match(manager, /self\.overrideUserInterfaceStyle = forceDarkScheme \? UIUserInterfaceStyleDark : UIUserInterfaceStyleUnspecified;/)
    const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    assert.match(app, /Platform\.OS === 'ios' \? \{ forceDarkScheme: browserPreferences\.forceDarkWebsites \} : \{\}/)
  })

  test('the rule lands even when it runs before the document exists', () => {
    const script = createForceDarkScript(true)

    assert.match(script, /document\.head \|\| document\.documentElement/)
    assert.match(script, /readyState === 'loading'/)
  })
})
