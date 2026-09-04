import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  getPrivateDriveKey,
  getPrivateDriveKeyFile,
  normalizePrivateDriveKey,
  PRIVATE_DRIVE_KEY_BYTES,
  resetPrivateDriveKeyCache
} from '../../backend/hyper/private-keys.mjs'

test('generates and persists a private drive encryption key', async () => {
  resetPrivateDriveKeyCache()
  const storagePath = await mkdtemp(join(tmpdir(), 'peersky-privkey-'))

  try {
    const key = getPrivateDriveKey(storagePath)
    assert.ok(key)
    assert.equal(key.byteLength, PRIVATE_DRIVE_KEY_BYTES)

    const first = getPrivateDriveKey(storagePath)
    assert.deepEqual(first, key)

    const persisted = JSON.parse(await readFile(getPrivateDriveKeyFile(storagePath), 'utf8'))
    assert.equal(persisted.version, 1)
    assert.equal(typeof persisted.createdAt, 'string')
    assert.ok(persisted.key.match(/^[0-9a-f]{64}$/))
  } finally {
    resetPrivateDriveKeyCache()
    await rm(storagePath, { recursive: true, force: true })
  }
})

test('returns null when no storage path is provided', () => {
  resetPrivateDriveKeyCache()
  assert.equal(getPrivateDriveKey(''), null)
  assert.equal(getPrivateDriveKey(null), null)
  resetPrivateDriveKeyCache()
})

test('normalizes a 32-byte hex encryption key', () => {
  const hex = 'a'.repeat(64)
  const key = normalizePrivateDriveKey(hex)
  assert.ok(key)
  assert.equal(key.byteLength, PRIVATE_DRIVE_KEY_BYTES)

  assert.equal(normalizePrivateDriveKey(''), null)
  assert.equal(normalizePrivateDriveKey('zz'), null)
  assert.equal(normalizePrivateDriveKey('a'.repeat(62)), null)
  assert.equal(normalizePrivateDriveKey('a'.repeat(66)), null)
})
