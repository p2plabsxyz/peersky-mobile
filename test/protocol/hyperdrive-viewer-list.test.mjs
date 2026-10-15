import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import b4a from 'b4a'
import z32 from 'z32'
import { BLOCKED_DRIVES, blockedDriveHash } from '../../backend/hyper/blocked-drives.mjs'
import { PRIVATE_DRIVE_ERROR } from '../../backend/hyper/linked-private-drives.mjs'
import {
  createListSignal,
  LIST_ERROR_STATUS,
  listHyperdriveFolder,
  MAX_LISTED_FILES
} from '../../backend/hyperdrive-viewer/drive-list.mjs'
import {
  knownDriveName,
  PRIVATE_DRIVE_REGISTRY_FILE,
  readPrivateDriveRecords
} from '../../backend/hyperdrive-viewer/drive-names.mjs'

const HEX = 'ab'.repeat(32)
const KEY = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u'

describe('Hyperdrive viewer listing', () => {
  it('lists every file under a folder, at any depth, with its size and time', async () => {
    const drive = createFakeDrive({
      '/2024/Goa/IMG_1.jpg': file(10, 1700000000000),
      '/2024/Goa/IMG_1.mov': file(2048, 1700000000500),
      '/2024/notes.txt': file(5),
      '/2024/Goa/link': { linkname: '/elsewhere' },
      '/2025/IMG_9.jpg': file(7),
      '/2024.txt': file(3)
    })
    const result = await list(`hyper://${KEY}/2024/`, { drive })

    assert.deepEqual(result, {
      ok: true,
      entries: [
        { path: '/2024/Goa/IMG_1.jpg', size: 10, mtime: 1700000000000 },
        { path: '/2024/Goa/IMG_1.mov', size: 2048, mtime: 1700000000500 },
        { path: '/2024/notes.txt', size: 5, mtime: null }
      ],
      truncated: false,
      private: false,
      writable: false
    })
    // The drive is read where it lives, under the address it was asked for.
    assert.deepEqual(drive.opened, [`hyper://${KEY}/`])
  })

  it('reads the folder as the drive names it, and a path with no slash as a folder', async () => {
    const drive = createFakeDrive({ '/My Photos/a b.jpg': file(1), '/My Photos/c.jpg': file(2) })
    const encoded = await list(`hyper://${KEY}/My%20Photos/`, { drive })
    assert.deepEqual(encoded.entries.map((entry) => entry.path), ['/My Photos/a b.jpg', '/My Photos/c.jpg'])
    const bare = await list(`hyper://${KEY}/My%20Photos`, { drive })
    assert.deepEqual(bare.entries, encoded.entries)
  })

  it('lists the whole drive from its root, and only the folder\'s own files when not recursive', async () => {
    const drive = createFakeDrive({
      '/a.jpg': file(1),
      '/sub/b.jpg': file(2),
      '/sub/deeper/c.jpg': file(3)
    })
    const all = await list(`hyper://${KEY}/`, { drive })
    assert.deepEqual(all.entries.map((entry) => entry.path), ['/a.jpg', '/sub/b.jpg', '/sub/deeper/c.jpg'])

    const shallow = await list(`hyper://${KEY}/`, { drive, recursive: false })
    assert.deepEqual(shallow.entries.map((entry) => entry.path), ['/a.jpg'])
    const sub = await list(`hyper://${KEY}/sub/`, { drive, recursive: false })
    assert.deepEqual(sub.entries.map((entry) => entry.path), ['/sub/b.jpg'])
  })

  it('stops at the cap and says the list is cut short only when it is', async () => {
    const files = {}
    for (let index = 0; index < 5; index++) files[`/f${index}.jpg`] = file(index)
    const drive = createFakeDrive(files)

    const cut = await list(`hyper://${KEY}/`, { drive, limit: 3 })
    assert.equal(cut.entries.length, 3)
    assert.equal(cut.truncated, true)

    const exact = await list(`hyper://${KEY}/`, { drive, limit: 5 })
    assert.equal(exact.entries.length, 5)
    assert.equal(exact.truncated, false)
    assert.equal(MAX_LISTED_FILES, 50000)
  })

  it('leaves out paths no real file has, and times that are not times', async () => {
    const drive = createFakeDrive({
      [`/${'x'.repeat(5000)}.jpg`]: file(1),
      '/a.jpg': { blob: { byteLength: 4 }, metadata: { mtime: '2024-01-02' } },
      '/b.jpg': { blob: { byteLength: -1 }, metadata: { mtime: { evil: true } } },
      '/c.jpg': { blob: { byteLength: 9 }, metadata: null }
    })
    const result = await list(`hyper://${KEY}/`, { drive })
    assert.deepEqual(result.entries, [
      { path: '/a.jpg', size: 4, mtime: null },
      { path: '/b.jpg', size: 0, mtime: null },
      { path: '/c.jpg', size: 9, mtime: null }
    ])
  })

  it('says whether the drive is one of this person\'s private ones and whether this phone writes it', async () => {
    const drive = createFakeDrive({ '/a.jpg': file(1) }, { writable: true })
    const asked = []
    const result = await list(`hyper://${HEX}/`, {
      drive,
      isPrivate: async (address) => {
        asked.push(address)
        return true
      }
    })
    assert.equal(result.private, true)
    assert.equal(result.writable, true)
    assert.deepEqual(asked, [`hyper://${HEX}/`])
  })

  it('names a drive at its top when this phone knows the name it was made under, and nowhere else', async () => {
    const drive = createFakeDrive({ '/a.jpg': file(1), '/sub/b.jpg': file(2) })
    const asked = []
    const driveName = (id) => {
      asked.push(id)
      return id === HEX ? 'Family photos' : null
    }
    assert.equal((await list(`hyper://${HEX}/`, { drive, driveName })).name, 'Family photos')
    // A folder in it the viewer names after the folder.
    assert.equal('name' in await list(`hyper://${HEX}/sub/`, { drive, driveName }), false)
    assert.deepEqual(asked, [HEX])

    // By the drive's key, whichever way the address writes it.
    const z32Key = z32.encode(b4a.from(HEX, 'hex'))
    assert.equal((await list(`hyper://${z32Key}/`, { drive, driveName })).name, 'Family photos')
    const named = createFakeDrive({ '/a.jpg': file(1) })
    named.key = b4a.from(HEX, 'hex')
    assert.equal((await list('hyper://photos.example.org/', { drive: named, driveName })).name, 'Family photos')

    // Never one made up, and never a failed listing for want of one.
    assert.equal('name' in await list(`hyper://${KEY}/`, { drive, driveName }), false)
    assert.equal('name' in await list('hyper://photos.example.org/', { drive, driveName }), false)
    assert.equal('name' in await list(`hyper://${HEX}/`, { drive }), false)
    const failed = await list(`hyper://${HEX}/`, { drive, driveName: async () => { throw new Error('unreadable') } })
    assert.equal(failed.ok, true)
    assert.equal('name' in failed, false)
  })

  it('answers not-found for a folder with nothing in it, and an empty list for an empty drive', async () => {
    const drive = createFakeDrive({ '/a.jpg': file(1), '/only-links/x': { linkname: '/a.jpg' } })
    const missing = await list(`hyper://${KEY}/nope/`, { drive })
    assert.equal(missing.ok, false)
    assert.equal(missing.code, 'not-found')
    assert.equal(missing.status, 404)

    // Something is there, only no files.
    const links = await list(`hyper://${KEY}/only-links/`, { drive })
    assert.equal(links.ok, true)
    assert.deepEqual(links.entries, [])

    const empty = await list(`hyper://${KEY}/`, { drive: createFakeDrive({}, { writable: true }) })
    assert.equal(empty.ok, true)
    assert.deepEqual(empty.entries, [])
  })

  it('waits a while for someone who has a drive this phone knows nothing about', async () => {
    const drive = createFakeDrive({ '/a.jpg': file(1) }, { length: 0 })
    let released = 0
    drive.core.findingPeers = () => () => { released++ }
    drive.core.update = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      drive.core.length = 3
    }
    let refreshed = 0
    const result = await list(`hyper://${KEY}/`, { drive, refreshNetwork: async () => { refreshed++ } })
    assert.equal(result.ok, true)
    assert.deepEqual(result.entries.map((entry) => entry.path), ['/a.jpg'])
    assert.equal(refreshed, 1)
    assert.ok(released >= 1, 'the peer search is let go')
  })

  it('answers no-peers when nobody who has the drive turns up in time', async () => {
    const drive = createFakeDrive({ '/a.jpg': file(1) }, { length: 0 })
    drive.core.update = () => new Promise(() => {})
    const startedAt = Date.now()
    const result = await list(`hyper://${KEY}/`, { drive, peerWaitMs: 50 })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'no-peers')
    assert.equal(result.status, 503)
    assert.ok(Date.now() - startedAt < 2000)
  })

  it('answers private for someone else\'s private drive, and reads one this phone\'s keys open', async () => {
    const unreadable = createFakeDrive({ '/a.jpg': file(1) })
    unreadable.failWith = Object.assign(new Error('Decoding error: unknown wire type 7'), { code: 'DECODING_ERROR' })
    const refused = await list(`hyper://${HEX}/`, { drive: unreadable, opensAsPrivate: async () => false })
    assert.deepEqual(refused, { ok: false, status: 403, code: 'private', message: PRIVATE_DRIVE_ERROR })

    // A drive a linked device made since the link: the keys open it, and the
    // runtime hands out the private copy from then on.
    const keyed = createFakeDrive({ '/secret.jpg': file(4) })
    let adopted = false
    const result = await listHyperdriveFolder(`hyper://${HEX}/`, {
      withRuntime: async (address, task) => task({ getDrive: async () => adopted ? keyed : unreadable }),
      opensAsPrivate: async () => {
        adopted = true
        return true
      },
      isPrivate: async () => adopted
    })
    assert.equal(result.ok, true)
    assert.deepEqual(result.entries.map((entry) => entry.path), ['/secret.jpg'])
    assert.equal(result.private, true)
  })

  it('answers timeout for a drive too slow to list, and for blocks that never came', async () => {
    const slow = createFakeDrive({ '/a.jpg': file(1), '/b.jpg': file(2) })
    slow.delayMs = 200
    const tooSlow = await list(`hyper://${KEY}/`, { drive: slow, listTimeMs: 50 })
    assert.equal(tooSlow.code, 'timeout')
    assert.equal(tooSlow.status, LIST_ERROR_STATUS.timeout)

    const stuck = createFakeDrive({ '/a.jpg': file(1) })
    stuck.failWith = Object.assign(new Error('Request timed out'), { code: 'REQUEST_TIMEOUT' })
    assert.equal((await list(`hyper://${KEY}/`, { drive: stuck })).code, 'timeout')
  })

  it('refuses an address that is not a drive\'s, and a drive reported to PeerSky', async () => {
    for (const url of ['https://example.com/', 'hyper:///photos/', `hyper://${KEY}/..%2F..%2Fetc/`, '']) {
      const result = await list(url, { drive: createFakeDrive({}) })
      assert.equal(result.ok, false, url)
      assert.equal(result.status, 400, url)
      assert.equal(result.code, 'unknown', url)
    }

    const hash = blockedDriveHash(HEX)
    BLOCKED_DRIVES.add(hash)
    try {
      const drive = createFakeDrive({ '/a.jpg': file(1) })
      const blocked = await list(`hyper://${HEX}/`, { drive })
      assert.equal(blocked.status, 451)
      assert.deepEqual(drive.opened, [])
    } finally {
      BLOCKED_DRIVES.delete(hash)
    }
  })

  it('stops reading once the viewer stops waiting', async () => {
    const files = {}
    for (let index = 0; index < 50; index++) files[`/f${String(index).padStart(2, '0')}.jpg`] = file(index)
    const drive = createFakeDrive(files)
    drive.delayMs = 5
    const signal = createListSignal()
    setTimeout(() => signal.abort(), 30)
    const result = await list(`hyper://${KEY}/`, { drive, signal })
    assert.equal(result.ok, false)
    assert.ok(drive.read < 50, `read ${drive.read} of 50`)
    assert.equal(drive.closed, true)
  })
})

