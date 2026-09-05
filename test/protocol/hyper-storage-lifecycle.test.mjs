import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  removeHyperStoragePaths,
  runP2pAppDataDelete,
  runP2pCacheClear,
  runP2pDataClear
} from '../../backend/hyper/storage-lifecycle.mjs'

test('full P2P storage removal deletes public and private runtime paths', () => {
  const removed = []

  removeHyperStoragePaths({
    storagePath: '/test/hyper-sdk',
    privateStoragePath: '/test/hyper-sdk-private',
    removeStorage: (path) => { removed.push(path) }
  })

  assert.deepEqual(removed, [
    '/test/hyper-sdk',
    '/test/hyper-sdk-private'
  ])
})

test('warns that clearing all P2P data permanently loses signing keys', () => {
  const source = readFileSync(new URL('../../app/settings/P2PStorage.tsx', import.meta.url), 'utf8')
  assert.match(source, /permanently removes[\s\S]*signing keys/)
  assert.match(source, /PeerChat rooms and message history/)
  assert.match(source, /permanently lose the ability to update previously shared Hyper URLs/)
  assert.match(source, /leaving them frozen/)
})

test('explains that clearing downloaded P2P cache retains PeerChat history', () => {
  const source = readFileSync(new URL('../../app/settings/P2PStorage.tsx', import.meta.url), 'utf8')
  assert.match(source, /Clear downloaded P2P cache[\s\S]*PeerChat rooms[\s\S]*message history are kept/)
})

