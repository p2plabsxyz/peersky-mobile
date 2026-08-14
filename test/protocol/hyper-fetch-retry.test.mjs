import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

async function fetchWithRetry (fetchFn, {
  url,
  retries = 0,
  retryDelay = 500,
  maxRetryDelay = 5000,
  backoffFactor = 2
} = {}) {
  let attempt = 0
  let currentDelay = retryDelay

  while (true) {
    try {
      const response = await fetchFn(url)
      if (!response.ok) {
        const text = typeof response.text === 'function' ? await response.text() : ''
        const isRetryable = response.status === 404 || response.status === 502 || isPeerDiscoveryError(text)
        if (isRetryable && attempt < retries) {
          attempt++
          await new Promise((resolve) => setTimeout(resolve, currentDelay))
          currentDelay = Math.min(maxRetryDelay, Math.floor(currentDelay * backoffFactor))
          continue
        }
        return { ok: false, status: response.status, error: text || response.statusText }
      }
      return { ok: true, status: response.status, bytes: await response.bytes() }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      const isRetryable = isPeerDiscoveryError(errorMsg)
      if (isRetryable && attempt < retries) {
        attempt++
        await new Promise((resolve) => setTimeout(resolve, currentDelay))
        currentDelay = Math.min(maxRetryDelay, Math.floor(currentDelay * backoffFactor))
        continue
      }
      return { ok: false, status: 502, error: errorMsg }
    }
  }
}

function isPeerDiscoveryError (message) {
  return /\bpeers?\s+not\s+found\b/i.test(message)
}

describe('hyper fetch exponential backoff retries', () => {
  it('retries on discovery error until success', async () => {
    let attempts = 0
    const mockFetch = async () => {
      attempts++
      if (attempts < 3) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'Peers Not Found'
        }
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        bytes: async () => new Uint8Array([104, 101, 108, 108, 111])
      }
    }

    const result = await fetchWithRetry(mockFetch, {
      url: 'hyper://test-hash/backup.zip',
      retries: 4,
      retryDelay: 10,
      maxRetryDelay: 50,
      backoffFactor: 2
    })

    assert.equal(attempts, 3)
    assert.equal(result.ok, true)
    assert.equal(result.bytes.byteLength, 5)
  })

  it('stops retrying when max retries exceeded', async () => {
    let attempts = 0
    const mockFetch = async () => {
      attempts++
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Peers Not Found'
      }
    }

    const result = await fetchWithRetry(mockFetch, {
      url: 'hyper://test-hash/backup.zip',
      retries: 2,
      retryDelay: 10,
      maxRetryDelay: 50,
      backoffFactor: 2
    })

    assert.equal(attempts, 3)
    assert.equal(result.ok, false)
    assert.equal(result.status, 404)
    assert.equal(result.error, 'Peers Not Found')
  })

  it('does not retry unrelated errors containing peer', async () => {
    let attempts = 0
    const result = await fetchWithRetry(async () => {
      attempts++
      throw new Error('PeerSky request configuration failed')
    }, {
      url: 'hyper://test-hash/file.txt',
      retries: 2,
      retryDelay: 1
    })

    assert.equal(attempts, 1)
    assert.equal(result.ok, false)
    assert.equal(result.error, 'PeerSky request configuration failed')
  })
})
