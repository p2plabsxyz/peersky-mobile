import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  createBrowserErrorHtml,
  createHyperBrowserHtml
} from '../../app/browser-html.mjs'

describe('browser HTML helpers', () => {
  test('preserves HTML responses while ensuring a mobile viewport', () => {
    const html = '<html><head><title>Site</title></head><body>Page</body></html>'
    const rendered = createHyperBrowserHtml({
      body: html,
      headers: { 'content-type': 'text/html' }
    }, 'hyper://site/')

    assert.match(rendered, /<head><meta name="viewport"/)
    assert.match(rendered, /<body>Page<\/body>/)

    const withViewport = '<meta name="viewport" content="width=device-width"><p>Page</p>'
    assert.equal(createHyperBrowserHtml({
      body: withViewport,
      headers: { 'content-type': 'text/html' }
    }, 'hyper://site/'), withViewport)
  })

  test('renders escaped Hyper directory entries with child URLs', () => {
    const rendered = createHyperBrowserHtml({
      body: JSON.stringify(['notes.md', '<unsafe>.txt', '`quote`.txt']),
      headers: { 'content-type': 'application/json' }
    }, 'hyper://site/folder/')

    assert.match(rendered, /href="hyper:\/\/site\/folder\/notes[.]md"/)
    assert.match(rendered, /&lt;unsafe&gt;[.]txt/)
    assert.match(rendered, /href="hyper:\/\/site\/folder\/&#96;quote&#96;[.]txt"/)
  })

  test('falls back to an escaped document for invalid directory data', () => {
    const rendered = createHyperBrowserHtml({
      body: '{<script>alert(1)</script>',
      headers: { 'content-type': 'application/json' }
    }, 'hyper://site/')

    assert.doesNotMatch(rendered, /<script>/)
    assert.match(rendered, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })

  test('escapes URLs and messages in browser error documents', () => {
    const rendered = createBrowserErrorHtml(
      'hyper://site/<path>',
      '<img src=x onerror=alert(1)>'
    )

    assert.match(rendered, /hyper:\/\/site\/&lt;path&gt;/)
    assert.match(rendered, /&lt;img src=x onerror=alert\(1\)&gt;/)
    assert.doesNotMatch(rendered, /<img src=x/)
  })

  test('builds child URLs without dropping directory paths', () => {
    const rendered = createHyperBrowserHtml({
      body: JSON.stringify(['file.txt', '/root.txt']),
      headers: { 'content-type': 'application/json' }
    }, 'hyper://site/folder')

    assert.match(rendered, /href="hyper:\/\/site\/folder\/file[.]txt"/)
    assert.match(rendered, /href="hyper:\/\/site\/root[.]txt"/)
  })
})
