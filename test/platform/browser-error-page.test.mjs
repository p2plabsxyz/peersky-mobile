import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createBrowserErrorHtml } from '../../app/browser-html.mjs'
import { describeBrowserError } from '../../app/browser-error-copy.mjs'
import { SAD_BIRD_DATA_URI } from '../../app/browser-error-art.mjs'

describe('a page that would not load', () => {
  test('it says what happened, not what the status code was', () => {
    // "Page failed" over a raw error string is a status line, not a sentence.
    assert.equal(describeBrowserError('https://www.example.com/a', 'Not Found').title, 'This page is missing')
    assert.equal(describeBrowserError('https://example.com', 'HTTP 503').title, 'This site is having trouble')
    assert.equal(describeBrowserError('https://example.com', 'Request timed out').title, 'This site took too long')
    assert.equal(describeBrowserError('https://example.com', '401 Unauthorized').title, 'This page is not open to you')
    assert.equal(describeBrowserError('https://example.com', 'socket hang up').title, 'This page would not load')
  })

  test('it names the site the way somebody would say it', () => {
    assert.match(describeBrowserError('https://www.example.com/deep/path', 'Not Found').body, /^example\.com answered/)
    // A peer address is a key, and nobody recognises sixty four characters of
    // hex, so those describe themselves instead.
    const key = `hyper://${'a'.repeat(64)}/`
    assert.doesNotMatch(describeBrowserError(key, 'Not Found').body, /aaaa/)
    // Said at the start of a sentence, it starts with a capital, and it says
    // what a key is rather than repeating "this address".
    assert.match(describeBrowserError(key, 'Not Found').body, /^This drive answered, but there is nothing at this address\./)
    assert.match(describeBrowserError(key, 'Request timed out').body, /^This drive did not answer in time\./)
    // The same kind of key in z-base-32, the way the desktop and most links
    // write it. It used to land in the sentence whole.
    const z32 = 'hyper://smhy768hq9d4kyznaeff97ogsz8arswo1crpdubnpfgjxkpqdjjo/map.htm'
    assert.match(describeBrowserError(z32, 'Not Found').body, /^This drive answered, but there is nothing at this address\./)
  })

  // A name with no spaces in it, like an IPFS address, is wider than a phone.
  // Without a wrap the sentence ran off both edges of the screen.
  test('a long name in the sentence wraps instead of running off the screen', () => {
    const html = createBrowserErrorHtml(`ipfs://${'b'.repeat(59)}/`, 'socket hang up')
    assert.match(html, /\.lead \{[^}]*overflow-wrap: anywhere;/)
  })

  // The two blocks WebKit names. The first is the device's own filter, which
  // a user took for a PeerSky fault, so the page says where it is set.
  test('a page the device or tracker protection blocked says which one', () => {
    const filtered = describeBrowserError('https://www.example.com/watch', 'The URL was blocked by a content filter')
    assert.equal(filtered.title, 'This device blocked this page')
    assert.match(filtered.body, /^A content filter on this device stopped example\.com/)
    assert.match(filtered.body, /Settings, Screen Time, Content & Privacy Restrictions/)

    const blocked = describeBrowserError('https://ads.example.com/', 'The URL was blocked by a content blocker')
    assert.equal(blocked.title, 'Tracker protection blocked this page')
    assert.match(blocked.body, /Settings, Privacy/)
  })

  test('a peer address that nobody is seeding says so', () => {
    const { title, body } = describeBrowserError(`hyper://${'b'.repeat(64)}/`, 'No peers found')

    assert.equal(title, 'Nobody is sharing this yet')
    assert.match(body, /as soon as one is/)
  })

  test('the page carries the bird and hides the technical detail', () => {
    const html = createBrowserErrorHtml('https://example.com/a', 'Not Found', true)

    assert.match(html, /This page is missing/)
    assert.ok(html.includes(SAD_BIRD_DATA_URI), 'the picture travels inside the page')
    // Still there for whoever needs it, behind one tap.
    assert.match(html, /<details><summary>What went wrong<\/summary><pre>Not Found<\/pre><\/details>/)
    assert.doesNotMatch(html, /Page failed/)
  })

  test('no detail means no empty disclosure', () => {
    assert.doesNotMatch(createBrowserErrorHtml('https://example.com', '', false), /<details>/)
  })

  test('the picture is small enough to inline on every failure', () => {
    // It is embedded in the page itself, because the error HTML is handed to
    // the WebView with no address to resolve a file against.
    assert.ok(SAD_BIRD_DATA_URI.startsWith('data:image/png;base64,'))
    assert.ok(SAD_BIRD_DATA_URI.length < 90 * 1024, `art is ${Math.round(SAD_BIRD_DATA_URI.length / 1024)}KB`)
  })
})

describe('the sad bird', () => {
  test('the drawing is the source, and it is in the repo', async () => {
    const { access, readFile } = await import('node:fs/promises')
    const script = await readFile(new URL('../../scripts/generate-sad-bird.mjs', import.meta.url), 'utf8')

    // The badge with the eye drawn shut. Redraw it, rerun the script, and the
    // background comes off and the tear goes on again.
    await access(new URL('../../assets/app-icons/sad-bird-source.png', import.meta.url))
    assert.match(script, /assets\/app-icons\/sad-bird-source\.png/)
    assert.match(script, /if \(usingBadge\) removeBackground\(image\)/)
    // Its eye is already shut, so nothing redraws it.
    assert.match(script, /if \(!usingBadge\) closeEye\(image, box\)/)
  })

  test('the background comes off in rings, so the outline survives', async () => {
    const { readFile } = await import('node:fs/promises')
    const script = await readFile(new URL('../../scripts/generate-sad-bird.mjs', import.meta.url), 'utf8')

    // One flood that could cross black would reach the bird's own outline
    // through the ring and eat it. Outside, then ring, then colour, once each.
    const removal = script.slice(script.indexOf('function removeBackground'))
    const order = ['isClear(i) || isPale(i)', 'flood(isInk)', 'isBadge(i) || isPale(i)']
    let at = 0
    for (const step of order) {
      const next = removal.indexOf(step, at)
      assert.ok(next > at, `${step} must come after the step before it`)
      at = next
    }
  })

  test('the bird arrives transparent and square', async () => {
    const { PNG } = await import('pngjs')
    const { SAD_BIRD_DATA_URI } = await import('../../app/browser-error-art.mjs')
    const image = PNG.sync.read(Buffer.from(SAD_BIRD_DATA_URI.split(',')[1], 'base64'))

    assert.equal(image.width, image.height)
    // Every corner clear: no badge, no ring, no white box behind it.
    for (const [x, y] of [[0, 0], [image.width - 1, 0], [0, image.height - 1], [image.width - 1, image.height - 1]]) {
      assert.equal(image.data[(y * image.width + x) * 4 + 3], 0, `corner ${x},${y} is not transparent`)
    }
  })
})
