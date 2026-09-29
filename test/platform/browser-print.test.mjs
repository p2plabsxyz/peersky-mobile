import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import {
  canPrintBrowserUrl,
  createBrowserPrintScript,
  parseBrowserPrintMessage,
  withPrintBaseHref
} from '../../app/browser-print.mjs'

describe('printing a page', () => {
  test('anything with a document, which is not our own screens', () => {
    assert.equal(canPrintBrowserUrl('https://example.com/article'), true)
    assert.equal(canPrintBrowserUrl('hyper://abc123/index.html'), true)
    assert.equal(canPrintBrowserUrl('peersky://home'), false)
    assert.equal(canPrintBrowserUrl(''), false)
  })

  test('the reply only counts when it carries the tab its own token', () => {
    const message = JSON.stringify({
      type: 'peersky-print-page',
      token: 'abc123',
      html: '<html><body>Hello</body></html>'
    })

    assert.match(parseBrowserPrintMessage(message, 'abc123'), /Hello/)
    // A page can post anything it likes, so an unsigned one prints nothing.
    assert.equal(parseBrowserPrintMessage(message, 'other'), null)
    assert.equal(parseBrowserPrintMessage(message, ''), null)
    assert.equal(parseBrowserPrintMessage('not json', 'abc123'), null)
    assert.equal(
      parseBrowserPrintMessage(JSON.stringify({ type: 'peersky-print-page', token: 'abc123' }), 'abc123'),
      null
    )
  })

  test('relative assets keep working in the printout', () => {
    const html = withPrintBaseHref('<html><head><title>x</title></head></html>', 'https://example.com/a/b')

    // Without this the renderer resolves every stylesheet and image against
    // nowhere, and the printout comes out unstyled.
    assert.match(html, /<head><base href="https:\/\/example\.com\/a\/b" \/>/)
    // A page that sets its own base keeps it.
    assert.equal(
      withPrintBaseHref('<html><head><base href="/x"></head></html>', 'https://example.com'),
      '<html><head><base href="/x"></head></html>'
    )
    assert.match(withPrintBaseHref('<p>bare</p>', 'https://example.com/?a=1&b=2'), /a=1&amp;b=2/)
  })

  test('the page is asked for its markup, not handed to a PDF printer', async () => {
    const wrapper = await readFile(new URL('../../app/browser-print.ts', import.meta.url), 'utf8')

    // expo-print's uri option takes a PDF and nothing else, so a web address
    // hands it a file it cannot read and the dialog never opens.
    assert.match(wrapper, /printAsync\(\{ html: withPrintBaseHref\(html, pageUrl\) \}\)/)
    assert.doesNotMatch(wrapper, /printAsync\(\{ uri/)
    assert.match(createBrowserPrintScript('abc'), /document\.documentElement\.outerHTML/)
  })
})
