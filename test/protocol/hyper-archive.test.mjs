import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  MAX_HYPER_ARCHIVE_ENTRIES,
  listHyperArchiveItems,
  parseHyperArchive,
  recordHyperArchiveItem,
  removeHyperArchiveItems,
  serializeHyperArchive
} from '../../backend/hyper/archive-core.mjs'
import {
  clearHyperArchive,
  listHyperArchive,
  recordHyperArchive,
  removeHyperArchive
} from '../../backend/hyper/archive.mjs'

const DRIVE_A = `hyper://${'a'.repeat(64)}/`
const DRIVE_B = `hyper://${'b'.repeat(64)}/`

test('keeps general Hyper browsing out of the P2P app archive', async () => {
  const fetchSource = await readFile(
    new URL('../../backend/hyper/fetch.mjs', import.meta.url),
    'utf8'
  )

  assert.doesNotMatch(fetchSource, /recordHyperArchive/)
})

test('normalizes, deduplicates, and preserves published ownership', () => {
  let items = recordHyperArchiveItem([], {
    url: `${DRIVE_A}notes.md?secret=value#section`,
    name: 'Notes',
    source: 'published',
    appId: 'hyperdrive'
  }, 10)

  items = recordHyperArchiveItem(items, {
    url: `${DRIVE_A}notes.md`,
    name: 'Remote notes',
    source: 'fetched'
  }, 20)

  assert.deepEqual(items, [{
    url: `${DRIVE_A}notes.md`,
    driveUrl: DRIVE_A,
    name: 'Notes',
    source: 'published',
    appId: 'hyperdrive',
    updatedAt: 20
  }])
})

test('preserves encoded filename characters in archived Hyper URLs', () => {
  const items = [
    ['report%232%3F.pdf', 'report%232%3F.pdf'],
    ['space%20name.txt', 'space%20name.txt'],
    ['caf%C3%A9.txt', 'caf%C3%A9.txt']
  ].map(([input, expected], index) => {
    const [item] = recordHyperArchiveItem([], {
      url: `${DRIVE_A}${input}`,
      source: 'fetched'
    }, index + 1)
    assert.equal(item.url, `${DRIVE_A}${expected}`)
    return item
  })

  assert.deepEqual(items.map((item) => item.name), [
    'report#2?.pdf',
    'space name.txt',
    'café.txt'
  ])
})

test('rejects malformed entries and bounds archive growth', () => {
  assert.deepEqual(parseHyperArchive(JSON.stringify({
    items: [
      { url: 'https://example.com/', source: 'fetched' },
      { url: DRIVE_A, source: 'unknown' },
      { url: DRIVE_B, name: 'bad\u007fname', source: 'fetched', updatedAt: 1 }
    ]
  })), [{
    url: DRIVE_B,
    driveUrl: DRIVE_B,
    name: 'badname',
    source: 'fetched',
    appId: undefined,
    updatedAt: 1
  }])

  let items = []
  for (let index = 0; index < MAX_HYPER_ARCHIVE_ENTRIES + 20; index += 1) {
    items = recordHyperArchiveItem(items, {
      url: `${DRIVE_A}file-${index}.txt`,
      source: 'fetched'
    }, index + 1)
  }
  assert.equal(items.length, MAX_HYPER_ARCHIVE_ENTRIES)
  assert.equal(items[0].name, `file-${MAX_HYPER_ARCHIVE_ENTRIES + 19}.txt`)
})

test('filters, paginates, clamps stale pages, and removes matching entries', () => {
  const items = parseHyperArchive(serializeHyperArchive([
    { url: `${DRIVE_A}one`, name: 'One', source: 'fetched', updatedAt: 3 },
    { url: `${DRIVE_A}two`, name: 'Two', source: 'published', appId: 'p2pmd', updatedAt: 2 },
    { url: `${DRIVE_B}three`, name: 'Three', source: 'fetched', updatedAt: 1 }
  ]))

  const fetched = listHyperArchiveItems(items, { page: 99, pageSize: 1, source: 'fetched' })
  assert.equal(fetched.page, 2)
  assert.equal(fetched.totalPages, 2)
  assert.equal(fetched.items[0].name, 'Three')
  assert.deepEqual(removeHyperArchiveItems(items, { appId: 'p2pmd' }).map((item) => item.name), ['One', 'Three'])
  assert.deepEqual(removeHyperArchiveItems(items, { source: 'fetched' }).map((item) => item.name), ['Two'])
})

test('persists archive changes atomically and clears its metadata file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'peersky-hyper-archive-'))
  const storagePath = join(directory, 'hyper-sdk')

  try {
    assert.equal(await recordHyperArchive({ url: DRIVE_A, name: 'First', source: 'fetched' }, storagePath), true)
    assert.equal(await recordHyperArchive({ url: DRIVE_B, name: 'Second', source: 'published' }, storagePath), true)

    const listed = await listHyperArchive({ page: 1, pageSize: 10 }, storagePath)
    assert.deepEqual(listed.items.map((item) => item.name), ['Second', 'First'])

    await removeHyperArchive({ source: 'fetched' }, storagePath)
    assert.deepEqual((await listHyperArchive({}, storagePath)).items.map((item) => item.name), ['Second'])

    await clearHyperArchive(storagePath)
    assert.deepEqual((await listHyperArchive({}, storagePath)).items, [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