test('cache clear closes storage and reopens the runtime in order', async () => {
  const events = []
  let runtimeCalls = 0
  const result = await runP2pCacheClear({
    getRuntime: async () => { events.push(`runtime-${++runtimeCalls}`) },
    storagePath: '/test/storage',
    stopAssetServer: async () => { events.push('asset-stop') },
    closeServices: async () => { events.push('services-close') },
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
    'services-close',
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

test('cache clear reopens the runtime when a P2P service fails to close', async () => {
  let runtimeCalls = 0

  await assert.rejects(runP2pCacheClear({
    getRuntime: async () => { runtimeCalls += 1 },
    storagePath: '/test/storage',
    stopAssetServer: async () => {},
    closeServices: async () => { throw new Error('PeerChat close failed') },
    closeRuntime: async () => {},
    resetFetch: () => {},
    createStore: () => ({
      ready: async () => {},
      close: async () => {}
    }),
    clearStore: async () => ({ ok: true })
  }), /PeerChat close failed/)

  assert.equal(runtimeCalls, 2)
})

test('cache clear reports archive cleanup failure without hiding successful deletion', async () => {
  const result = await runP2pCacheClear({
    getRuntime: async () => {},
    storagePath: '/test/storage',
    stopAssetServer: async () => {},
    closeRuntime: async () => {},
    resetFetch: () => {},
    createStore: () => ({
      ready: async () => {},
      close: async () => {}
    }),
    clearStore: async () => ({ ok: true, clearedCores: 2 }),
    removeArchive: async () => { throw new Error('archive locked') }
  })

  assert.equal(result.ok, true)
  assert.equal(result.clearedCores, 2)
  assert.match(result.warning, /archive metadata could not be removed[.] archive locked/)
})

test('full P2P clear removes storage and archive before reopening the runtime', async () => {
  const events = []
  let runtimeCalls = 0
  const result = await runP2pDataClear({
    getRuntime: async () => { events.push(`runtime-${++runtimeCalls}`) },
    getStoragePath: () => '/test/storage',
    stopAssetServer: async () => { events.push('asset-stop') },
    closeServices: async () => { events.push('services-close') },
    closeRuntime: async () => { events.push('runtime-close') },
    resetFetch: () => { events.push('fetch-reset') },
    removeStorage: (path) => { events.push(`storage-remove:${path}`) },
    clearArchive: async (path) => { events.push(`archive-clear:${path}`) }
  })

  assert.deepEqual(result, { ok: true, cleared: true })
  assert.deepEqual(events, [
    'runtime-1',
    'asset-stop',
    'services-close',
    'runtime-close',
    'fetch-reset',
    'storage-remove:/test/storage',
    'archive-clear:/test/storage',
    'runtime-2'
  ])
})

test('full P2P clear still reopens the runtime after deletion fails', async () => {
  let runtimeCalls = 0

  await assert.rejects(runP2pDataClear({
    getRuntime: async () => { runtimeCalls += 1 },
    getStoragePath: () => '/test/storage',
    stopAssetServer: async () => {},
    closeRuntime: async () => {},
    resetFetch: () => {},
    removeStorage: () => { throw new Error('delete failed') },
    clearArchive: async () => {}
  }), /delete failed/)

  assert.equal(runtimeCalls, 2)
})

test('full P2P clear reopens the runtime when a P2P service fails to close', async () => {
  let runtimeCalls = 0

  await assert.rejects(runP2pDataClear({
    getRuntime: async () => { runtimeCalls += 1 },
    getStoragePath: () => '/test/storage',
    stopAssetServer: async () => {},
    closeServices: async () => { throw new Error('PeerChat close failed') },
    closeRuntime: async () => {},
    resetFetch: () => {},
    removeStorage: () => {},
    clearArchive: async () => {}
  }), /PeerChat close failed/)

  assert.equal(runtimeCalls, 2)
})

test('full P2P clear reports archive cleanup failure after deleting storage', async () => {
  const result = await runP2pDataClear({
    getRuntime: async () => {},
    getStoragePath: () => '/test/storage',
    stopAssetServer: async () => {},
    closeRuntime: async () => {},
    resetFetch: () => {},
    removeStorage: () => {},
    clearArchive: async () => { throw new Error('archive locked') }
  })

  assert.equal(result.ok, true)
  assert.equal(result.cleared, true)
  assert.match(result.warning, /archive metadata could not be removed[.] archive locked/)
})

test('app deletion and archive cleanup run inside one exclusive operation', async () => {
  const events = []
  const result = await runP2pAppDataDelete({
    runExclusive: async (task) => {
      events.push('exclusive-start')
      const value = await task()
      events.push('exclusive-end')
      return value
    },
    getRuntime: async () => {
      events.push('runtime')
      return { id: 'runtime' }
    },
    deleteAppData: async (runtime, { appId }) => {
      events.push(`delete:${runtime.id}:${appId}`)
      return { ok: true, deleted: true, appId }
    },
    removeArchive: async ({ appId }) => { events.push(`archive:${appId}`) },
    appId: 'hyperdrive'
  })

  assert.equal(result.ok, true)
  assert.deepEqual(events, [
    'exclusive-start',
    'runtime',
    'delete:runtime:hyperdrive',
    'archive:hyperdrive',
    'exclusive-end'
  ])
})

test('app deletion preserves success when archive cleanup fails', async () => {
  const result = await runP2pAppDataDelete({
    runExclusive: async (task) => task(),
    getRuntime: async () => ({}),
    deleteAppData: async () => ({ ok: true, deleted: true, appId: 'p2pmd' }),
    removeArchive: async () => { throw new Error('archive locked') },
    appId: 'p2pmd'
  })

  assert.equal(result.ok, true)
  assert.equal(result.deleted, true)
  assert.match(result.warning, /archive metadata could not be removed[.] archive locked/)
})

test('app deletion treats an unpersisted archive cleanup as a warning', async () => {
  const result = await runP2pAppDataDelete({
    runExclusive: async (task) => task(),
    getRuntime: async () => ({}),
    deleteAppData: async () => ({ ok: true, deleted: true, appId: 'hyperdrive' }),
    removeArchive: async () => false,
    appId: 'hyperdrive'
  })

  assert.equal(result.ok, true)
  assert.equal(result.deleted, true)
  assert.match(result.warning, /cleanup was not persisted/)
})
