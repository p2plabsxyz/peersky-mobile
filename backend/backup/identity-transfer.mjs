import { createHash } from 'node:crypto'
import sodium from 'sodium-native'
import b4a from 'b4a'

// What the desktop's identity transfer and the phone's share: the names in
// the archive, the signature check and the six character code. Receiving a
// desktop transfer is desktop-transfer.mjs; a phone's own is phone-backup.mjs.
export const IDENTITY_TRANSFER_KIND = 'peersky-identity-transfer'
export const IDENTITY_PAYLOAD_NAME = 'identity-payload.bin'
export const MANIFEST_NAME = 'manifest.json'

/**
 * The six characters both screens show. The desktop derives it the same way:
 * the first three bytes of sha256(source signing key, target key, nonce).
 */
export function deriveVerificationCode (sourceSigningPublicKey, targetEncryptionPublicKey, nonce) {
  const input = b4a.concat([
    fromHex(sourceSigningPublicKey, 'source signing public key', sodium.crypto_sign_PUBLICKEYBYTES),
    fromHex(targetEncryptionPublicKey, 'target encryption public key', sodium.crypto_box_PUBLICKEYBYTES),
    fromHex(nonce, 'nonce', 16)
  ])
  return b4a.toString(createHash('sha256').update(input).digest(), 'hex').slice(0, 6).toUpperCase()
}

export function verifyIdentityTransferSignature (transfer) {
  const signature = fromHex(transfer.signature, 'identity transfer signature', sodium.crypto_sign_BYTES)
  const publicKey = fromHex(transfer.sourceSigningPublicKey, 'source signing public key', sodium.crypto_sign_PUBLICKEYBYTES)
  const message = b4a.from(canonicalJson(transferBody(transfer)), 'utf8')

  return sodium.crypto_sign_verify_detached(signature, message, publicKey)
}

export function transferBody (transfer) {
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

export function canonicalJson (value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function fromHex (value, name, expectedLength) {
  if (!value || typeof value !== 'string' || !/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error(`Invalid ${name}`)
  }
  if (expectedLength !== undefined && value.length !== expectedLength * 2) {
    throw new Error(`Invalid ${name} length`)
  }

  return b4a.from(value, 'hex')
}
