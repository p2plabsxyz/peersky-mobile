import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createBrowserErrorHtml, createHyperBrowserHtml } from '../../app/browser-html.mjs'

describe('pages the browser builds itself', () => {
  test('they follow the app, not the system', () => {
    // prefers-color-scheme follows the device, and the app has its own theme
    // setting that can disagree with it, so a failed page came out white
    // inside chrome that was dark.
    const dark = createBrowserErrorHtml('hyper://example/', 'Not Found', true)
    const light = createBrowserErrorHtml('hyper://example/', 'Not Found', false)

    assert.match(dark, /background: #18181b/)
    assert.match(dark, /color: #e7eaf0/)
    assert.match(light, /background: #ffffff/)
    assert.match(light, /color: #151821/)
    assert.doesNotMatch(dark, /prefers-color-scheme/)
  })

  test('the engine paints its own furniture to match', () => {
    // Scrollbars and form controls come from the engine, and stay light over a
    // dark page without this.
    assert.match(createBrowserErrorHtml('x', 'y', true), /color-scheme: dark/)
    assert.match(createBrowserErrorHtml('x', 'y', false), /color-scheme: light/)
  })

  test('raw text and directory listings get the same treatment', () => {
    const response = { body: 'plain text', headers: { 'content-type': 'text/plain' } }
    const listing = {
      body: JSON.stringify(['a.txt', 'b.txt']),
      headers: { 'content-type': 'application/json' }
    }

    assert.match(createHyperBrowserHtml(response, 'hyper://example/', true), /background: #18181b/)
    assert.match(createHyperBrowserHtml(listing, 'hyper://example/', true), /background: #18181b/)
    assert.match(createHyperBrowserHtml(listing, 'hyper://example/', false), /background: #ffffff/)
  })
})
