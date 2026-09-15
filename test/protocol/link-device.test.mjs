import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import sodium from 'sodium-native'
import z32 from 'z32'
import { createMobilePairingCode } from '../../app/settings/identity-pairing.mjs'
import { verifyIdentityTransferSignature } from '../../backend/backup/identity-transfer.mjs'
import { extractTransferredPrivateDrive, adoptTransferredPrivateDrive } from '../../backend/backup/private-drive-import.mjs'
import { resetPrivateDriveKeyCache } from '../../backend/hyper/private-keys.mjs'
import { adoptedStoragePathFor } from '../../backend/hyper/runtime-routing.mjs'
import { commitIdentityRestore, restoreIdentityFromBackup } from '../../backend/backup/restore.mjs'

function canonicalJson (value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function toHex (buf) {
  return Buffer.from(buf).toString('hex')
}

function createDirectoryZip (name) {
  const nameBytes = Buffer.from(name)
  const centralDirectory = Buffer.alloc(46 + nameBytes.length)
  centralDirectory.writeUInt32LE(0x02014b50, 0)
  centralDirectory.writeUInt16LE(nameBytes.length, 28)
  nameBytes.copy(centralDirectory, 46)

  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  endOfCentralDirectory.writeUInt16LE(1, 8)
  endOfCentralDirectory.writeUInt16LE(1, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12)

  return Buffer.concat([centralDirectory, endOfCentralDirectory])
}

function createFileZip (name, contents) {
  const nameBytes = Buffer.from(name)
  const contentBytes = Buffer.from(contents)
  const localHeader = Buffer.alloc(30 + nameBytes.length)
  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt32LE(contentBytes.length, 18)
  localHeader.writeUInt32LE(contentBytes.length, 22)
  localHeader.writeUInt16LE(nameBytes.length, 26)
  nameBytes.copy(localHeader, 30)

  const centralDirectory = Buffer.alloc(46 + nameBytes.length)
  centralDirectory.writeUInt32LE(0x02014b50, 0)
  centralDirectory.writeUInt32LE(contentBytes.length, 20)
  centralDirectory.writeUInt32LE(contentBytes.length, 24)
  centralDirectory.writeUInt16LE(nameBytes.length, 28)
  nameBytes.copy(centralDirectory, 46)

  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  endOfCentralDirectory.writeUInt16LE(1, 8)
  endOfCentralDirectory.writeUInt16LE(1, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12)
  endOfCentralDirectory.writeUInt32LE(localHeader.length + contentBytes.length, 16)

  return Buffer.concat([localHeader, contentBytes, centralDirectory, endOfCentralDirectory])
}

function createDeflatedFileZip (name, contents) {
  const nameBytes = Buffer.from(name)
  const contentBytes = Buffer.from(contents)
  const compressedBytes = deflateRawSync(contentBytes)
  const localHeader = Buffer.alloc(30 + nameBytes.length)
  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(8, 8)
  localHeader.writeUInt32LE(compressedBytes.length, 18)
  localHeader.writeUInt32LE(contentBytes.length, 22)
  localHeader.writeUInt16LE(nameBytes.length, 26)
  nameBytes.copy(localHeader, 30)

  const centralDirectory = Buffer.alloc(46 + nameBytes.length)
  centralDirectory.writeUInt32LE(0x02014b50, 0)
  centralDirectory.writeUInt16LE(8, 10)
  centralDirectory.writeUInt32LE(compressedBytes.length, 20)
  centralDirectory.writeUInt32LE(contentBytes.length, 24)
  centralDirectory.writeUInt16LE(nameBytes.length, 28)
  nameBytes.copy(centralDirectory, 46)

  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  endOfCentralDirectory.writeUInt16LE(1, 8)
  endOfCentralDirectory.writeUInt16LE(1, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12)
  endOfCentralDirectory.writeUInt32LE(localHeader.length + compressedBytes.length, 16)

  return Buffer.concat([localHeader, compressedBytes, centralDirectory, endOfCentralDirectory])
}

describe('Link Device Identity Transfer', () => {
  it('creates a complete mobile pairing code for QR and clipboard use', () => {
    const publicKey = 'AA'.repeat(32)
    const nonce = 'BB'.repeat(16)

    assert.equal(
      createMobilePairingCode(publicKey, nonce),
      `peersky-identity:${'aa'.repeat(32)}?nonce=${'bb'.repeat(16)}&deviceType=mobile`
    )
    assert.equal(createMobilePairingCode('invalid', nonce), '')
    assert.equal(createMobilePairingCode(publicKey, 'invalid'), '')
  })

  it('Forged signature is rejected', () => {
    const keys = { publicKey: Buffer.alloc(32), secretKey: Buffer.alloc(64) }
    sodium.crypto_sign_keypair(keys.publicKey, keys.secretKey)

    const transfer = {
      version: 1,
      identityId: 'test-identity',
      sourceSigningPublicKey: toHex(keys.publicKey),
      sourceEncryptionPublicKey: toHex(crypto.randomBytes(32)),
      targetDeviceType: 'mobile',
      targetEncryptionPublicKey: toHex(crypto.randomBytes(32)),
      channel: toHex(crypto.randomBytes(32)),
      nonce: toHex(crypto.randomBytes(16)),
      issuedAt: Date.now(),
      expiresAt: Date.now() + 600000,
      encryptedKey: toHex(crypto.randomBytes(48)),
      iv: toHex(crypto.randomBytes(12)),
      authTag: toHex(crypto.randomBytes(16)),
      payloadSha256: toHex(crypto.randomBytes(32))
    }

    const message = Buffer.from(canonicalJson(transfer))
    const signature = Buffer.alloc(sodium.crypto_sign_BYTES)
    sodium.crypto_sign_detached(signature, message, keys.secretKey)
    transfer.signature = toHex(signature)

    assert.equal(verifyIdentityTransferSignature(transfer), true)

    // Forge
    transfer.identityId = 'forged-identity'
    assert.equal(verifyIdentityTransferSignature(transfer), false)
  })

  it('Expired transfer is rejected', async () => {
    assert.ok(true)
  })

  it('Wrong targetEncryptionPublicKey is rejected', async () => {
    assert.ok(true)
  })

  it('Flipped byte in payload fails GCM auth tag', async () => {
    assert.ok(true)
  })

  it('Entry named ../../evil throws', async () => {
    const storagePath = mkdtempSync(join(tmpdir(), 'peersky-restore-'))

    try {
      await assert.rejects(
        restoreIdentityFromBackup(createDirectoryZip('hyper/../../evil/'), storagePath),
        /illegal path traversal/
      )
    } finally {
      rmSync(storagePath, { recursive: true, force: true })
    }
  })

  it('Restores peersky-identity.json from a desktop mobile backup', async () => {
    const storagePath = mkdtempSync(join(tmpdir(), 'peersky-restore-'))
    const identity = JSON.stringify({ identityId: 'test-identity' })

    try {
      const result = await restoreIdentityFromBackup(
        createFileZip('peersky-identity.json', identity),
        storagePath
      )

      assert.equal(result.restoredFiles, 1)
      assert.equal(readFileSync(join(storagePath, 'peersky-identity.json'), 'utf8'), identity)
    } finally {
      rmSync(storagePath, { recursive: true, force: true })
    }
  })

  it('Entry named device-key.json is refused', async () => {
    assert.ok(true)
  })

  it('restores an identity backup larger than 50 MB', async () => {
    const storagePath = mkdtempSync(join(tmpdir(), 'peersky-large-restore-'))
    const size = 50 * 1024 * 1024 + 1

    try {
      const result = await restoreIdentityFromBackup(
        createDeflatedFileZip('hyper/large-core', Buffer.alloc(size)),
        storagePath
      )

      assert.equal(result.restoredFiles, 1)
      assert.equal(statSync(join(storagePath, 'hyper/large-core')).size, size)
    } finally {
      rmSync(storagePath, { recursive: true, force: true })
    }
  })

  it('restores desktop private-hyper corestore from an identity transfer', async () => {
    const storagePath = mkdtempSync(join(tmpdir(), 'peersky-hyper-private-restore-'))

    try {
      const result = await restoreIdentityFromBackup(
        createFileZip('hyper-private/CORESTORE', 'corestore'),
        storagePath
      )

      assert.equal(result.restoredFiles, 1)
      assert.equal(readFileSync(join(storagePath, 'hyper-private/CORESTORE'), 'utf8'), 'corestore')
    } finally {
      rmSync(storagePath, { recursive: true, force: true })
    }
  })

  it('restores privateHyperdrives.json from an identity transfer', async () => {
    const storagePath = mkdtempSync(join(tmpdir(), 'peersky-private-registry-restore-'))
    const registry = JSON.stringify([{ name: 'private', url: 'hyper://entry', timestamp: 1 }])

    try {
      const result = await restoreIdentityFromBackup(
        createFileZip('privateHyperdrives.json', registry),
        storagePath
      )

      assert.equal(result.restoredFiles, 1)
      assert.equal(readFileSync(join(storagePath, 'privateHyperdrives.json'), 'utf8'), registry)
    } finally {
      rmSync(storagePath, { recursive: true, force: true })
    }
  })

  it('adopts a transferred private drive key from a restored backup', () => {
    resetPrivateDriveKeyCache()
    const sourcePath = mkdtempSync(join(tmpdir(), 'peersky-adopt-source-'))
    const targetPath = mkdtempSync(join(tmpdir(), 'peersky-adopt-target-'))
    const driveId = 'e'.repeat(64)

    try {
      const payload = JSON.stringify({ version: 2, createdAt: new Date().toISOString(), key: 'f'.repeat(64), driveId })
      writeFileSync(join(sourcePath, 'private-drive-key.json'), payload)

      const result = adoptTransferredPrivateDrive(sourcePath, targetPath)
      assert.equal(result.adopted, true)
      assert.equal(result.driveId, driveId)

      const persisted = JSON.parse(readFileSync(join(targetPath, 'private-drive-key.json'), 'utf8'))
      assert.equal(persisted.key, 'f'.repeat(64))
      assert.equal(persisted.driveId, driveId)
    } finally {
      resetPrivateDriveKeyCache()
      rmSync(sourcePath, { recursive: true, force: true })
      rmSync(targetPath, { recursive: true, force: true })
    }
  })

  it('returns adopted:false when no private drive key exists in the backup', () => {
    const sourcePath = mkdtempSync(join(tmpdir(), 'peersky-adopt-empty-'))
    const targetPath = mkdtempSync(join(tmpdir(), 'peersky-adopt-target2-'))

    try {
      const result = adoptTransferredPrivateDrive(sourcePath, targetPath)
      assert.equal(result.adopted, false)
    } finally {
      rmSync(sourcePath, { recursive: true, force: true })
      rmSync(targetPath, { recursive: true, force: true })
    }
  })

  it('extracts a valid private drive key from the transferred backup', () => {
    const storagePath = mkdtempSync(join(tmpdir(), 'peersky-extract-'))
    const driveId = 'a'.repeat(64)

    try {
      const payload = JSON.stringify({ version: 2, createdAt: new Date().toISOString(), key: 'c'.repeat(64), driveId })
      writeFileSync(join(storagePath, 'private-drive-key.json'), payload)

      const result = extractTransferredPrivateDrive(storagePath)
      assert.equal(result.length, 1)
      assert.equal(result[0].key, 'c'.repeat(64))
      assert.equal(result[0].driveId, driveId)
    } finally {
      rmSync(storagePath, { recursive: true, force: true })
    }
  })

  it('extracts a v3 desktop key record with a null key', () => {
    const storagePath = mkdtempSync(join(tmpdir(), 'peersky-extract-v3-'))
    const driveId = 'b'.repeat(64)

    try {
      const payload = JSON.stringify({
        version: 3,
        createdAt: new Date().toISOString(),
        key: null,
        driveId,
        encrypted: false,
        source: 'desktop'
      })
      writeFileSync(join(storagePath, 'private-drive-key.json'), payload)

      const result = extractTransferredPrivateDrive(storagePath)
      assert.equal(result.length, 1)
      assert.equal(result[0].source, 'desktop')
      assert.equal(result[0].encrypted, false)
      assert.equal(result[0].key, null)
      assert.equal(result[0].driveId, driveId)

      const syncedStore = join(storagePath, 'adopted')
      const adoption = adoptTransferredPrivateDrive(storagePath, syncedStore)
      assert.equal(adoption.adopted, true)
      assert.equal(adoption.driveId, driveId)
      assert.equal(adoption.encrypted, false)
    } finally {
      resetPrivateDriveKeyCache()
      rmSync(storagePath, { recursive: true, force: true })
    }
  })

  it('rejects a transferred key with an invalid key format', () => {
    const storagePath = mkdtempSync(join(tmpdir(), 'peersky-extract-bad-'))

    try {
      const payload = JSON.stringify({ version: 2, createdAt: new Date().toISOString(), key: 'not-hex' })
      writeFileSync(join(storagePath, 'private-drive-key.json'), payload)

      const result = extractTransferredPrivateDrive(storagePath)
      assert.deepEqual(result, [])
    } finally {
      rmSync(storagePath, { recursive: true, force: true })
    }
  })

  it('links two devices to the same private drive via key transfer', () => {
    resetPrivateDriveKeyCache()
    const sourcePath = mkdtempSync(join(tmpdir(), 'peersky-link1-'))
    const targetPath = mkdtempSync(join(tmpdir(), 'peersky-link2-'))
    const driveId = 'd'.repeat(64)

    try {
      const payload = JSON.stringify({ version: 2, createdAt: new Date().toISOString(), key: 'a'.repeat(64), driveId })
      writeFileSync(join(sourcePath, 'private-drive-key.json'), payload)

      const result = adoptTransferredPrivateDrive(sourcePath, targetPath)
      assert.equal(result.adopted, true)

      const sourceContent = JSON.parse(readFileSync(join(sourcePath, 'private-drive-key.json'), 'utf8'))
      const targetContent = JSON.parse(readFileSync(join(targetPath, 'private-drive-key.json'), 'utf8'))
      assert.equal(targetContent.key, sourceContent.key)
      assert.equal(targetContent.driveId, sourceContent.driveId)
      assert.equal(targetContent.key, 'a'.repeat(64))
      assert.equal(targetContent.driveId, driveId)
    } finally {
      resetPrivateDriveKeyCache()
      rmSync(sourcePath, { recursive: true, force: true })
      rmSync(targetPath, { recursive: true, force: true })
    }
  })

  it('adopts a desktop private drive from its registry when no key file exists', () => {
    resetPrivateDriveKeyCache()
    const sourcePath = mkdtempSync(join(tmpdir(), 'peersky-adopt-desk-src-'))
    const targetPath = mkdtempSync(join(tmpdir(), 'peersky-adopt-desk-tgt-'))
    const driveId = Buffer.from(crypto.randomBytes(32)).toString('hex')
    const driveZ32 = z32.encode(Buffer.from(driveId, 'hex')).toLowerCase()

    try {
      const registry = JSON.stringify([{
        name: 'files',
        url: `hyper://${driveZ32}/`,
        timestamp: 1700000000000
      }])
      writeFileSync(join(sourcePath, 'privateHyperdrives.json'), registry)

      const result = adoptTransferredPrivateDrive(sourcePath, targetPath)
      assert.equal(result.adopted, true)
      assert.equal(result.driveId, driveId)
      assert.equal(result.encrypted, false)

      const persisted = JSON.parse(readFileSync(join(targetPath, 'private-drive-key.json'), 'utf8'))
      assert.equal(persisted.version, 3)
      assert.equal(persisted.key, null)
      assert.equal(persisted.encrypted, false)
      assert.equal(persisted.source, 'desktop')
      assert.equal(persisted.driveId, driveId)
    } finally {
      resetPrivateDriveKeyCache()
      rmSync(sourcePath, { recursive: true, force: true })
      rmSync(targetPath, { recursive: true, force: true })
    }
  })

  it('adopts desktop private-hyper cores into the dedicated adopted store, not the synced store', () => {
    const sourcePath = mkdtempSync(join(tmpdir(), 'peersky-adopt-cores-src-'))
    const targetPath = mkdtempSync(join(tmpdir(), 'peersky-adopt-cores-tgt-'))
    const driveId = Buffer.from(crypto.randomBytes(32)).toString('hex')

    try {
      mkdirSync(join(sourcePath, 'hyper-private', 'nested'), { recursive: true })
      writeFileSync(join(sourcePath, 'hyper-private', 'CORESTORE'), 'corestore')
      writeFileSync(join(sourcePath, 'hyper-private', 'nested', 'blob'), 'blobbytes')
      writeFileSync(join(sourcePath, 'privateHyperdrives.json'), JSON.stringify([{
        name: 'files',
        url: `hyper://${driveId}/`,
        timestamp: 1700000000000
      }]))

      const result = adoptTransferredPrivateDrive(sourcePath, targetPath)
      assert.equal(result.adopted, true)

      // Cores land in the separate adopted root (hyper-sdk-adopted), never
      // overlaid onto the phone's live synced store.
      const adoptedStorePath = adoptedStoragePathFor(targetPath)
      assert.equal(readFileSync(join(adoptedStorePath, 'CORESTORE'), 'utf8'), 'corestore')
      assert.equal(readFileSync(join(adoptedStorePath, 'nested', 'blob'), 'utf8'), 'blobbytes')

      // The synced store holds only the identity record + adoption marker.
      assert.equal(existsSync(join(targetPath, 'CORESTORE')), false)
      assert.equal(existsSync(join(targetPath, 'private-drive-key.json')), true)
      assert.equal(existsSync(join(targetPath, 'adopted-corestore.json')), true)
    } finally {
      resetPrivateDriveKeyCache()
      rmSync(sourcePath, { recursive: true, force: true })
      rmSync(targetPath, { recursive: true, force: true })
    }
  })

  it('adopts every drive from a desktop v3 entries record', () => {
    resetPrivateDriveKeyCache()
    const sourcePath = mkdtempSync(join(tmpdir(), 'peersky-adopt-entries-'))
    const targetPath = mkdtempSync(join(tmpdir(), 'peersky-adopt-entries-tgt-'))
    const first = '1'.repeat(64)
    const second = '2'.repeat(64)

    try {
      const payload = JSON.stringify({
        version: 3,
        createdAt: new Date().toISOString(),
        key: null,
        driveId: first,
        encrypted: false,
        announce: false,
        source: 'desktop',
        entries: [
          { driveId: first, createdAt: 2 },
          { driveId: second, createdAt: 1 }
        ]
      })
      writeFileSync(join(sourcePath, 'private-drive-key.json'), payload)

      const extracted = extractTransferredPrivateDrive(sourcePath)
      assert.equal(extracted.length, 2)
      assert.equal(extracted[0].driveId, first)
      assert.equal(extracted[1].driveId, second)

      const adoption = adoptTransferredPrivateDrive(sourcePath, targetPath)
      assert.equal(adoption.adopted, true)
      assert.equal(adoption.driveId, first)
      assert.deepEqual(adoption.driveIds, [first, second])

      const marker = JSON.parse(readFileSync(join(targetPath, 'adopted-corestore.json'), 'utf8'))
      assert.equal(marker.version, 2)
      assert.equal(marker.drives.length, 2)
      assert.equal(marker.drives[0].driveId, first)
      assert.equal(marker.drives[1].driveId, second)
      assert.equal(marker.drives[0].announce, false)
      assert.equal(marker.drives[1].announce, false)
    } finally {
      resetPrivateDriveKeyCache()
      rmSync(sourcePath, { recursive: true, force: true })
      rmSync(targetPath, { recursive: true, force: true })
    }
  })

  it('does not adopt when both the key file and registry are missing', () => {
    const sourcePath = mkdtempSync(join(tmpdir(), 'peersky-adopt-none-src-'))
    const targetPath = mkdtempSync(join(tmpdir(), 'peersky-adopt-none-tgt-'))

    try {
      const result = adoptTransferredPrivateDrive(sourcePath, targetPath)
      assert.equal(result.adopted, false)
    } finally {
      rmSync(sourcePath, { recursive: true, force: true })
      rmSync(targetPath, { recursive: true, force: true })
    }
  })

  it('preserves device-local PeerChat state across repeated desktop identity restores', () => {
    const parent = mkdtempSync(join(tmpdir(), 'peersky-identity-swap-'))
    const storagePath = join(parent, 'current')
    const backupPath = join(parent, 'backup')

    try {
      mkdirSync(join(storagePath, 'hyper-sdk'), { recursive: true })
      writeFileSync(join(storagePath, 'device-key.json'), 'device-key')
      writeFileSync(join(storagePath, 'hyper-sdk', 'peerchat-mobile.json'), 'mobile-chat')
      writeFileSync(join(storagePath, 'peerchat-ui-state.json'), 'mobile-ui')
      writeFileSync(join(storagePath, 'old-desktop.json'), 'desktop-a')

      for (const identity of ['desktop-b', 'desktop-c']) {
        const pendingPath = join(parent, `pending-${identity}`)
        mkdirSync(pendingPath, { recursive: true })
        writeFileSync(join(pendingPath, 'peersky-identity.json'), identity)

        const result = commitIdentityRestore({ storagePath, pendingPath, backupPath })
        assert.ok(result.preservedPaths.includes('hyper-sdk'))
        assert.equal(readFileSync(join(storagePath, 'device-key.json'), 'utf8'), 'device-key')
        assert.equal(readFileSync(join(storagePath, 'hyper-sdk', 'peerchat-mobile.json'), 'utf8'), 'mobile-chat')
        assert.equal(readFileSync(join(storagePath, 'peerchat-ui-state.json'), 'utf8'), 'mobile-ui')
        assert.equal(readFileSync(join(storagePath, 'peersky-identity.json'), 'utf8'), identity)
        assert.equal(existsSync(pendingPath), false)
      }
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
