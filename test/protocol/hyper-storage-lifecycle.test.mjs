import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runP2pCacheClear } from '../../backend/hyper/storage-lifecycle.mjs'

test('cache clear closes storage and reopens the runtime in order', async () => {
  const events = []
  let runtimeCalls = 0
  const result = await runP2pCacheClear({
    getRuntime: async () => { events.push(`runtime-${++runtimeCalls}`) },
    storagePath: '/test/storage',
    stopAssetServer: async () => { events.push('asset-stop') },
    closeRuntime: async () => { events.push('runtime-close') },
    resetFetch: () => { events.push('fetch-reset') },
    createStore: () => ({
      ready: async () => { events.push('store-ready') },
      close: async () => { events.push('store-close') }
    }),
    clearStore: async () => ({ ok: true })
  })

  assert.equal(result.ok, true)
  assert.deepEqual(events, [
    'runtime-1',
    'asset-stop',
    'runtime-close',
    'fetch-reset',
    'store-ready',
    'store-close',
    'runtime-2'
  ])
})

test('cache clear still reopens the runtime after a storage failure', async () => {
  let runtimeCalls = 0

  await assert.rejects(runP2pCacheClear({
    getRuntime: async () => { runtimeCalls += 1 },
    storagePath: '/test/storage',
    stopAssetServer: async () => {},
    closeRuntime: async () => {},
    resetFetch: () => {},
    createStore: () => ({
      ready: async () => { throw new Error('storage failed') },
      close: async () => {}
    }),
    clearStore: async () => ({ ok: true })
  }), /storage failed/)

  assert.equal(runtimeCalls, 2)
})
