import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  clearBrowserDiagnostics,
  createBrowserAnalysis,
  recordBrowserDiagnostic
} from '../../app/browser-diagnostics.mjs'

describe('browser diagnostics', () => {
  test('bounds events and redacts URL tokens and sensitive fields', () => {
    clearBrowserDiagnostics()
    for (let index = 0; index < 105; index += 1) {
      recordBrowserDiagnostic('downloads', 'state', {
        authorization: 'Bearer secret',
        url: `http://127.0.0.1/asset?token=secret&url=${encodeURIComponent('hyper://example.com/file.pdf')}`,
        index
      })
    }

    const analysis = createBrowserAnalysis({ platform: 'android' })
    assert.equal(analysis.events.length, 100)
    assert.equal(analysis.events[0].details.index, 5)
    assert.equal(analysis.events[0].details.authorization, '<redacted>')
    assert.equal(new URL(analysis.events[0].details.url).searchParams.get('token'), '<redacted>')
  })
})
