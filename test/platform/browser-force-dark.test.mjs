import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
  body: bodyColor = 'rgba(0, 0, 0, 0)',
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
  const body = make('BODY', bodyColor, documentElement)
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
  // While the rule is on, a browser says the root is dark and the body clear.
  const ruleOn = () => [...styles.values()].some((style) => !style.sheet.disabled)
  const backgroundOf = (element) => {
    if (!ruleOn()) return element.backgroundColor
    if (element === documentElement) return 'rgb(0, 0, 0)'
    if (element === body) return 'rgba(0, 0, 0, 0)'
    return element.backgroundColor
  }
  const history = { pushState () {}, replaceState () {} }
  const window = {}
  const context = vm.createContext({
    window,
    document,
    history,
    innerWidth: 400,
    innerHeight: 800,
    getComputedStyle: (element) => ({
      backgroundColor: backgroundOf(element),
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
    body,
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

  // The rule used to paint the root white. Read back, that made a dark page
  // look light, so a page inverted once by mistake stayed inverted for good.
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

  // Where the page draws nothing yet, and above the top while it is pulled
  // down, iOS shows the page's colour as the page set it, unfiltered. The rule
  // made the root white, so that showed white over a darkened page.
  test('past the page it stays dark: the root reads dark and the page\'s colour is drawn as a picture', () => {
    const page = createPage({ content: 'rgb(255, 255, 255)' })
    run(page, createForceDarkScript(true))
    assert.ok(page.css().startsWith(
      'html{filter:invert(1) hue-rotate(180deg) !important;background:rgb(0, 0, 0) ' +
      'linear-gradient(rgb(255, 255, 255),rgb(255, 255, 255)) no-repeat -10000000px -10000000px/20000000px 20000000px !important;}' +
      'body{background-color:transparent !important;}'
    ), page.css())
  })

  // Past the picture's edge the root's dark colour would come out light. Ten
  // million pixels each way is past any page, and under the 33 million or so
  // that WebKit and Chrome can lay out.
  test('the picture reaches past any page without leaving what browsers can lay out', () => {
    const page = createPage({ content: 'rgb(255, 255, 255)' })
    run(page, createForceDarkScript(true))
    const [, offset, size] = /no-repeat (-\d+)px \1px\/(\d+)px \2px/.exec(page.css()) || []
    assert.ok(offset && size, page.css())
    assert.equal(Number(size), -2 * Number(offset))
    assert.ok(Number(size) / 2 >= 10000000)
    assert.ok(Number(size) < 2 ** 25)
  })

  // react-native-webview gives the WebView's colour to iOS's scroll view as
  // well, which shows above the top of a page pulled down. It was white.
  test('on iOS the WebView is black while force dark is on, as a darkened white page is', async () => {
    const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    const styles = await readFile(new URL('../../app/styles.ts', import.meta.url), 'utf8')
    assert.match(app, /style=\{\[\s*styles\.browserWebView,\s*Platform\.OS === 'ios' && browserPreferences\.forceDarkWebsites \? styles\.browserWebViewForceDark : null\s*\]\}/)
    assert.match(styles, /browserWebViewForceDark: \{\s*backgroundColor: '#000000'\s*\}/)

    const page = createPage({ content: 'rgb(255, 255, 255)' })
    run(page, createForceDarkScript(true))
    assert.match(page.css(), /^html\{[^}]*background:rgb\(0, 0, 0\) /)
  })

  // The body's colour is read over the root's, so it is cleared, and the
  // picture under it carries it instead. A grey page with white cards keeps
  // its cards apart once darkened.
  test('a light body keeps its colour, and the root takes what the filter makes of it', () => {
    const page = createPage({ content: 'rgb(255, 255, 255)', body: 'rgb(240, 242, 245)' })
    run(page, createForceDarkScript(true))
    assert.match(page.css(), /^html\{[^}]*background:rgb\(11, 13, 16\) linear-gradient\(rgb\(240, 242, 245\),rgb\(240, 242, 245\)\)/)
    assert.match(page.css(), /body\{background-color:transparent !important;\}/)
  })

  test('a see-through body leaves the colour to the root, and a dark one on a light page is drawn white', () => {
    const clear = createPage({ content: 'rgb(255, 255, 255)', body: 'rgba(255, 255, 255, 0.6)', root: 'rgb(250, 250, 250)' })
    run(clear, createForceDarkScript(true))
    assert.match(clear.css(), /background:rgb\(5, 5, 5\) linear-gradient\(rgb\(250, 250, 250\),rgb\(250, 250, 250\)\)/)

    // Drawn dark under the filter, it would come out light.
    const dark = createPage({ content: 'rgb(255, 255, 255)', body: 'rgb(20, 20, 20)' })
    run(dark, createForceDarkScript(true))
    assert.match(dark.css(), /background:rgb\(0, 0, 0\) linear-gradient\(rgb\(255, 255, 255\),rgb\(255, 255, 255\)\)/)
  })

  test('a page that moves to another light colour is drawn in it', () => {
    const page = createPage({ content: 'rgb(255, 255, 255)' })
    run(page, createForceDarkScript(true))
    assert.match(page.css(), /linear-gradient\(rgb\(255, 255, 255\)/)

    page.body.backgroundColor = 'rgb(250, 250, 250)'
    page.mutate()
    assert.match(page.css(), /background:rgb\(5, 5, 5\) linear-gradient\(rgb\(250, 250, 250\)/)
    assert.equal(page.sheetDisabled(), false)
  })

  // The root reads dark while the rule is on. Read back that way, a light
  // page whose colour comes from its root would look dark and lose the rule.
  test('a light page painted by its root stays inverted when looked at again', () => {
    const page = createPage({ hit: 'VIDEO' })
    run(page, createForceDarkScript(true))
    assert.equal(page.inverted(), true)

    page.mutate()
    page.runTimers()
    assert.equal(page.inverted(), true)
  })

  // DuckDuckGo draws its menu, search and tick icons in the text's colour.
  // Turned back like a picture, they stayed dark on the darkened page. Its
  // logo has colours of its own, and the wordmark in it the text's.
  test('icons drawn only in the text\'s colour go with the text, drawings with their own colours are turned back', () => {
    const page = createPage({ content: 'rgb(255, 255, 255)' })
    run(page, createForceDarkScript(true))
    const textColoured = '[fill="currentColor" i],[stroke="currentColor" i]'
    const ownColours = '[fill]:not([fill="currentColor" i],[fill="none" i]),[stroke]:not([stroke="currentColor" i],[stroke="none" i])'
    assert.ok(page.css().endsWith(
      `svg:is(${textColoured},:has(${textColoured})):not(:has(${ownColours})){filter:none !important;}`
    ), page.css())
  })
})
