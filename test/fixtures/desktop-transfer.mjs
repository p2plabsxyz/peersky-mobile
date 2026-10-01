// Builds an identity transfer the way PeerSky Desktop does
// (src/backup/identity-transfer.js): an inner zip of profile files, encrypted
// with AES-256-GCM under a random key, the key sealed to the phone's
// encryption key, the metadata signed, and the lot zipped with deflate.
import crypto from 'node:crypto'
import { crc32, deflateRawSync } from 'node:zlib'
import sodium from 'sodium-native'

export function createZip (entries, { deflate = true } = {}) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const { name, data = null } of entries) {
    const nameBytes = Buffer.from(name)
    const isDirectory = name.endsWith('/')
    const content = isDirectory ? Buffer.alloc(0) : Buffer.from(data)
    const method = deflate && !isDirectory ? 8 : 0
    const stored = method === 8 ? deflateRawSync(content) : content
    const checksum = crc32(content)

    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    nameBytes.copy(local, 30)

    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)

    locals.push(local, stored)
    centrals.push(central)
    offset += local.length + stored.length
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, directory, end])
}

export function createDeviceKeys () {
  const keys = {
    signing: { publicKey: Buffer.alloc(32), secretKey: Buffer.alloc(64) },
    encryption: { publicKey: Buffer.alloc(32), secretKey: Buffer.alloc(32) }
  }
  sodium.crypto_sign_keypair(keys.signing.publicKey, keys.signing.secretKey)
  sodium.crypto_box_keypair(keys.encryption.publicKey, keys.encryption.secretKey)
  return keys
}

export function canonicalJson (value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * files: [{ name, data }] for the inner zip, directories end in '/'.
 * Returns { bytes, verificationCode }.
 */
export function createDesktopTransfer ({
  files,
  targetEncryptionPublicKey,
  nonce,
  desktopKeys = createDeviceKeys(),
  issuedAt = Date.now(),
  ttlMs = 10 * 60 * 1000
}) {
  const innerManifest = { version: '1.0.0', peerskyVersion: 'test', createdAt: new Date().toISOString(), files: {} }
  const inner = createZip([...files, { name: 'manifest.json', data: JSON.stringify(innerManifest) }])

  const contentKey = crypto.randomBytes(32)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', contentKey, iv)
  const payload = Buffer.concat([cipher.update(inner), cipher.final()])
  const authTag = cipher.getAuthTag()

  const encryptedKey = Buffer.alloc(32 + sodium.crypto_box_SEALBYTES)
  sodium.crypto_box_seal(encryptedKey, contentKey, Buffer.from(targetEncryptionPublicKey, 'hex'))

  const transfer = {
    version: 1,
    identityId: crypto.randomBytes(32).toString('hex'),
    sourceSigningPublicKey: desktopKeys.signing.publicKey.toString('hex'),
    sourceEncryptionPublicKey: desktopKeys.encryption.publicKey.toString('hex'),
    targetDeviceType: 'mobile',
    targetEncryptionPublicKey,
    channel: crypto.randomBytes(32).toString('hex'),
    nonce,
    issuedAt,
    expiresAt: issuedAt + ttlMs,
    encryptedKey: encryptedKey.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    payloadSha256: crypto.createHash('sha256').update(payload).digest('hex')
  }
  const signature = Buffer.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(signature, Buffer.from(canonicalJson(transfer)), desktopKeys.signing.secretKey)

  const manifest = {
    version: '1.0.0',
    kind: 'peersky-identity-transfer',
    peerskyVersion: 'test',
    createdAt: new Date().toISOString(),
    identityTransfer: { ...transfer, signature: signature.toString('hex') }
  }

  const verificationCode = crypto.createHash('sha256').update(Buffer.concat([
    desktopKeys.signing.publicKey,
    Buffer.from(targetEncryptionPublicKey, 'hex'),
    Buffer.from(nonce, 'hex')
  ])).digest('hex').slice(0, 6).toUpperCase()

  return {
    bytes: wrapDesktopTransfer(manifest, payload),
    manifest,
    payload,
    verificationCode
  }
}

export function wrapDesktopTransfer (manifest, payload) {
  return createZip([
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
    { name: 'identity-payload.bin', data: payload }
  ])
}
