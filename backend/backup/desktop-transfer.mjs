import { closeSync, mkdirSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { createDecipheriv, createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import b4a from 'b4a'
import sodium from 'sodium-native'
import { openZipFile } from './zip-file.mjs'
import {
  IDENTITY_PAYLOAD_NAME,
  IDENTITY_TRANSFER_KIND,
  MANIFEST_NAME,
  deriveVerificationCode,
  verifyIdentityTransferSignature
} from './identity-transfer.mjs'
import { classifyDesktopEntry, desktopConversionFor, listStagedNames } from './restore.mjs'

const MAX_TTL = 15 * 60 * 1000
const HEX = (length) => new RegExp(`^[0-9a-f]{${length}}$`)

/**
 * Checks everything a desktop transfer says about itself before a byte of it
 * is decrypted: it is for this phone, for the code this phone is showing, in
 * date, and signed by the key whose code both screens will show.
 */
export function verifyDesktopTransfer (manifest, { deviceKeys, expectedNonce, now = Date.now() } = {}) {
  if (!manifest || manifest.kind !== IDENTITY_TRANSFER_KIND) throw new Error('Backup is not an identity transfer')

  const transfer = manifest.identityTransfer
  if (!transfer || typeof transfer !== 'object') throw new Error('Identity transfer metadata is missing')
  if (transfer.version !== 1) {
    throw new Error('This transfer was made by a different PeerSky version. Update both devices and send it again.')
  }
  if (typeof transfer.issuedAt !== 'number' || typeof transfer.expiresAt !== 'number') {
    throw new Error('Identity transfer is missing timestamps')
  }
  if (now > transfer.expiresAt) throw new Error('Identity transfer has expired')
  if (now < transfer.issuedAt - 60000) throw new Error('Identity transfer is issued in the future')
  if (transfer.expiresAt - transfer.issuedAt > MAX_TTL) {
    throw new Error('Identity transfer TTL exceeds maximum allowed duration')
  }

  for (const [field, length] of [
    ['sourceSigningPublicKey', 64],
    ['targetEncryptionPublicKey', 64],
    ['nonce', 32],
    ['encryptedKey', (32 + sodium.crypto_box_SEALBYTES) * 2],
    ['iv', 24],
    ['authTag', 32],
    ['payloadSha256', 64],
    ['signature', sodium.crypto_sign_BYTES * 2]
  ]) {
    if (typeof transfer[field] !== 'string' || !HEX(length).test(transfer[field].toLowerCase())) {
      throw new Error('Identity transfer metadata is invalid')
    }
  }

  if (!expectedNonce || transfer.nonce !== expectedNonce) {
    throw new Error('Identity transfer nonce does not match the QR code')
  }
  if (transfer.targetEncryptionPublicKey !== b4a.toString(deviceKeys.encryption.publicKey, 'hex')) {
    throw new Error('Identity transfer is encrypted for a different device')
  }
  if (!verifyIdentityTransferSignature(transfer)) throw new Error('Identity transfer signature is invalid')

  return {
    transfer,
    sas: deriveVerificationCode(transfer.sourceSigningPublicKey, transfer.targetEncryptionPublicKey, transfer.nonce)
  }
}

/**
 * Stages a desktop identity transfer from a file on disk.
 *
 * The desktop encrypts with AES-256-GCM, and bare-crypto only does GCM in one
 * piece, in memory. GCM is counter mode plus a tag, so the payload is
 * decrypted here as AES-256-CTR, starting at the counter GCM uses for the
 * first block, which streams. The tag is not what vouches for the bytes: the
 * SHA-256 of the encrypted payload is in the signed manifest, and the
 * decrypted result is only kept if that hash matches.
 */
export async function stageDesktopTransferFile ({
  filePath,
  stagingPath,
  deviceKeys,
  expectedNonce,
  now = Date.now()
} = {}) {
  const innerPath = `${stagingPath}.inner.zip`
  const outer = openZipFile(filePath)
  let contentKey = null

  try {
    const manifestEntry = outer.find(MANIFEST_NAME)
    if (!manifestEntry) throw new Error('Identity transfer is missing manifest.json')
    let manifest
    try {
      manifest = JSON.parse(b4a.toString(await outer.readEntry(manifestEntry, 1024 * 1024), 'utf8'))
    } catch {
      throw new Error('Identity transfer manifest is damaged')
    }

    const { transfer, sas } = verifyDesktopTransfer(manifest, { deviceKeys, expectedNonce, now })
    const payloadEntry = outer.find(IDENTITY_PAYLOAD_NAME)
    if (!payloadEntry) throw new Error('Identity transfer is missing identity-payload.bin')

    contentKey = b4a.alloc(32)
    const opened = sodium.crypto_box_seal_open(
      contentKey,
      b4a.from(transfer.encryptedKey, 'hex'),
      deviceKeys.encryption.publicKey,
      deviceKeys.encryption.secretKey
    )
    if (!opened) throw new Error('Could not decrypt identity transfer key')

    rmSync(stagingPath, { recursive: true, force: true })
    mkdirSync(stagingPath, { recursive: true })
    rmSync(innerPath, { force: true })

    const counter = b4a.concat([b4a.from(transfer.iv, 'hex'), b4a.from([0, 0, 0, 2])])
    const decipher = createDecipheriv('aes-256-ctr', contentKey, counter)
    const hash = createHash('sha256')
    const fd = openSync(innerPath, 'w')
    try {
      await outer.streamEntry(payloadEntry, (chunk) => {
        hash.update(chunk)
        writeAll(fd, decipher.update(chunk))
      })
      writeAll(fd, decipher.final())
    } finally {
      closeSync(fd)
    }
    if (hash.digest('hex') !== transfer.payloadSha256.toLowerCase()) {
      throw new Error('Identity transfer payload checksum mismatch')
    }

    const restoredFiles = await unpackDesktopPayload(innerPath, stagingPath)
    if (restoredFiles === 0) throw new Error('Decrypted backup did not contain any restorable files')

    return { sas, restoredFiles, names: listStagedNames(stagingPath) }
  } catch (error) {
    rmSync(stagingPath, { recursive: true, force: true })
    throw error
  } finally {
    outer.close()
    rmSync(innerPath, { force: true })
    if (contentKey) sodium.sodium_memzero(contentKey)
  }
}

async function unpackDesktopPayload (innerPath, stagingPath) {
  const inner = openZipFile(innerPath)
  let restoredFiles = 0

  try {
    for (const entry of inner.entries) {
      const name = normalizeEntryName(entry.name)
      if (!name || name === MANIFEST_NAME) continue

      const action = classifyDesktopEntry(name)
      if (action === 'refuse') throw new Error('Refusing to restore device-key.json from backup')
      if (action === 'unknown') throw new Error(`Refusing to restore unknown file: ${name}`)
      if (action === 'ignore') continue

      if (entry.isDirectory) {
        mkdirSync(join(stagingPath, name), { recursive: true })
        continue
      }

      if (action === 'convert') {
        const conversion = desktopConversionFor(name)
        const converted = conversion.convert(await inner.readEntry(entry))
        if (!converted) continue
        writeFileSync(join(stagingPath, conversion.name), converted)
        restoredFiles += 1
        continue
      }

      const target = join(stagingPath, name)
      mkdirSync(dirname(target), { recursive: true })
      const fd = openSync(target, 'w')
      try {
        await inner.streamEntry(entry, (chunk) => writeAll(fd, chunk))
      } finally {
        closeSync(fd)
      }
      restoredFiles += 1
    }
  } finally {
    inner.close()
  }

  return restoredFiles
}

function normalizeEntryName (name) {
  const parts = []
  for (const part of String(name || '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') throw new Error('Backup contains illegal path traversal entries')
    parts.push(part)
  }
  return parts.join('/')
}

function writeAll (fd, bytes) {
  let offset = 0
  while (offset < bytes.byteLength) offset += writeSync(fd, bytes, offset, bytes.byteLength - offset)
}
