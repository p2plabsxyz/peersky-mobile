import assert from 'node:assert/strict'
import { mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  loadP2pmdRoomSnapshot,
  saveP2pmdRoomSnapshot
} from '../../backend/p2pmd/snapshots.mjs'

const roomKey = (character) => `hs://${character.repeat(52)}`

test('P2PMD snapshots persist hosted room content and bound retained rooms', async (t) => {
  const storagePath = await mkdtemp(join(tmpdir(), 'peersky-p2pmd-snapshots-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))

  // Twelve rooms: the ten most recent are kept, twice the five on the recent
  // list, so five arriving from a desktop never push out this phone's own.
  for (let index = 0; index < 12; index++) {
    const character = String.fromCharCode(97 + index)
    assert.equal(saveP2pmdRoomSnapshot(roomKey(character), {
      content: `Room ${index}`,
      lineAttributions: {},
      updatedAt: index
    }, storagePath), true)
  }

  assert.deepEqual(loadP2pmdRoomSnapshot(roomKey('l'), storagePath), {
    content: 'Room 11',
    lineAttributions: {},
    updatedAt: 11
  })
  assert.equal((await readdir(join(storagePath, 'p2pmd-rooms'))).length, 10)

  const snapshotPath = join(storagePath, 'p2pmd-rooms', `${'l'.repeat(52)}.json`)
  await rename(snapshotPath, `${snapshotPath}.previous`)
  assert.equal(loadP2pmdRoomSnapshot(roomKey('l'), storagePath)?.content, 'Room 11')
})

test('P2PMD snapshots reject mismatched and oversized stored data', async (t) => {
  const storagePath = await mkdtemp(join(tmpdir(), 'peersky-p2pmd-invalid-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))

  assert.equal(saveP2pmdRoomSnapshot('https://example.com', {
    content: 'unsafe',
    lineAttributions: {},
    updatedAt: 1
  }, storagePath), false)

  assert.equal(saveP2pmdRoomSnapshot(roomKey('a'), {
    content: 'valid',
    lineAttributions: {},
    updatedAt: 1
  }, storagePath), true)

  const snapshotPath = join(storagePath, 'p2pmd-rooms', `${'a'.repeat(52)}.json`)
  await writeFile(snapshotPath, JSON.stringify({
    version: 1,
    key: roomKey('b'),
    content: 'wrong room',
    lineAttributions: {},
    updatedAt: 2
  }))
  assert.equal(loadP2pmdRoomSnapshot(roomKey('a'), storagePath), null)
})
