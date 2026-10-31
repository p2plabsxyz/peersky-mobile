import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  runP2pAppDataDelete,
  runP2pCacheClear,
  runP2pDataClear,
  runP2pIdentityClear
} from '../../backend/hyper/storage-lifecycle.mjs'
import { listP2pResetTargets } from '../../backend/hyper/p2p-reset.mjs'
import { holdHyperStores, waitForHyperStores } from '../../backend/hyper/runtime.mjs'

const readSource = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

test('full P2P storage removal takes public, device-only, encrypted private and adopted stores', () => {
  const targets = listP2pResetTargets({
    identityPath: '/test',
    stores: ['/test/hyper-sdk', '/test/hyper-sdk-private', '/test/hyper-sdk-synced-private', '/test/hyper-sdk-adopted']
  })
  for (const store of ['/test/hyper-sdk', '/test/hyper-sdk-private', '/test/hyper-sdk-synced-private', '/test/hyper-sdk-adopted']) {
    assert.ok(targets.includes(store), store)
  }

  // The adopted store holds a desktop's private drives. It was left behind,
  // with nothing pointing at it any more.
  const storage = readSource('backend/hyper/storage.mjs')
  assert.match(storage, /syncedPrivatePath \? adoptedStoragePathFor\(syncedPrivatePath\) : null/)
})

test('full P2P storage removal lists a path shared by two stores once', () => {
  const targets = listP2pResetTargets({
    identityPath: '/test',
    stores: ['/test/hyper-sdk', '/test/hyper-sdk', '/test/hyper-sdk']
  })
  assert.equal(targets.filter((target) => target === '/test/hyper-sdk').length, 1)
})

test('warns that clearing all P2P data permanently loses signing keys', () => {
  const source = readFileSync(new URL('../../app/settings/P2PStorage.tsx', import.meta.url), 'utf8')
  assert.match(source, /permanently removes[\s\S]*signing keys/)
  assert.match(source, /PeerChat rooms and message history/)
  assert.match(source, /permanently lose the ability to update previously shared Hyper URLs/)
  assert.match(source, /leaving them frozen/)
})

