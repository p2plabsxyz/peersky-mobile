import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import vm from 'node:vm'
import {
  createForceDarkScript,
  createForceDarkRemovalScript,
  FORCE_DARK_STYLE_ID
} from '../../app/browser-force-dark.mjs'

// Enough of a page to run the script in. Each element has a background, and
// every point on the screen lands on `hit`: the page's content, or a video.
function createPage ({
  root = 'rgb(255, 255, 255)',
  content = 'rgba(0, 0, 0, 0)',
  hit = 'MAIN',
  attributes = {},
  classes = [],
  colorScheme = null
} = {}) {
  const styles = new Map()
  const make = (tagName, backgroundColor, parentElement = null, own = {}) => ({
    tagName,
    backgroundColor,
    parentElement,
    attributes: { ...own.attributes },
    classList: { contains: (name) => (own.classes || []).includes(name) },
    hasAttribute (name) { return name in this.attributes },
    getAttribute (name) { return name in this.attributes ? this.attributes[name] : null }
  })
  const documentElement = make('HTML', root, null, { attributes, classes })
  const body = make('BODY', 'rgba(0, 0, 0, 0)', documentElement)
  const main = make(hit, content, body)
  const timers = []
  const listeners = {}
  let observer = null
  const document = {
    documentElement,
    body,
    readyState: 'complete',
    head: { appendChild: (style) => styles.set(style.id, style) },
    createElement: () => ({ id: '', textContent: '', sheet: { disabled: false }, remove () { styles.delete(this.id) } }),
    getElementById: (id) => styles.get(id) || null,
    elementFromPoint: () => main,
    querySelector: (selector) => colorScheme !== null && selector.includes('color-scheme')
      ? { getAttribute: () => colorScheme }
      : null,
    addEventListener: () => {}
  }
  // The rule paints the root white while it is on, as a browser would say.
  const painted = (element) => element === documentElement &&
    [...styles.values()].some((style) => !style.sheet.disabled)
  const history = { pushState () {}, replaceState () {} }
  const window = {}
  const context = vm.createContext({
    window,
    document,
    history,
    innerWidth: 400,
    innerHeight: 800,
    getComputedStyle: (element) => ({
      backgroundColor: painted(element) ? 'rgb(255, 255, 255)' : element.backgroundColor,
      colorScheme: 'normal'
    }),
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
    css: () => styles.get(FORCE_DARK_STYLE_ID)?.textContent || '',
    inverted: () => styles.has(FORCE_DARK_STYLE_ID),
    sheetDisabled: () => Boolean(styles.get(FORCE_DARK_STYLE_ID)?.sheet.disabled),
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

  // YouTube marks its own dark theme on the root, and a Short is nothing but
  // video, so the samples found nothing and the page was taken for light.
  // Inverted, its white text came out black on black.
  test('a page that says it is dark is left alone, even when all of it is video', () => {
    const says = [
      { attributes: { 'darker-dark-theme': '' } },
      { attributes: { dark: 'true' } },
      { attributes: { 'data-theme': 'dark' } },
      { attributes: { 'data-bs-theme': 'dark' } },
      { attributes: { 'data-color-mode': 'dark' } },
      { classes: ['dark'] },
      { classes: ['theme-dark'] },
      { colorScheme: 'dark' },
      { colorScheme: ' Only Dark ' }
    ]
    for (const options of says) {
      const page = createPage({ hit: 'VIDEO', ...options })
      run(page, createForceDarkScript(true))
      assert.equal(page.inverted(), false, JSON.stringify(options))
    }

    // Light, or both: the page has not said it is dark.
    for (const options of [{ attributes: { 'data-theme': 'light' } }, { classes: ['dark-header'] }, { colorScheme: 'light dark' }]) {
      const page = createPage({ hit: 'VIDEO', ...options })
      run(page, createForceDarkScript(true))
      assert.equal(page.inverted(), true, JSON.stringify(options))
    }
  })

  test('with only video on screen, the page\'s own background decides', () => {
    const dark = createPage({ hit: 'VIDEO', root: 'rgb(15, 15, 15)' })
    run(dark, createForceDarkScript(true))
    assert.equal(dark.inverted(), false)

    const light = createPage({ hit: 'VIDEO' })
    run(light, createForceDarkScript(true))
    assert.equal(light.inverted(), true)
  })

  // The rule paints the root white. Read back, that made a dark page look
  // light, so a page inverted once by mistake stayed inverted for good.
  test('an inverted page is read without the rule, so a dark one comes back', () => {
    const page = createPage({ hit: 'VIDEO' })
    run(page, createForceDarkScript(true))
    assert.equal(page.inverted(), true)

    page.documentElement.backgroundColor = 'rgb(15, 15, 15)'
    page.mutate()
    assert.equal(page.inverted(), false)

    // And a light one stays inverted, with the rule switched back on.
    const light = createPage({ content: 'rgb(255, 255, 255)' })
    run(light, createForceDarkScript(true))
    light.mutate()
    assert.equal(light.inverted(), true)
    assert.equal(light.sheetDisabled(), false)
  })

  test('a theme switched on the root later is seen, YouTube\'s included', () => {
    const page = createPage({ content: 'rgb(255, 255, 255)' })
    run(page, createForceDarkScript(true))
    assert.equal(page.inverted(), true)

    page.documentElement.attributes['darker-dark-theme'] = ''
    page.mutate()
    assert.equal(page.inverted(), false)

    const script = createForceDarkScript(true)
    assert.match(script, /DARK_ATTRIBUTES = \['dark', 'darker-dark-theme'\]/)
    assert.match(script, /attributeFilter: \['class', 'style', \.\.\.DARK_ATTRIBUTES, \.\.\.THEME_ATTRIBUTES\]/)
  })

  // YouTube's buttons are a faint white over its dark page.
  test('faint white over a dark page does not make it light', () => {
    const page = createPage({ root: 'rgb(15, 15, 15)', content: 'rgba(255, 255, 255, 0.1)' })
    run(page, createForceDarkScript(true))
    assert.equal(page.inverted(), false)
  })

  test('a picture inside a picture is turned back once, not twice', () => {
    const page = createPage({ content: 'rgb(255, 255, 255)' })
    run(page, createForceDarkScript(true))
    const media = 'img,picture,video,canvas,svg,iframe,embed,object,[style*="background-image"]'
    assert.ok(page.css().includes(`${media}{filter:invert(1) hue-rotate(180deg) !important;}`))
    assert.ok(page.css().includes(`:is(${media}) :is(${media}){filter:none !important;}`))
  })

  test('the rule lands even when it runs before the document exists', () => {
    const script = createForceDarkScript(true)

    assert.match(script, /document\.head \|\| document\.documentElement/)
    assert.match(script, /readyState === 'loading'/)
  })
})
