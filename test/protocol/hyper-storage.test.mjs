import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import {
  clearDownloadedP2pCores,
  createRoutedP2pStorageRuntime,
  deleteRegisteredP2pAppData,
  getExistingNamedDrive,
  listRegisteredP2pAppData,
  resolveHyperdriveAppDriveName,
  resolveHyperdriveUploadTarget
} from '../../backend/hyper/storage-core.mjs'

describe('Hyper app storage', () => {
  test('lists registered apps with bounded pagination and local metadata totals', async () => {
    const runtime = createRuntime({
      p2pmd: [
        createEntry('/index.html', 120),
        createEntry('/images/photo.jpg', 80),
        createEntry('/link', 0, '/index.html')
      ],
      hyperdrive: [createEntry('/index.html', 40)]
    })

    const firstPage = await listRegisteredP2pAppData(runtime, { page: 1, pageSize: 1 })
    const secondPage = await listRegisteredP2pAppData(runtime, { page: 2, pageSize: 1 })

    assert.equal(firstPage.ok, true)
    assert.equal(firstPage.total, 2)
    assert.equal(firstPage.totalPages, 2)
    assert.deepEqual(firstPage.items[0], {
      id: 'p2pmd',
      title: 'P2PMD',
      url: 'hyper://p2pmd-id/',
      exists: true,
      fileCount: 2,
      byteLength: 200,
      truncated: false
    })
    assert.equal(secondPage.items[0].id, 'hyperdrive')

    const boundedPage = await listRegisteredP2pAppData(runtime, { page: 99, pageSize: 99 })
    assert.equal(boundedPage.page, 1)
    assert.equal(boundedPage.pageSize, 10)
  })

  test('allows deletion only for registered app drives', async () => {
    const runtime = createRuntime({ p2pmd: [], hyperdrive: [] })

    assert.deepEqual(
      await deleteRegisteredP2pAppData(runtime, { appId: 'unknown' }),
      { ok: false, error: 'Unknown P2P app.' }
    )

    assert.deepEqual(
      await deleteRegisteredP2pAppData(runtime, { appId: 'p2pmd' }),
      { ok: true, appId: 'p2pmd', deleted: true }
    )
    assert.equal(runtime.purged.has('p2pmd'), true)
  })

  test('does not create missing drives while listing or deleting', async () => {
    const runtime = createRuntime({})
    const response = await listRegisteredP2pAppData(runtime)

    assert.equal(response.items.every((item) => item.exists === false), true)
    assert.equal(runtime.opened.size, 0)
    assert.deepEqual(
      await deleteRegisteredP2pAppData(runtime, { appId: 'hyperdrive' }),
      { ok: true, appId: 'hyperdrive', deleted: false }
    )
    assert.equal(runtime.opened.size, 0)
  })

  test('deletes a real named Hyperdrive without recreating it during listing', async () => {
    const storagePath = await mkdtemp(join(tmpdir(), 'peersky-drive-delete-'))
    const store = new Corestore(storagePath)
    const namespace = store.namespace('p2pmd')
    const drive = new Hyperdrive(namespace)

    try {
      await drive.ready()
      await drive.put('/index.html', Buffer.from('owned'))

      const runtime = {
        namespace: () => namespace,
        getDrive: async () => drive
      }
      const deleted = await deleteRegisteredP2pAppData(runtime, { appId: 'p2pmd' })
      const listed = await listRegisteredP2pAppData(runtime)

      assert.deepEqual(deleted, { ok: true, appId: 'p2pmd', deleted: true })
      assert.equal(listed.items[0].exists, false)
      assert.equal(await countStoredCores(store), 0)
    } finally {
      await store.close()
      await rm(storagePath, { recursive: true, force: true })
    }
  })

  test('uses one stable app drive unless a valid explicit name is provided', () => {
    assert.equal(resolveHyperdriveAppDriveName(), 'hyperdrive')
    assert.equal(resolveHyperdriveAppDriveName(''), 'hyperdrive')
    assert.equal(resolveHyperdriveAppDriveName('custom-drive'), 'custom-drive')
    assert.equal(resolveHyperdriveAppDriveName('../unsafe'), 'hyperdrive')
  })

  test('resolves public, private, and device-only Hyperdrive upload targets', () => {
    assert.deepEqual(resolveHyperdriveUploadTarget('public'), {
      driveName: 'hyperdrive-public',
      autoJoin: true
    })
    assert.deepEqual(resolveHyperdriveUploadTarget('private'), {
      driveName: 'hyperdrive-private',
      autoJoin: true
    })
    assert.deepEqual(resolveHyperdriveUploadTarget('device'), {
      driveName: 'hyperdrive-device',
      autoJoin: false
    })
    assert.equal(resolveHyperdriveUploadTarget('shared'), null)
  })

  test('opens an existing device-only drive without announcing it', async () => {
    const requests = []
    const namespace = {
      ns: Buffer.from('private'),
      storage: {
        getAlias: async () => Buffer.from('discovery-key'),
        hasCore: async () => true
      }
    }
    const runtime = {
      namespace: () => namespace,
      getDrive: async (name, options) => {
        requests.push({ name, options })
        return { name }
      }
    }

    assert.deepEqual(await getExistingNamedDrive(runtime, {
      driveName: 'hyperdrive-device',
      autoJoin: false
    }), { name: 'hyperdrive-device' })
    assert.deepEqual(requests, [{
      name: 'hyperdrive-device',
      options: { autoJoin: false }
    }])
  })

  test('does not create a missing private drive when listing or deleting', async () => {
    const networkedRuntime = createRuntime({})
    const deviceRuntime = createRuntime({})
    let privateDriveOpened = false
    const runtime = createRoutedP2pStorageRuntime(
      networkedRuntime,
      async () => deviceRuntime,
      async () => { privateDriveOpened = true; return null },
      { hasPrivateDrive: async () => false }
    )

    assert.equal(await runtime.getExistingDrive('hyperdrive-private'), null)
    assert.equal(privateDriveOpened, false)
  })

  test('routes private drive through synced private getter when key exists', async () => {
    const networkedRuntime = createRuntime({})
    const deviceRuntime = createRuntime({})
    const syncedDrive = { id: 'synced-private-id', list: async function * () {}, purge: async () => {} }
    const runtime = createRoutedP2pStorageRuntime(
      networkedRuntime,
      async () => deviceRuntime,
      async () => syncedDrive,
      { hasPrivateDrive: async () => true }
    )

    assert.equal(await runtime.getExistingDrive('hyperdrive-private'), syncedDrive)
  })

  test('does not announce existing drives unless explicitly requested', async () => {
    const requests = []
    const namespace = {
      ns: Buffer.from('existing'),
      storage: {
        getAlias: async () => Buffer.from('discovery-key'),
        hasCore: async () => true
      }
    }
    const runtime = {
      namespace: () => namespace,
      getDrive: async (name, options) => {
        requests.push({ name, options })
        return { name }
      }
    }

    await getExistingNamedDrive(runtime, { driveName: 'future-private-drive' })

    assert.deepEqual(requests, [{
      name: 'future-private-drive',
      options: { autoJoin: false }
    }])
  })

  test('keeps P2PMD announced when app data is summarized', async () => {
    const requests = []
    const runtime = {
      namespace: (name) => ({
        ns: Buffer.from(name),
        storage: {
          getAlias: async () => name === 'p2pmd' ? Buffer.from('discovery-key') : null,
          hasCore: async () => true
        }
      }),
      getDrive: async (name, options) => {
        requests.push({ name, options })
        return {
          id: `${name}-id`,
          list: async function * () {}
        }
      }
    }

    await listRegisteredP2pAppData(runtime)

    assert.deepEqual(requests, [{
      name: 'p2pmd',
      options: { autoJoin: true }
    }])
  })

  test('aggregates and deletes legacy, public, private, and device-only Hyperdrive data', async () => {
    const runtime = createRuntime({
      hyperdrive: [createEntry('/legacy.txt', 10)],
      'hyperdrive-public': [createEntry('/public.txt', 20)],
      'hyperdrive-private': [createEntry('/private.txt', 30)],
      'hyperdrive-device': [createEntry('/local.txt', 40)]
    })

    const listed = await listRegisteredP2pAppData(runtime)
    const hyperdrive = listed.items.find((item) => item.id === 'hyperdrive')
    assert.equal(hyperdrive.fileCount, 4)
    assert.equal(hyperdrive.byteLength, 100)
    assert.equal(hyperdrive.url, '')
    assert.deepEqual(hyperdrive.drives, [
      {
        id: 'hyperdrive-public',
        title: 'Public',
        url: 'hyper://hyperdrive-public-id/',
        fileCount: 1,
        byteLength: 20,
        truncated: false
      },
      {
        id: 'hyperdrive-private',
        title: 'Private',
        url: 'hyper://hyperdrive-private-id/',
        fileCount: 1,
        byteLength: 30,
        truncated: false
      },
      {
        id: 'hyperdrive-device',
        title: 'This device only',
        url: 'hyper://hyperdrive-device-id/',
        fileCount: 1,
        byteLength: 40,
        truncated: false
      },
      {
        id: 'hyperdrive',
        title: 'Legacy',
        url: 'hyper://hyperdrive-id/',
        fileCount: 1,
        byteLength: 10,
        truncated: false
      }
    ])

    assert.deepEqual(await deleteRegisteredP2pAppData(runtime, { appId: 'hyperdrive' }), {
      ok: true,
      appId: 'hyperdrive',
      deleted: true
    })
    assert.deepEqual(runtime.purged, new Set([
      'hyperdrive-public',
      'hyperdrive-private',
      'hyperdrive-device',
      'hyperdrive'
    ]))
  })

  test('opens the isolated runtime only for device-only Hyperdrive data', async () => {
    const networkedRuntime = createRuntime({
      p2pmd: [createEntry('/note.md', 10)],
      'hyperdrive-public': [createEntry('/public.txt', 20)]
    })
    const deviceRuntime = createRuntime({
      'hyperdrive-device': [createEntry('/local.txt', 30)]
    })
    let deviceRuntimeCalls = 0
    const runtime = createRoutedP2pStorageRuntime(
      networkedRuntime,
      async () => {
        deviceRuntimeCalls += 1
        return deviceRuntime
      },
      async () => networkedRuntime
    )

    assert.ok(await runtime.getExistingDrive('p2pmd'))
    assert.equal(deviceRuntimeCalls, 0)
    assert.ok(await runtime.getExistingDrive('hyperdrive-device'))
    assert.equal(deviceRuntimeCalls, 1)
    assert.deepEqual(networkedRuntime.opened, new Set(['p2pmd']))
    assert.deepEqual(deviceRuntime.opened, new Set(['hyperdrive-device']))
  })

  test('deletes public and device-only Hyperdrive data from separate runtimes', async () => {
    const networkedRuntime = createRuntime({
      'hyperdrive-public': [createEntry('/public.txt', 20)],
      'hyperdrive-private': [createEntry('/private.txt', 30)],
      hyperdrive: [createEntry('/legacy.txt', 10)]
    })
    const deviceRuntime = createRuntime({
      'hyperdrive-device': [createEntry('/local.txt', 40)]
    })
    const runtime = createRoutedP2pStorageRuntime(
      networkedRuntime,
      async () => deviceRuntime,
      async () => networkedRuntime.getExistingDrive('hyperdrive-private')
    )

    assert.deepEqual(await deleteRegisteredP2pAppData(runtime, {
      appId: 'hyperdrive'
    }), {
      ok: true,
      appId: 'hyperdrive',
      deleted: true
    })
    assert.deepEqual(networkedRuntime.purged, new Set([
      'hyperdrive-public',
      'hyperdrive-private',
      'hyperdrive'
    ]))
    assert.deepEqual(deviceRuntime.purged, new Set(['hyperdrive-device']))
  })

  test('clears downloaded cores while retaining writable app data', async () => {
    const cores = new Map([
      ['owned', createCore(true)],
      ['remote-db', createCore(false)],
      ['remote-blobs', createCore(false)]
    ])
    const response = await clearDownloadedP2pCores(createStore(cores))

    assert.equal(response.ok, true)
    assert.equal(response.clearedCores, 2)
    assert.equal(response.retainedCores, 1)
    assert.equal(cores.get('owned').closed, true)
    assert.equal(cores.get('owned').purged, false)
    assert.equal(cores.get('remote-db').purged, true)
    assert.equal(cores.get('remote-blobs').purged, true)
  })

  test('clears downloaded cores from a real Corestore while retaining owned cores', async () => {
    const targetPath = await mkdtemp(join(tmpdir(), 'peersky-storage-target-'))
    const sourcePath = await mkdtemp(join(tmpdir(), 'peersky-storage-source-'))
    const source = new Corestore(sourcePath)
    const target = new Corestore(targetPath)

    try {
      await source.ready()
      await target.ready()

      const sourceCore = source.get({ name: 'remote' })
      await sourceCore.ready()
      await sourceCore.append(Buffer.from('downloaded'))

      const ownedCore = target.get({ name: 'owned' })
      await ownedCore.ready()
      await ownedCore.append(Buffer.from('owned'))
      await ownedCore.close()

      const downloadedCore = target.get(sourceCore.key)
      await downloadedCore.ready()
      await downloadedCore.close()

      const response = await clearDownloadedP2pCores(target)

      assert.deepEqual(response, {
        ok: true,
        clearedCores: 1,
        retainedCores: 1,
        failedCores: 0,
        error: undefined
      })
      assert.equal(await countStoredCores(target), 1)
    } finally {
      await target.close()
      await source.close()
      await rm(targetPath, { recursive: true, force: true })
      await rm(sourcePath, { recursive: true, force: true })
    }
  })
})

