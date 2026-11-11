import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { listP2pStorageParts, measureP2pStorage } from '../../backend/hyper/storage-summary.mjs'
import { P2P_IDENTITY_ENTRIES } from '../../backend/hyper/p2p-reset.mjs'
import { isHyperArchiveEntryUrl } from '../../backend/hyper/archive-core.mjs'

// storage.mjs opens the Hyper runtime, which needs Bare, so it is read here.
const storage = await readFile(new URL('../../backend/hyper/storage.mjs', import.meta.url), 'utf8')

const MB = 1024 * 1024

async function phoneFolder () {
  const root = await mkdtemp(join(tmpdir(), 'peersky-p2p-summary-'))
  const stores = {
    identityPath: root,
    publicStore: join(root, 'hyper-sdk'),
    syncedPrivateStore: join(root, 'hyper-sdk-synced-private'),
    adoptedStore: join(root, 'hyper-sdk-adopted'),
    deviceOnlyStore: join(root, 'hyper-sdk-private')
  }
  return { root, stores }
}

// Settings, P2P Data says how much space P2P data takes, by part, as the
// desktop's P2P data does.
test('each part is the folders and files Clear all P2P data would remove', async () => {
  const { root, stores } = await phoneFolder()
  try {
    const parts = Object.fromEntries(listP2pStorageParts(stores).map((part) => [part.id, part.paths]))
    assert.deepEqual(Object.keys(parts), ['hyper', 'hyperPrivate', 'deviceOnly', 'other'])
    assert.deepEqual(parts.hyper, [stores.publicStore])
    assert.deepEqual(parts.hyperPrivate, [stores.syncedPrivateStore, stores.adoptedStore, join(root, 'hyper-private')])
    assert.deepEqual(parts.deviceOnly, [stores.deviceOnlyStore])
    assert.ok(parts.other.includes(`${stores.publicStore}-archive.json`))
    assert.ok(parts.other.includes(`${stores.publicStore}-offline.json`))
    for (const name of P2P_IDENTITY_ENTRIES.filter((entry) => entry !== 'hyper-private')) {
      assert.ok(parts.other.includes(join(root, name)), name)
    }
    // No path is in two parts, so nothing is counted twice.
    const all = Object.values(parts).flat()
    assert.equal(new Set(all).size, all.length)
    // Nothing without a store is listed as one.
    assert.deepEqual(listP2pStorageParts({ identityPath: root }).find((part) => part.id === 'hyper').paths, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('adds up each part on disk, once per file, and nothing outside P2P data', async () => {
  const { root, stores } = await phoneFolder()
  const outside = await mkdtemp(join(tmpdir(), 'peersky-p2p-summary-outside-'))
  try {
    await mkdir(join(stores.publicStore, 'db'), { recursive: true })
    await writeFile(join(stores.publicStore, 'db', 'blocks'), Buffer.alloc(2 * MB, 1))
    await mkdir(join(stores.syncedPrivateStore, 'db'), { recursive: true })
    await writeFile(join(stores.syncedPrivateStore, 'db', 'blocks'), Buffer.alloc(MB, 2))
    await mkdir(stores.deviceOnlyStore, { recursive: true })
    await writeFile(join(stores.deviceOnlyStore, 'file'), Buffer.alloc(MB / 2, 3))
    await writeFile(`${stores.publicStore}-archive.json`, '{"items":[]}')
    await writeFile(join(root, 'hyperdrive-recents.json'), '[]')
    // The same file under a second name in another part counts once.
    await link(join(stores.publicStore, 'db', 'blocks'), join(stores.deviceOnlyStore, 'same-blocks'))
    // A link to something big outside is a link, not what it points at.
    await writeFile(join(outside, 'movie'), Buffer.alloc(8 * MB, 4))
    await symlink(join(outside, 'movie'), join(stores.publicStore, 'link-out'))
    // Tabs, bookmarks and downloads are not P2P data.
    await writeFile(join(root, 'bookmarks.json'), Buffer.alloc(3 * MB, 5))

    const { total, parts } = await measureP2pStorage(listP2pStorageParts(stores))
    assert.ok(parts.hyper >= 2 * MB && parts.hyper < 2.2 * MB, `hyper ${parts.hyper}`)
    assert.ok(parts.hyperPrivate >= MB && parts.hyperPrivate < 1.2 * MB, `private ${parts.hyperPrivate}`)
    assert.ok(parts.deviceOnly >= MB / 2 && parts.deviceOnly < 0.7 * MB, `device only ${parts.deviceOnly}`)
    assert.ok(parts.other > 0 && parts.other < 64 * 1024, `other ${parts.other}`)
    assert.equal(total, parts.hyper + parts.hyperPrivate + parts.deviceOnly + parts.other)
    assert.ok(total < 4 * MB, `total ${total}`)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('a phone with no P2P data yet is all zero, not an error', async () => {
  const { root, stores } = await phoneFolder()
  try {
    assert.deepEqual(await measureP2pStorage(listP2pStorageParts(stores)), {
      total: 0,
      parts: { hyper: 0, hyperPrivate: 0, deviceOnly: 0, other: 0 }
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the summary measures the stores this phone really uses', () => {
  const summary = storage.slice(storage.indexOf('export async function measureP2pStorageSummary'), storage.indexOf('export async function clearP2pCache'))
  assert.match(summary, /identityPath: getDefaultIdentityStoragePath\(\)/)
  assert.match(summary, /publicStore: getHyperStoragePath\(\)/)
  assert.match(summary, /syncedPrivateStore: syncedPrivatePath/)
  assert.match(summary, /adoptedStore: syncedPrivatePath \? adoptedStoragePathFor\(syncedPrivatePath\) : null/)
  assert.match(summary, /deviceOnlyStore: getPrivateHyperStoragePath\(\)/)
  assert.match(summary, /return \{ ok: true, \.\.\.summary \}/)
})

test('the remove button takes one archive entry off by its address, and refuses anything else', () => {
  assert.equal(isHyperArchiveEntryUrl(`hyper://${'a'.repeat(64)}/note.md`), true)
  assert.equal(isHyperArchiveEntryUrl(`hyper://${'a'.repeat(52)}/`), true)
  for (const value of [undefined, null, 42, '', 'https://example.com/', 'hyper://', `hyper://${'a'.repeat(5000)}`]) {
    assert.equal(isHyperArchiveEntryUrl(value), false, String(value).slice(0, 40))
  }
  const remove = storage.slice(storage.indexOf('export async function removeP2pArchiveEntry'), storage.indexOf('export async function measureP2pStorageSummary'))
  assert.ok(remove.indexOf('if (!isHyperArchiveEntryUrl(url))') < remove.indexOf('removeHyperArchive)({ url })'))
  assert.match(remove, /withStorageTransition/)
  assert.match(remove, /\? \{ ok: true \}\n\s+: \{ ok: false, error: 'Unable to update the archive\.' \}/)
})

test('the app asks the backend through two commands of their own', async () => {
  const commands = await readFile(new URL('../../backend/rpc/commands.mjs', import.meta.url), 'utf8')
  assert.match(commands, /export const RPC_HYPER_ARCHIVE_REMOVE = 85\n/)
  assert.match(commands, /export const RPC_P2P_STORAGE_SUMMARY = 86\n/)
  const router = await readFile(new URL('../../backend/rpc/router.mjs', import.meta.url), 'utf8')
  assert.match(router, /req\.command === RPC_HYPER_ARCHIVE_REMOVE\) \{\n\s+replyJson\(req, await removeP2pArchiveEntry\(parseJsonMessage\(req\.data\)\)\)/)
  assert.match(router, /req\.command === RPC_P2P_STORAGE_SUMMARY\) \{\n\s+replyJson\(req, await measureP2pStorageSummary\(\)\)/)
})

// Pictures from other people's drives that notes showed are kept in memory,
// and went on showing after the downloaded cache was cleared.
test('clearing the downloaded P2P cache forgets the pictures notes showed', () => {
  assert.match(storage, /import \{ forgetNoteImages \} from '\.\/drive\.mjs'/)
  const clear = storage.slice(storage.indexOf('async function performP2pCacheClear'), storage.indexOf('function performAllP2pDataClear'))
  assert.match(clear, /try \{\s+return await runP2pCacheClear\(/)
  assert.match(clear, /\} finally \{[^}]*forgetNoteImages\(\)\s+\}/)
})