// It takes this device's identity now, as the desktop's Reset P2P data does
// with identities, and says so in red before anyone taps it.
test('Clear all P2P data says in red that this device\'s identity and its links go, and what stays', () => {
  const screen = readSource('app/settings/P2PStorage.tsx')
  const row = screen.slice(screen.indexOf(">{t('Clear all P2P data')}</Text>"), screen.indexOf('onPress={confirmClearAllData}'))
  assert.match(row, /<Text style=\{\[styles\.dangerNote, isDark \? darkStyles\.dangerNote : null\]\}>\s*\{t\("This device's identity goes too/)
  assert.match(row, /this phone's links to your other devices in Link Device/)
  assert.match(row, /as they would with Remove my data from this phone/)
  assert.match(row, /tabs, bookmarks, history, downloads and settings stay/)
  assert.match(screen, /dangerNote: \{\s*color: '#bd3552'/)
  assert.match(screen, /dangerNote: \{\s*color: '#ff8278'/)

  const dialog = screen.slice(screen.indexOf('function confirmClearAllData'), screen.indexOf('async function clearAllData'))
  assert.match(dialog, /'Clear all P2P data and this device\\'s identity\?'/)
  assert.match(dialog, /This device\\'s identity goes too: your PeerChat profile and keys, the key your private files are encrypted with, and this phone\\'s links to your other devices/)
  assert.match(dialog, /Link Device forgets them and they stop syncing with this phone, as after Remove my data from this phone/)
  assert.match(dialog, /Your tabs, bookmarks, history, downloads and settings stay/)
  assert.match(dialog, /PeerSky needs a fresh start afterwards/)
})

// What is on screen belongs to the identity that goes, and PeerChat writes
// what it holds as it closes, so the restart screen goes up first, as for
// Remove my data from this phone.
test('Clear all P2P data asks for a fresh start, with the restart screen up before anything is removed', () => {
  // The steps are shared with the lock screen button, which clears without
  // asking.
  const clear = readSource('app/settings/clear-all-p2p-data.ts')
  assert.ok(clear.indexOf('onRestartRequired()') > 0)
  assert.ok(clear.indexOf('onRestartRequired()') < clear.indexOf('onCallRpc(RPC_HYPER_STORAGE_CLEAR_ALL)'))
  assert.match(clear, /if \(Platform\.OS === 'android'\) BackHandler\.exitApp\(\)/)
  assert.match(clear, /Close PeerSky and open it again to finish\./)
  const screen = readSource('app/settings/P2PStorage.tsx')
  const clearAll = screen.slice(screen.indexOf('async function clearAllData'), screen.indexOf('async function refreshArchive'))
  assert.match(clearAll, /await clearAllP2PData\(\{ onCallRpc, onRestartRequired \}\)/)
  // Nothing on the screen is updated after: it is gone by then.
  assert.doesNotMatch(clearAll + clear, /clearHyperdriveRecents|onP2pmdDataDeleted|refreshArchive\(\)/)

  const settings = readSource('app/settings/SettingsScreen.tsx')
  const page = settings.slice(settings.indexOf('<P2PStorage'), settings.indexOf('/>', settings.indexOf('<P2PStorage')))
  assert.match(page, /onRestartRequired=\{props\.onRestartRequired\}/)
})

// A clear holds the stores shut, closes PeerChat, then closes the store and
// removes its files. The store stayed open for a moment after PeerChat closed,
// and a PeerChat started then, by the chat screen asking for its rooms, read
// the files that were going and wrote them back once they had gone: on a
// phone, the cleared profile and every room came back.
test('a PeerChat asked for while the stores are held waits until they are let go', async () => {
  const release = holdHyperStores()
  let waited = false
  const waiting = waitForHyperStores().then(() => { waited = true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(waited, false)
  release()
  await waiting
  assert.equal(waited, true)

  const peerChat = readSource('backend/peerchat/runtime.mjs')
  assert.match(peerChat, /if \(serviceClosing\) await serviceClosing\s+(\/\/[^\n]*\n\s+)*if \(!service\) await waitForHyperStores\(\)\s+const generation = serviceGeneration/)
})

test('explains that clearing downloaded P2P cache retains PeerChat history', () => {
  const source = readFileSync(new URL('../../app/settings/P2PStorage.tsx', import.meta.url), 'utf8')
  assert.match(source, /Clear downloaded P2P cache[\s\S]*PeerChat rooms[\s\S]*message history are kept/)
})

test('P2P settings exposes offline folder status and lifecycle controls', () => {
  const source = readFileSync(new URL('../../app/settings/P2PStorage.tsx', import.meta.url), 'utf8')
  assert.match(source, /RPC_HYPER_OFFLINE_LIST/)
  assert.match(source, /RPC_HYPER_OFFLINE_PAUSE/)
  assert.match(source, /RPC_HYPER_OFFLINE_RESUME/)
  assert.match(source, /RPC_HYPER_OFFLINE_REMOVE/)
  assert.match(source, /Offline Hyper folders/)
  assert.match(source, /Available offline/)
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
  let runtimeCloseCalls = 0

  await assert.rejects(runP2pCacheClear({
    getRuntime: async () => { runtimeCalls += 1 },
    storagePath: '/test/storage',
    stopAssetServer: async () => {},
    closeServices: async () => { throw new Error('PeerChat close failed') },
    closeRuntime: async () => { runtimeCloseCalls += 1 },
    resetFetch: () => {},
    createStore: () => ({
      ready: async () => {},
      close: async () => {}
    }),
    clearStore: async () => ({ ok: true })
  }), /PeerChat close failed/)

  assert.equal(runtimeCalls, 2)
  assert.equal(runtimeCloseCalls, 1)
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

// PeerChat and its notifications open the runtime directly, not through the
// maintenance window. One landing part way through opened a store that was
// being removed.
test('full P2P clear keeps the stores shut from before they close until the removal is done', async () => {
  const events = []
  let runtimeCalls = 0
  const result = await runP2pDataClear({
    getRuntime: async () => { events.push(`runtime-${++runtimeCalls}`) },
    getStoragePath: () => '/test/storage',
    holdStores: () => {
      events.push('hold')
      return () => { events.push('release') }
    },
    stopAssetServer: async () => { events.push('asset-stop') },
    closeServices: async () => { events.push('services-close') },
    closeRuntime: async () => { events.push('runtime-close') },
    resetFetch: () => { events.push('fetch-reset') },
    removeStorage: () => {
      events.push('storage-remove')
      return { warning: 'P2P data was cleared, but one item could not be removed.' }
    },
    clearArchive: async () => { events.push('archive-clear') }
  })

  assert.deepEqual(events, [
    'runtime-1',
    'hold',
    'asset-stop',
    'services-close',
    'runtime-close',
    'fetch-reset',
    'storage-remove',
    'archive-clear',
    'release',
    'runtime-2'
  ])
  assert.equal(result.cleared, true)
  assert.match(result.warning, /one item could not be removed/)
})

test('full P2P clear lets the stores open again when the removal fails', async () => {
  const events = []
  await assert.rejects(runP2pDataClear({
    getRuntime: async () => { events.push('runtime') },
    getStoragePath: () => '/test/storage',
    holdStores: () => () => { events.push('release') },
    stopAssetServer: async () => {},
    closeRuntime: async () => {},
    resetFetch: () => {},
    removeStorage: () => { throw new Error('delete failed') },
    clearArchive: async () => {}
  }), /delete failed/)

  // Released first, or the runtime would wait for it forever.
  assert.deepEqual(events, ['runtime', 'release', 'runtime'])
})

test('clearing the identity is marked as asked for before anything else, and Link Device lets go while the stores are open', async () => {
  const events = []
  const result = await runP2pIdentityClear({
    beginReset: () => { events.push('begin') },
    stopLinkDevice: async () => { events.push('link-device-stop') },
    disconnectNotes: async () => { events.push('notes-disconnect') },
    runMaintenance: async (task) => {
      events.push('maintenance-start')
      const value = await task()
      events.push('maintenance-end')
      return value
    },
    clearData: async () => {
      events.push('clear')
      return { ok: true, cleared: true }
    }
  })

  assert.deepEqual(result, { ok: true, cleared: true })
  assert.deepEqual(events, ['begin', 'link-device-stop', 'notes-disconnect', 'maintenance-start', 'clear', 'maintenance-end'])
})

test('a hosted note that will not close does not stop the clear', async (t) => {
  t.mock.method(console, 'warn', () => {})
  let cleared = false
  const result = await runP2pIdentityClear({
    beginReset: () => {},
    stopLinkDevice: async () => {},
    disconnectNotes: async () => { throw new Error('tunnel stuck') },
    clearData: async () => {
      cleared = true
      return { ok: true, cleared: true }
    }
  })
  assert.equal(cleared, true)
  assert.equal(result.cleared, true)
})

test('Clear all P2P data runs as one clear, finished as the backend next starts if it is cut short', () => {
  const storage = readSource('backend/hyper/storage.mjs')
  const main = readSource('backend/main.mjs')

  const clear = storage.slice(storage.indexOf('export async function clearAllP2pData'), storage.indexOf('export function recoverInterruptedP2pReset'))
  assert.match(clear, /beginReset: \(\) => beginP2pReset\(plan\.identityPath\)/)
  assert.match(clear, /discardPendingRestore\(\)\s*await stopOutgoingTransfer\(\)/)
  assert.match(clear, /disconnectNotes: disconnectP2pmdRoom/)
  assert.match(clear, /withHyperRuntimeMaintenance\(task, closeHyperOfflineDownloads\)/)

  const perform = storage.slice(storage.indexOf('function performAllP2pDataClear'), storage.indexOf('async function createP2pStorageRuntime'))
  assert.match(perform, /holdStores: options\.holdStores \|\| holdHyperStores/)
  assert.match(perform, /finishP2pReset\(plan\)/)
  for (const reset of ['resetPrivateDriveKeyCache()', 'resetLinkedPrivateDrivesCache()', 'resetDeviceSyncStateCache()']) {
    assert.ok(perform.includes(reset), reset)
  }

  // Before anything can open a store, and after a restore is undone.
  assert.ok(main.indexOf('recoverLinkDeviceStorage()\n') < main.indexOf('recoverInterruptedP2pReset()\n'))
  assert.ok(main.indexOf('recoverInterruptedP2pReset()\n') < main.indexOf('createRpc()\n'))
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
  let runtimeCloseCalls = 0

  await assert.rejects(runP2pDataClear({
    getRuntime: async () => { runtimeCalls += 1 },
    getStoragePath: () => '/test/storage',
    stopAssetServer: async () => {},
    closeServices: async () => { throw new Error('PeerChat close failed') },
    closeRuntime: async () => { runtimeCloseCalls += 1 },
    resetFetch: () => {},
    removeStorage: () => {},
    clearArchive: async () => {}
  }), /PeerChat close failed/)

  assert.equal(runtimeCalls, 2)
  assert.equal(runtimeCloseCalls, 1)
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
