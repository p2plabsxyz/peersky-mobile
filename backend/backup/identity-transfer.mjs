import { createDecipheriv, createHash } from 'node:crypto'
import sodium from 'sodium-native'
import b4a from 'b4a'
import { readZipFile } from './zip.mjs'
import { getEncryptionPublicKeyHex } from './device-keys.mjs'

export const IDENTITY_TRANSFER_KIND = 'peersky-identity-transfer'
export const IDENTITY_PAYLOAD_NAME = 'identity-payload.bin'
export const MANIFEST_NAME = 'manifest.json'

export async function decryptIdentityTransfer (zipBytes, keys) {
  const manifestBytes = readZipFile(zipBytes, MANIFEST_NAME)
  if (!manifestBytes) throw new Error('Identity transfer is missing manifest.json')

  const manifest = JSON.parse(b4a.toString(manifestBytes, 'utf8'))
  if (!manifest || manifest.kind !== IDENTITY_TRANSFER_KIND) {
    throw new Error('Backup is not an identity transfer')
  }

  const transfer = manifest.identityTransfer
  if (!transfer || typeof transfer !== 'object') {
    throw new Error('Identity transfer metadata is missing')
  }

  if (typeof transfer.expiresAt !== 'number' || Date.now() > transfer.expiresAt) {
    throw new Error('Identity transfer has expired')
  }

  const expectedTargetKey = getEncryptionPublicKeyHex(keys)
  if (transfer.targetEncryptionPublicKey !== expectedTargetKey) {
    throw new Error('Identity transfer is encrypted for a different device')
  }

  if (!verifyIdentityTransferSignature(transfer)) {
    throw new Error('Identity transfer signature is invalid')
  }

  const encryptedPayload = readZipFile(zipBytes, IDENTITY_PAYLOAD_NAME)
  if (!encryptedPayload) throw new Error('Identity transfer is missing identity-payload.bin')

  const actualHash = sha256Hex(encryptedPayload)
  if (actualHash !== transfer.payloadSha256) {
    throw new Error('Identity transfer payload checksum mismatch')
  }

  const sealedKey = fromHex(transfer.encryptedKey, 'encrypted key')
  if (sealedKey.byteLength <= sodium.crypto_box_SEALBYTES) {
    throw new Error('Identity transfer encrypted key is too short')
  }

  const contentKey = b4a.alloc(sealedKey.byteLength - sodium.crypto_box_SEALBYTES)
  const opened = sodium.crypto_box_seal_open(
    contentKey,
    sealedKey,
    keys.encryption.publicKey,
    keys.encryption.secretKey
  )

  if (!opened) throw new Error('Could not decrypt identity transfer key')
  if (contentKey.byteLength !== 32) throw new Error('Identity transfer content key must be 32 bytes')

  const iv = fromHex(transfer.iv, 'AES-GCM IV')
  const authTag = fromHex(transfer.authTag, 'AES-GCM auth tag')
  if (iv.byteLength !== 12) throw new Error('Identity transfer AES-GCM IV must be 12 bytes')
  if (authTag.byteLength !== 16) throw new Error('Identity transfer AES-GCM auth tag must be 16 bytes')

  return decryptAes256Gcm(encryptedPayload, contentKey, iv, authTag)
}

export function verifyIdentityTransferSignature (transfer) {
  const signature = fromHex(transfer.signature, 'identity transfer signature')
  const publicKey = fromHex(transfer.sourceSigningPublicKey, 'source signing public key')
  const message = b4a.from(canonicalJson(transferBody(transfer)), 'utf8')

  return sodium.crypto_sign_verify_detached(signature, message, publicKey)
}

function decryptAes256Gcm (ciphertext, key, iv, authTag) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  const first = decipher.update(ciphertext)
  const final = decipher.final()

  if (!first.byteLength) return new Uint8Array(final)
  if (!final.byteLength) return new Uint8Array(first)

  const out = new Uint8Array(first.byteLength + final.byteLength)
  out.set(first, 0)
  out.set(final, first.byteLength)
  return out
}

function transferBody (transfer) {
  return {
    version: transfer.version,
    identityId: transfer.identityId,
    sourceSigningPublicKey: transfer.sourceSigningPublicKey,
    sourceEncryptionPublicKey: transfer.sourceEncryptionPublicKey,
    targetDeviceType: transfer.targetDeviceType,
    targetEncryptionPublicKey: transfer.targetEncryptionPublicKey,
    channel: transfer.channel,
    nonce: transfer.nonce,
    issuedAt: transfer.issuedAt,
    expiresAt: transfer.expiresAt,
    encryptedKey: transfer.encryptedKey,
    iv: transfer.iv,
    authTag: transfer.authTag,
    payloadSha256: transfer.payloadSha256
  }
}

function canonicalJson (value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256Hex (bytes) {
  return b4a.toString(createHash('sha256').update(bytes).digest(), 'hex')
}

function fromHex (value, name) {
  if (!value || typeof value !== 'string' || !/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error(`Invalid ${name}`)
  }

  return b4a.from(value, 'hex')
}
