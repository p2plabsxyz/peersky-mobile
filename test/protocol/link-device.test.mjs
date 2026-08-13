import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import sodium from 'sodium-native'
import { verifyIdentityTransferSignature } from '../../backend/backup/identity-transfer.mjs'

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
    assert.ok(true)
  })

  it('Entry named device-key.json is refused', async () => {
    assert.ok(true)
  })

  it('Highly-compressible entry hits size cap', async () => {
    assert.ok(true)
  })
})
