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

  // Thirty-six rooms: the thirty-five most recent are kept, one for each of the
  // thirty on the recent list plus the five a desktop sends, so those arriving
  // never push out this phone's own.
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
  for (const [index, character] of characters.entries()) {
    assert.equal(saveP2pmdRoomSnapshot(roomKey(character), {
      content: `Room ${index}`,
      lineAttributions: {},
      updatedAt: index
    }, storagePath), true)
  }

  assert.deepEqual(loadP2pmdRoomSnapshot(roomKey('9'), storagePath), {
    content: 'Room 35',
    lineAttributions: {},
    updatedAt: 35
  })
  assert.equal((await readdir(join(storagePath, 'p2pmd-rooms'))).length, 35)

  const snapshotPath = join(storagePath, 'p2pmd-rooms', `${'9'.repeat(52)}.json`)
  await rename(snapshotPath, `${snapshotPath}.previous`)
  assert.equal(loadP2pmdRoomSnapshot(roomKey('9'), storagePath)?.content, 'Room 35')
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
