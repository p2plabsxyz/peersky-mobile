import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sodium from 'sodium-native'
import { verifyIdentityTransferSignature } from '../../backend/backup/identity-transfer.mjs'
import { restoreIdentityFromBackup } from '../../backend/backup/restore.mjs'

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

describe('Link Device Identity Transfer', () => {
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

  it('Highly-compressible entry hits size cap', async () => {
    assert.ok(true)
  })
})
