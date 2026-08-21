import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { connectWithPreferredLoopbackPort } from '../../backend/p2pmd/connect.mjs'

describe('p2pmd room connection', () => {
  it('prefers the host-advertised Holesail port', async () => {
    const calls = []
    const expected = { ok: true }

    const result = await connectWithPreferredLoopbackPort({
      key: 'hs://room',
      udp: false,
      log: false,
      connect: async (options) => {
        calls.push(options)
        return expected
      },
      getAvailablePort: async () => assert.fail('fallback port should not be requested')
    })

    assert.equal(result, expected)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].preferRemotePort, true)
    assert.equal(Object.hasOwn(calls[0], 'port'), false)
  })

  it('falls back to an available local port when the preferred port fails', async () => {
    const calls = []
    const expected = { ok: true }

    const result = await connectWithPreferredLoopbackPort({
      key: 'hs://room',
      udp: false,
      log: false,
      connect: async (options) => {
        calls.push(options)
        if (calls.length === 1) throw new Error('Port already in use')
        return expected
      },
      getAvailablePort: async () => 46703
    })

    assert.equal(result, expected)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].preferRemotePort, true)
    assert.equal(calls[1].port, 46703)
    assert.equal(Object.hasOwn(calls[1], 'preferRemotePort'), false)
  })

  it('falls back when Holesail returns an error result', async () => {
    const calls = []

    const result = await connectWithPreferredLoopbackPort({
      key: 'hs://room',
      udp: false,
      log: false,
      connect: async (options) => {
        calls.push(options)
        return calls.length === 1
          ? { ok: false, error: 'Preferred port unavailable' }
          : { ok: true }
      },
      getAvailablePort: async () => 46703
    })

    assert.equal(result.ok, true)
    assert.equal(calls.length, 2)
    assert.equal(calls[1].port, 46703)
  })
})
