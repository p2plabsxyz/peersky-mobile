import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_HYPER_DISCOVERY_RETRIES,
  isPeerDiscoveryError,
  withHyperRetry
} from '../../backend/hyper/fetch-retry.mjs'

describe('production Hyper fetch discovery retries', () => {
  it('enables bounded discovery retries by default', () => {
    assert.equal(DEFAULT_HYPER_DISCOVERY_RETRIES, 5)
  })

  it('retries a delayed peer until the Hyperdrive is available', async () => {
    let attempts = 0
    const result = await runWithRetry(async () => {
      attempts++
      if (attempts < 3) return errorResponse(404, 'Peers Not Found')
      return successResponse(new Uint8Array([104, 101, 108, 108, 111]))
    }, {
      retries: 4,
      retryDelay: 0,
      maxRetryDelay: 0
    })

    assert.equal(attempts, 3)
    assert.equal(result.ok, true)
    assert.equal(result.bytes.byteLength, 5)
  })

  it('stops retrying when the discovery budget is exhausted', async () => {
    let attempts = 0
    const result = await runWithRetry(async () => {
      attempts++
      return errorResponse(404, 'Peers Not Found')
    }, {
      retries: 2,
      retryDelay: 0,
      maxRetryDelay: 0
    })

    assert.equal(attempts, 3)
    assert.equal(result.ok, false)
    assert.equal(result.status, 404)
    assert.equal(result.error, 'Peers Not Found')
  })

  it('does not retry a genuine missing-file response', async () => {
    let attempts = 0
    const result = await runWithRetry(async () => {
      attempts++
      return errorResponse(404, 'File not found: /missing.html')
    }, {
      retries: 4,
      retryDelay: 0,
      maxRetryDelay: 0
    })

    assert.equal(attempts, 1)
    assert.equal(result.ok, false)
    assert.equal(result.status, 404)
  })

  it('recognizes both Hyper fetch peer-discovery messages', () => {
    assert.equal(isPeerDiscoveryError('Peers Not Found'), true)
    assert.equal(isPeerDiscoveryError(
      'Could not find data in drive, make sure your key is correct and that there are peers online to load data from'
    ), true)
    assert.equal(isPeerDiscoveryError('PeerSky request configuration failed'), false)
  })

  it('does not retry unrelated thrown errors containing peer', async () => {
    let attempts = 0
    const result = await runWithRetry(async () => {
      attempts++
      throw new Error('PeerSky request configuration failed')
    }, {
      retries: 2,
      retryDelay: 0,
      maxRetryDelay: 0
    })

    assert.equal(attempts, 1)
    assert.equal(result.ok, false)
    assert.equal(result.error, 'PeerSky request configuration failed')
  })
})

function runWithRetry (fetch, options) {
  return withHyperRetry({
    fetch,
    url: 'hyper://test-drive/index.html',
    backoffFactor: 2,
    readResponse: async (response) => ({
      ok: true,
      status: response.status,
      bytes: await response.bytes()
    }),
    ...options
  })
}

function errorResponse (status, body) {
  return {
    ok: false,
    status,
    statusText: status === 404 ? 'Not Found' : 'Bad Gateway',
    url: 'hyper://test-drive/index.html',
    headers: new Map(),
    text: async () => body
  }
}

function successResponse (bytes) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url: 'hyper://test-drive/index.html',
    headers: new Map(),
    bytes: async () => bytes
  }
}
