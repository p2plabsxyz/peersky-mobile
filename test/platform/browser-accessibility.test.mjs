import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import vm from 'node:vm'
import { createBrowserAccessibilityScript } from '../../app/browser-accessibility.mjs'

// Enough of a page to run the script in: its root, its head once the page has
// one, and the viewport tags in the order they sit in the document.
function createPage ({ head = true, viewport = null } = {}) {
  const metas = []
  const createMeta = () => {
    const attributes = new Map()
    return {
      tagName: 'META',
      setAttribute (name, value) { attributes.set(name, String(value)) },
      getAttribute (name) { return attributes.has(name) ? attributes.get(name) : null },
      hasAttribute (name) { return attributes.has(name) }
    }
  }
  const parentOf = (name) => ({
    name,
    appendChild (child) {
      child.parent = name
      metas.push(child)
      return child
    }
  })
  const document = {
    documentElement: { ...parentOf('root'), style: { setProperty () {} } },
    head: head ? parentOf('head') : null,
    createElement: () => createMeta(),
    querySelectorAll: (selector) => selector === 'meta[name="viewport"]'
      ? metas.filter((meta) => meta.getAttribute('name') === 'viewport')
      : []
  }
  const page = {
    metas,
    context: vm.createContext({
      document,
      window: { innerWidth: 390, screen: { width: 390 }, addEventListener () {} },
      setTimeout: () => 0
    }),
    // The page's own tag, read once the parser reaches its head.
    readHead (content) {
      if (!document.head) document.head = parentOf('head')
      const meta = createMeta()
      meta.setAttribute('name', 'viewport')
      meta.setAttribute('content', content)
      document.head.appendChild(meta)
      return meta
    }
  }
  if (viewport !== null) page.readHead(viewport)
  return page
}

const run = (page, options) => vm.runInContext(createBrowserAccessibilityScript({
  applyTextScale: false,
  enforceManualPageZoom: false,
  websiteTextScale: 100,
  ...options
}), page.context)

describe('browser accessibility', () => {
  test('creates a script with validated text scaling and zoom enforcement', () => {
    const script = createBrowserAccessibilityScript({
      applyTextScale: true,
      enforceManualPageZoom: true,
      pageZoom: 125,
      websiteTextScale: 120
    })

    assert.match(script, /-webkit-text-size-adjust', '150%'/)
    assert.match(script, /user-scalable=yes/)
    assert.match(script, /maximum-scale=5/)
    assert.match(script, /\^\(user-scalable\|maximum-scale\)/)
    assert.doesNotMatch(script, /\^\(width\|initial-scale/)
  })

  test('falls back to safe values for unsupported input', () => {
    const script = createBrowserAccessibilityScript({
      applyTextScale: 'yes',
      enforceManualPageZoom: 'yes',
      pageZoom: 999,
      websiteTextScale: '100%); alert(1)'
    })

    assert.match(script, /-webkit-text-size-adjust', '100%'/)
    assert.doesNotMatch(script, /alert/)
    assert.match(script, /if \(false\)/)
  })

  // Safari and Chrome lay a page with no viewport tag out 980 px wide and zoom
  // out to fit. PeerSky gave every such page a tag of its own at the phone's
  // width, so a desktop page was cut off at the right.
  test('a page with no viewport tag keeps the browser\'s own wide layout', () => {
    const page = createPage()
    run(page)
    assert.equal(page.metas.length, 0)

    // Zoom let through needs no tag either: such a page always zooms.
    const zoomed = createPage()
    run(zoomed, { enforceManualPageZoom: true })
    assert.equal(zoomed.metas.length, 0)

    assert.doesNotMatch(createBrowserAccessibilityScript({ enforceManualPageZoom: true }), /width=device-width/)
  })

  // The script runs as the page starts too, before it has a head. Every page
  // logged "null is not an object (evaluating 'document.head.appendChild')".
  test('it runs before the page has a head without failing', () => {
    for (const options of [{}, { enforceManualPageZoom: true }, { desktopView: true }, { desktopView: true, enforceManualPageZoom: true }]) {
      const page = createPage({ head: false })
      assert.doesNotThrow(() => run(page, options), JSON.stringify(options))
    }

    const desktop = createPage({ head: false })
    run(desktop, { desktopView: true })
    assert.equal(desktop.metas.length, 1)
    assert.equal(desktop.metas[0].parent, 'root')
    assert.match(desktop.metas[0].getAttribute('content'), /^width=1024, initial-scale=0\.381, minimum-scale=0\.381, user-scalable=yes$/)
  })

  test('Desktop View changes the page\'s own tag once it is read, and keeps the rest of it', () => {
    const page = createPage({ head: false })
    run(page, { desktopView: true })
    const own = page.readHead('width=device-width, initial-scale=1, viewport-fit=cover')
    run(page, { desktopView: true })

    assert.equal(own.getAttribute('content'), 'viewport-fit=cover, width=1024, initial-scale=0.381, minimum-scale=0.381, user-scalable=yes')
    assert.equal(own.getAttribute('data-peersky-original-content'), 'width=device-width, initial-scale=1, viewport-fit=cover')
  })

  test('zoom let through lifts only the page\'s limits', () => {
    const page = createPage({ viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' })
    run(page, { enforceManualPageZoom: true })
    assert.equal(page.metas.length, 1)
    assert.equal(page.metas[0].getAttribute('content'), 'width=device-width, initial-scale=1, user-scalable=yes, maximum-scale=5')

    // And put back as the page wrote it once it is off.
    run(page, { enforceManualPageZoom: false })
    assert.equal(page.metas[0].getAttribute('content'), 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')

    // A page that sets no limits has nothing to lift, and keeps its width.
    const fixed = createPage({ viewport: 'width=600' })
    run(fixed, { enforceManualPageZoom: true })
    assert.equal(fixed.metas[0].getAttribute('content'), 'width=600, user-scalable=yes, maximum-scale=5')
  })

  test('restores the original viewport when zoom enforcement is disabled', () => {
    const script = createBrowserAccessibilityScript({
      applyTextScale: false,
      enforceManualPageZoom: false,
      websiteTextScale: 100
    })

    assert.match(script, /viewport\.hasAttribute\(marker\)/)
    assert.match(script, /viewport\.setAttribute\('content', viewport\.getAttribute\(marker\) \|\| ''\)/)
    assert.doesNotMatch(script, /viewport\.remove\(\)/)
  })

  test('can request a desktop-width viewport', () => {
    const script = createBrowserAccessibilityScript({
      applyTextScale: false,
      desktopView: true,
      enforceManualPageZoom: false,
      websiteTextScale: 100
    })

    assert.match(script, /width=1024/)
    assert.match(script, /initial-scale=/)
    assert.match(script, /minimum-scale=/)
    assert.match(script, /window\.screen/)
    assert.match(script, /\^\(width\|initial-scale\|minimum-scale\|user-scalable\|maximum-scale\)/)
  })

  // A zoom change sent the tab the script without its Desktop View, which put
  // a desktop page back to the phone's width until it was loaded again.
  test('a zoom change keeps the tab\'s Desktop View', async () => {
    const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    const zoom = /function updateActiveBrowserZoom[\s\S]*?\n {2}\}\n/.exec(app)?.[0] || ''
    assert.match(zoom, /createBrowserAccessibilityScript\(\{[^}]*desktopView: activeTab\?\.desktopView === true/)
  })
})