function createRuntime (filesByDrive) {
  const purged = new Set()
  const opened = new Set()

  return {
    purged,
    opened,
    getExistingDrive: async (name) => {
      if (!Object.hasOwn(filesByDrive, name)) return null
      opened.add(name)
      return createDrive(name)
    },
    getDrive: async (name) => ({
      ...createDrive(name)
    })
  }

  function createDrive (name) {
    return {
      id: `${name}-id`,
      list: async function * () {
        yield * (filesByDrive[name] || [])
      },
      purge: async () => { purged.add(name) }
    }
  }
}

function createEntry (key, byteLength, linkname = null) {
  return {
    key,
    value: {
      blob: linkname ? null : { byteLength },
      linkname
    }
  }
}

function createCore (writable) {
  return {
    writable,
    closed: false,
    purged: false,
    ready: async () => {},
    close: async function () { this.closed = true },
    purge: async function () { this.purged = true }
  }
}

function createStore (cores) {
  return {
    ready: async () => {},
    close: async () => {},
    get: ({ discoveryKey }) => cores.get(discoveryKey),
    storage: {
      createCoreStream: async function * () {
        for (const discoveryKey of cores.keys()) {
          yield { discoveryKey, core: { discoveryKey } }
        }
      },
      deleteCore: async ({ discoveryKey }) => {
        const core = cores.get(discoveryKey)
        await core.purge()
      }
    }
  }
}

async function countStoredCores (store) {
  let count = 0
  for await (const entry of store.storage.createCoreStream()) {
    assert.ok(entry)
    count += 1
  }
  return count
}