function file (byteLength, mtime) {
  return { blob: { byteLength }, metadata: mtime === undefined ? {} : { mtime } }
}

describe('A drive\'s name for the viewer', () => {
  it('comes from the desktop\'s private drive list that Link Device keeps, by key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'peersky-drive-names-'))
    try {
      assert.deepEqual(readPrivateDriveRecords(dir), [])
      const z32Key = z32.encode(b4a.from(HEX, 'hex'))
      const other = 'cd'.repeat(32)
      writeFileSync(join(dir, PRIVATE_DRIVE_REGISTRY_FILE), JSON.stringify([
        { name: 'Family photos', url: `hyper://${z32Key}/`, timestamp: 2, encrypted: true },
        { name: 'Work', url: `hyper://${other.toUpperCase()}/`, timestamp: 1, encrypted: false },
        { name: 'Elsewhere', url: `hyper://${HEX}/folder/`, timestamp: 1 },
        { name: 'Web', url: 'https://example.com/', timestamp: 1 },
        null
      ]))
      const records = readPrivateDriveRecords(dir)
      assert.deepEqual(records, [
        { name: 'Family photos', id: HEX },
        { name: 'Work', id: other }
      ])
      assert.equal(knownDriveName(records, HEX), 'Family photos')
      assert.equal(knownDriveName(records, other), 'Work')
      assert.equal(knownDriveName(records, 'ef'.repeat(32)), null)

      // A list that cannot be read, or is far too big, names nothing.
      writeFileSync(join(dir, PRIVATE_DRIVE_REGISTRY_FILE), '{ not json')
      assert.deepEqual(readPrivateDriveRecords(dir), [])
      writeFileSync(join(dir, PRIVATE_DRIVE_REGISTRY_FILE), JSON.stringify({ name: 'x' }))
      assert.deepEqual(readPrivateDriveRecords(dir), [])
      writeFileSync(join(dir, PRIVATE_DRIVE_REGISTRY_FILE), ' '.repeat(1024 * 1024 + 1))
      assert.deepEqual(readPrivateDriveRecords(dir), [])
      assert.deepEqual(readPrivateDriveRecords(''), [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is only ever a name someone gave, as the desktop takes one', () => {
    const named = (name) => knownDriveName([{ name, id: HEX }], HEX)
    assert.equal(named('  Trip to Goa  '), 'Trip to Goa')
    // What the desktop calls an upload given no name.
    assert.equal(named('Drive'), null)
    assert.equal(named(''), null)
    assert.equal(named('   '), null)
    assert.equal(named(42), null)
    assert.equal(named(undefined), null)
    assert.equal(named('a\nb'), null)
    assert.equal(named(`a${String.fromCharCode(0x85)}b`), null)
    assert.equal(named('x'.repeat(255)), 'x'.repeat(255))
    assert.equal(named('x'.repeat(256)), null)
    assert.equal(knownDriveName([{ name: 'Trip', id: HEX }], null), null)
  })
})

function list (url, { drive, ...options }) {
  return listHyperdriveFolder(url, {
    withRuntime: async (address, task) => task({
      getDrive: async (driveAddress) => {
        drive.opened.push(driveAddress)
        return drive
      }
    }),
    ...options
  })
}

// Enough of a Hyperdrive for listing: entries in key order, list(folder,
// { recursive }) as Hyperdrive 13 answers it, and a core with a length.
function createFakeDrive (files, { writable = false, length = 10 } = {}) {
  const keys = Object.keys(files).sort((left, right) => b4a.compare(b4a.from(left), b4a.from(right)))
  const drive = {
    writable,
    opened: [],
    read: 0,
    closed: false,
    delayMs: 0,
    failWith: null,
    core: { length, update: async () => {}, findingPeers: () => () => {} },
    list (folder, { recursive = true } = {}) {
      const prefix = folder === '/' ? '/' : `${folder.replace(/\/$/, '')}/`
      const under = keys.filter((key) => key.startsWith(prefix))
      const seen = new Set()
      const picked = recursive === false
        ? under.filter((key) => {
          const name = key.slice(prefix.length).split('/')[0]
          if (seen.has(name)) return false
          seen.add(name)
          return true
        })
        : under
      let index = 0
      return {
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            if (drive.failWith) throw drive.failWith
            if (drive.delayMs) await new Promise((resolve) => setTimeout(resolve, drive.delayMs))
            if (index >= picked.length) return { done: true, value: undefined }
            const key = picked[index++]
            drive.read++
            return { done: false, value: { key, value: files[key] } }
          },
          return: async () => {
            drive.closed = true
            return { done: true, value: undefined }
          }
        })
      }
    }
  }
  return drive
}
