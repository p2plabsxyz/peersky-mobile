import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { clearBrowserWebViewData } from '../../app/browser-data.mjs'

describe('browser data clearing', () => {
  test('clears memory and disk cache on every supported platform', () => {
    const calls = []
    const webView = {
      clearCache: (includeDiskFiles) => calls.push(['clearCache', includeDiskFiles]),
      clearHistory: () => calls.push(['clearHistory']),
      stopLoading: () => calls.push(['stopLoading'])
    }

    assert.equal(clearBrowserWebViewData(webView), true)
    assert.deepEqual(calls, [
      ['stopLoading'],
      ['clearCache', true]
    ])
  })

  test('reports when no WebView cache API is available', () => {
    assert.equal(clearBrowserWebViewData(null), false)
    assert.equal(clearBrowserWebViewData({}), false)
  })
})
