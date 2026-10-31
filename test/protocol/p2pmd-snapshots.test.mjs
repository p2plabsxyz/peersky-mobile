import assert from 'node:assert/strict'
import { mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  loadP2pmdRoomSnapshot,
  p2pmdSnapshotFileName,
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

  const snapshotPath = join(storagePath, 'p2pmd-rooms', p2pmdSnapshotFileName(roomKey('9')))
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

  const snapshotPath = join(storagePath, 'p2pmd-rooms', p2pmdSnapshotFileName(roomKey('a')))
  await writeFile(snapshotPath, JSON.stringify({
    version: 1,
    key: roomKey('b'),
    content: 'wrong room',
    lineAttributions: {},
    updatedAt: 2
  }))
  assert.equal(loadP2pmdRoomSnapshot(roomKey('a'), storagePath), null)
})

test('P2PMD snapshots keep the note\'s Yjs state, and drop it rather than the note when it is too big', async (t) => {
  const storagePath = await mkdtemp(join(tmpdir(), 'peersky-p2pmd-yjs-'))
  t.after(() => rm(storagePath, { recursive: true, force: true }))

  assert.equal(saveP2pmdRoomSnapshot(roomKey('y'), {
    content: 'Line one',
    lineAttributions: {},
    updatedAt: 1,
    yjsState: 'AQLmx5ziAgA='
  }, storagePath), true)
  assert.equal(loadP2pmdRoomSnapshot(roomKey('y'), storagePath).yjsState, 'AQLmx5ziAgA=')

  // Over the limit with the state, under it with the text alone.
  assert.equal(saveP2pmdRoomSnapshot(roomKey('z'), {
    content: 'x'.repeat(1024),
    lineAttributions: {},
    updatedAt: 2,
    yjsState: 'A'.repeat(45 * 1024 * 1024)
  }, storagePath), true)
  const saved = loadP2pmdRoomSnapshot(roomKey('z'), storagePath)
  assert.equal(saved.content, 'x'.repeat(1024))
  assert.equal(saved.yjsState, undefined)
})
