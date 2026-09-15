import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  getPrivateDriveKey,
  getPrivateDriveKeyFile,
  getPrivateDriveId,
  getPrivateDriveKeyRecord,
  hasPrivateDriveKey,
  importPrivateDriveKey,
  isValidPrivateDriveId,
  normalizePrivateDriveKey,
  PRIVATE_DRIVE_KEY_BYTES,
  rememberPrivateDriveId,
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
    assert.equal(persisted.version, 2)
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

test('hasPrivateDriveKey returns false before key generation and true after', async () => {
  resetPrivateDriveKeyCache()
  const storagePath = await mkdtemp(join(tmpdir(), 'peersky-haskey-'))

  try {
    assert.equal(hasPrivateDriveKey(storagePath), false)
    getPrivateDriveKey(storagePath)
    assert.equal(hasPrivateDriveKey(storagePath), true)
  } finally {
    resetPrivateDriveKeyCache()
    await rm(storagePath, { recursive: true, force: true })
  }
})

test('getPrivateDriveId returns null when no drive id is persisted', async () => {
  resetPrivateDriveKeyCache()
  const storagePath = await mkdtemp(join(tmpdir(), 'peersky-nodid-'))

  try {
    assert.equal(getPrivateDriveId(storagePath), null)
    getPrivateDriveKey(storagePath)
    assert.equal(getPrivateDriveId(storagePath), null)
  } finally {
    resetPrivateDriveKeyCache()
    await rm(storagePath, { recursive: true, force: true })
  }
})

test('importPrivateDriveKey adopts an external key and persists it', async () => {
  resetPrivateDriveKeyCache()
  const storagePath = await mkdtemp(join(tmpdir(), 'peersky-import-'))
  const driveId = 'b'.repeat(64)

  try {
    const keyBytes = importPrivateDriveKey(storagePath, {
      key: 'c'.repeat(64),
      driveId
    })
    assert.ok(keyBytes)
    assert.equal(keyBytes.byteLength, PRIVATE_DRIVE_KEY_BYTES)

    const persisted = JSON.parse(await readFile(getPrivateDriveKeyFile(storagePath), 'utf8'))
    assert.equal(persisted.version, 2)
    assert.equal(persisted.key, 'c'.repeat(64))
    assert.equal(persisted.driveId, driveId)

    const readBack = getPrivateDriveKey(storagePath)
    assert.deepEqual(readBack, keyBytes)
    assert.equal(getPrivateDriveId(storagePath), driveId)
  } finally {
    resetPrivateDriveKeyCache()
    await rm(storagePath, { recursive: true, force: true })
  }
})

test('rememberPrivateDriveId persists the drive id into the existing key file', async () => {
  resetPrivateDriveKeyCache()
  const storagePath = await mkdtemp(join(tmpdir(), 'peersky-remember-'))
  const driveId = 'd'.repeat(64)

  try {
    getPrivateDriveKey(storagePath)
    assert.equal(getPrivateDriveId(storagePath), null)

    assert.equal(rememberPrivateDriveId(storagePath, driveId), true)
    const persisted = JSON.parse(await readFile(getPrivateDriveKeyFile(storagePath), 'utf8'))
    assert.equal(persisted.driveId, driveId)
    assert.equal(getPrivateDriveId(storagePath), driveId)
  } finally {
    resetPrivateDriveKeyCache()
    await rm(storagePath, { recursive: true, force: true })
  }
})

test('two different storage paths get different generated keys', async () => {
  resetPrivateDriveKeyCache()
  const firstPath = await mkdtemp(join(tmpdir(), 'peersky-diff1-'))
  const secondPath = await mkdtemp(join(tmpdir(), 'peersky-diff2-'))

  try {
    const first = getPrivateDriveKey(firstPath)
    const second = getPrivateDriveKey(secondPath)
    assert.ok(first)
    assert.ok(second)
    assert.notDeepEqual(first, second)
  } finally {
    resetPrivateDriveKeyCache()
    await rm(firstPath, { recursive: true, force: true })
    await rm(secondPath, { recursive: true, force: true })
  }
})

test('isValidPrivateDriveId validates hex strings of correct length', () => {
  assert.equal(isValidPrivateDriveId('a'.repeat(64)), true)
  assert.equal(isValidPrivateDriveId('0'.repeat(64)), true)
  assert.equal(isValidPrivateDriveId('f'.repeat(64)), true)
  assert.equal(isValidPrivateDriveId('g'.repeat(64)), false)
  assert.equal(isValidPrivateDriveId('a'.repeat(63)), false)
  assert.equal(isValidPrivateDriveId('a'.repeat(65)), false)
  assert.equal(isValidPrivateDriveId(''), false)
  assert.equal(isValidPrivateDriveId(null), false)
  assert.equal(isValidPrivateDriveId(undefined), false)
})

test('importPrivateDriveKey with a null key writes an unencrypted v3 record', async () => {
  resetPrivateDriveKeyCache()
  const storagePath = await mkdtemp(join(tmpdir(), 'peersky-unenc-'))
  const driveId = 'e'.repeat(64)

  try {
    const keyBytes = importPrivateDriveKey(storagePath, { key: null, driveId })
    assert.equal(keyBytes, null)

    const persisted = JSON.parse(await readFile(getPrivateDriveKeyFile(storagePath), 'utf8'))
    assert.equal(persisted.version, 3)
    assert.equal(persisted.key, null)
    assert.equal(persisted.encrypted, false)
    assert.equal(persisted.driveId, driveId)

    assert.equal(getPrivateDriveKey(storagePath), null)
    assert.equal(hasPrivateDriveKey(storagePath), true)
    assert.equal(getPrivateDriveId(storagePath), driveId)
  } finally {
    resetPrivateDriveKeyCache()
    await rm(storagePath, { recursive: true, force: true })
  }
})

test('getPrivateDriveKeyRecord reports a desktop-adopted unencrypted drive', async () => {
  resetPrivateDriveKeyCache()
  const storagePath = await mkdtemp(join(tmpdir(), 'peersky-record-'))
  const driveId = 'f'.repeat(64)

  try {
    importPrivateDriveKey(storagePath, { key: null, driveId, source: 'desktop' })
    const record = getPrivateDriveKeyRecord(storagePath)
    assert.equal(record.ok, true)
    assert.equal(record.encrypted, false)
    assert.equal(record.source, 'desktop')
    assert.equal(record.driveId, driveId)
    assert.equal(record.key, null)
  } finally {
    resetPrivateDriveKeyCache()
    await rm(storagePath, { recursive: true, force: true })
  }
})

test('rememberPrivateDriveId works for an unencrypted adopted drive without regenerating a key', async () => {
  resetPrivateDriveKeyCache()
  const storagePath = await mkdtemp(join(tmpdir(), 'peersky-unenc-rem-'))
  const driveId = '1'.repeat(64)
  const updatedId = '2'.repeat(64)

  try {
    importPrivateDriveKey(storagePath, { key: null, driveId })
    assert.equal(rememberPrivateDriveId(storagePath, updatedId), true)

    const persisted = JSON.parse(await readFile(getPrivateDriveKeyFile(storagePath), 'utf8'))
    assert.equal(persisted.version, 3)
    assert.equal(persisted.key, null)
    assert.equal(persisted.driveId, updatedId)
    assert.equal(getPrivateDriveKey(storagePath), null)
  } finally {
    resetPrivateDriveKeyCache()
    await rm(storagePath, { recursive: true, force: true })
  }
})
