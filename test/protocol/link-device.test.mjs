import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sodium from 'sodium-native'
import z32 from 'z32'
import { createMobilePairingCode } from '../../app/settings/identity-pairing.mjs'
import { verifyIdentityTransferSignature } from '../../backend/backup/identity-transfer.mjs'
import { extractTransferredPrivateDrive, adoptTransferredPrivateDrive } from '../../backend/backup/private-drive-import.mjs'
import { resetPrivateDriveKeyCache, getPrivateDriveKeyRecord } from '../../backend/hyper/private-keys.mjs'
import { adoptedStoragePathFor, readSyncedPrivateAdoptedDrives } from '../../backend/hyper/runtime-routing.mjs'
import { commitStagedRestore, RESTORE_STAGING_DIR } from '../../backend/backup/restore.mjs'
import { stageDesktopTransferFile } from '../../backend/backup/desktop-transfer.mjs'
import { createDesktopTransfer, createDeviceKeys, wrapDesktopTransfer } from '../fixtures/desktop-transfer.mjs'

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

// A phone waiting for a desktop transfer: its keys, the code it is showing,
// and somewhere to stage what arrives.
function createPhoneReceiver (t) {
  const root = mkdtempSync(join(tmpdir(), 'peersky-desktop-transfer-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const keys = createDeviceKeys()
  const nonce = toHex(crypto.randomBytes(16))
  const stagingPath = join(root, 'documents', RESTORE_STAGING_DIR)
  mkdirSync(join(root, 'documents'), { recursive: true })

  return {
    keys,
    nonce,
    stagingPath,
    publicKey: toHex(keys.encryption.publicKey),
    async stage (bytes) {
      const filePath = join(root, `transfer-${Date.now()}-${Math.random()}.zip`)
      writeFileSync(filePath, bytes)
      return stageDesktopTransferFile({ filePath, stagingPath, deviceKeys: keys, expectedNonce: nonce })
    }
  }
}

describe('Link Device Identity Transfer', () => {
  it('creates a complete mobile pairing code for QR and clipboard use', () => {
    const publicKey = 'AA'.repeat(32)
    const nonce = 'BB'.repeat(16)

    assert.equal(
      createMobilePairingCode(publicKey, nonce),
      `peersky-identity:${'aa'.repeat(32)}?nonce=${'bb'.repeat(16)}&deviceType=mobile&chat=1&notes=1`
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

  it('Expired transfer is rejected', async (t) => {
    const phone = createPhoneReceiver(t)
    const issuedAt = Date.now() - 20 * 60 * 1000
    const { bytes } = createDesktopTransfer({
      files: [{ name: 'peersky-identity.json', data: '{}' }],
      targetEncryptionPublicKey: phone.publicKey,
      nonce: phone.nonce,
      issuedAt,
      ttlMs: 10 * 60 * 1000
    })

    await assert.rejects(phone.stage(bytes), /Identity transfer has expired/)
    assert.equal(existsSync(phone.stagingPath), false)
  })

  it('Wrong targetEncryptionPublicKey is rejected', async (t) => {
    const phone = createPhoneReceiver(t)
    const someoneElse = createDeviceKeys()
    const { bytes } = createDesktopTransfer({
      files: [{ name: 'peersky-identity.json', data: '{}' }],
      targetEncryptionPublicKey: toHex(someoneElse.encryption.publicKey),
      nonce: phone.nonce
    })

    await assert.rejects(phone.stage(bytes), /encrypted for a different device/)
  })

  it('A transfer made for an older pairing code is rejected', async (t) => {
    const phone = createPhoneReceiver(t)
    const { bytes } = createDesktopTransfer({
      files: [{ name: 'peersky-identity.json', data: '{}' }],
      targetEncryptionPublicKey: phone.publicKey,
      nonce: toHex(crypto.randomBytes(16))
    })

    await assert.rejects(phone.stage(bytes), /nonce does not match/)
  })

  it('Flipped byte in payload is caught before anything is restored', async (t) => {
    const phone = createPhoneReceiver(t)
    const { bytes } = createDesktopTransfer({
      files: [{ name: 'peersky-identity.json', data: JSON.stringify({ identityId: 'x'.repeat(64) }) }],
      targetEncryptionPublicKey: phone.publicKey,
      nonce: phone.nonce
    })
    // The payload is the second entry: flip a byte inside its data.
    const payloadStart = bytes.indexOf(Buffer.from('identity-payload.bin')) + 'identity-payload.bin'.length
    const flipped = Buffer.from(bytes)
    flipped[payloadStart + 8] ^= 0x01

    await assert.rejects(phone.stage(flipped), /checksum mismatch|invalid|incorrect|size mismatch/i)
    assert.equal(existsSync(phone.stagingPath), false)
  })

  it('A forged manifest is rejected even with a valid-looking payload', async (t) => {
    const phone = createPhoneReceiver(t)
    const { manifest, payload } = createDesktopTransfer({
      files: [{ name: 'peersky-identity.json', data: '{}' }],
      targetEncryptionPublicKey: phone.publicKey,
      nonce: phone.nonce
    })

    // Someone else's key in the manifest: the code on screen would change, and
    // the signature no longer verifies.
    const swapped = structuredClone(manifest)
    swapped.identityTransfer.sourceSigningPublicKey = 'a'.repeat(64)
    await assert.rejects(phone.stage(wrapDesktopTransfer(swapped, payload)), /signature is invalid/)

    // A payload swapped for another under the same signed manifest.
    await assert.rejects(
      phone.stage(wrapDesktopTransfer(manifest, crypto.randomBytes(payload.length))),
      /payload checksum mismatch/
    )
  })

  it('Restores a desktop transfer from disk: private drives and identity, tabs as a list to add', async (t) => {
    const phone = createPhoneReceiver(t)
    const registry = JSON.stringify([{ name: 'private', url: `hyper://${'e'.repeat(64)}/`, timestamp: 1 }])
    const desktopTabs = JSON.stringify({
      main: {
        tabs: [
          { id: 'tab-1', url: 'https://example.com/', title: 'Example' },
          { id: 'tab-2', url: 'peersky://settings', title: 'Settings' },
          { id: 'tab-3', url: `hyper://${'b'.repeat(52)}/`, title: 'A hyper site' }
        ],
        activeTabId: 'tab-1'
      },
      'window-2': { tabs: [{ id: 'tab-9', url: 'https://example.com/', title: 'Duplicate' }] }
    })
    const { bytes, verificationCode } = createDesktopTransfer({
      files: [
        { name: 'peersky-identity.json', data: JSON.stringify({ version: 1, identityId: 'a'.repeat(64) }) },
        { name: 'privateHyperdrives.json', data: registry },
        { name: 'hyper-private/', data: null },
        { name: 'hyper-private/db/000001.sst', data: 'private core' },
        { name: 'tabs.json', data: desktopTabs },
        { name: 'lastOpened.json', data: '[]' },
        { name: 'peersky-chat-rooms.json', data: '[]' },
        // The person's PeerChat, for PeerChat here to take on its next start.
        { name: 'peerchat-incoming.json', data: '{"version":1}' },
        // Their recent P2PMD notes, for the app to take once the backend is up.
        { name: 'p2pmd-incoming.json', data: '{"version":1,"notes":[]}' },
        // The desktop's own store. The phone never used it, and it can be huge.
        { name: 'hyper/', data: null },
        { name: 'hyper/db/000002.sst', data: 'desktop public core' }
      ],
      targetEncryptionPublicKey: phone.publicKey,
      nonce: phone.nonce
    })

    const staged = await phone.stage(bytes)
    assert.equal(staged.sas, verificationCode)
    assert.deepEqual(staged.names, ['hyper-private', 'incoming-tabs.json', 'p2pmd-incoming.json', 'peerchat-incoming.json', 'peersky-identity.json', 'privateHyperdrives.json'])
    assert.equal(existsSync(join(phone.stagingPath, 'hyper')), false)
    assert.equal(existsSync(join(phone.stagingPath, 'tabs.json')), false)
    assert.equal(existsSync(join(phone.stagingPath, 'browser-tabs.json')), false)

    const incoming = JSON.parse(readFileSync(join(phone.stagingPath, 'incoming-tabs.json'), 'utf8'))
    assert.deepEqual(incoming.tabs, [
      { url: 'https://example.com/', title: 'Example' },
      { url: `hyper://${'b'.repeat(52)}/`, title: 'A hyper site' }
    ])
    assert.equal(readFileSync(join(phone.stagingPath, 'hyper-private/db/000001.sst'), 'utf8'), 'private core')
    assert.equal(existsSync(`${phone.stagingPath}.inner.zip`), false)
  })

  it('Streams a large desktop transfer instead of holding it in memory', async (t) => {
    const phone = createPhoneReceiver(t)
    const large = crypto.randomBytes(24 * 1024 * 1024)
    const { bytes } = createDesktopTransfer({
      files: [
        { name: 'peersky-identity.json', data: '{}' },
        { name: 'hyper-private/db/large.sst', data: large }
      ],
      targetEncryptionPublicKey: phone.publicKey,
      nonce: phone.nonce
    })

    await phone.stage(bytes)
    const restored = readFileSync(join(phone.stagingPath, 'hyper-private/db/large.sst'))
    assert.equal(restored.length, large.length)
    assert.ok(restored.equals(large))
  })

  it('Entry named ../../evil throws', async (t) => {
    const phone = createPhoneReceiver(t)
    const { bytes } = createDesktopTransfer({
      files: [
        { name: 'peersky-identity.json', data: '{}' },
        { name: 'hyper/../../evil/' }
      ],
      targetEncryptionPublicKey: phone.publicKey,
      nonce: phone.nonce
    })

    await assert.rejects(phone.stage(bytes), /illegal path traversal/)
  })

  it('Restores peersky-identity.json from a desktop transfer', async (t) => {
    const phone = createPhoneReceiver(t)
    const identity = JSON.stringify({ identityId: 'test-identity' })
    const { bytes } = createDesktopTransfer({
      files: [{ name: 'peersky-identity.json', data: identity }],
      targetEncryptionPublicKey: phone.publicKey,
      nonce: phone.nonce
    })

    const result = await phone.stage(bytes)
    assert.equal(result.restoredFiles, 1)
    assert.equal(readFileSync(join(phone.stagingPath, 'peersky-identity.json'), 'utf8'), identity)
  })

  it('Entry named device-key.json is refused', async (t) => {
    const phone = createPhoneReceiver(t)
    const { bytes } = createDesktopTransfer({
      files: [
        { name: 'peersky-identity.json', data: '{}' },
        { name: 'device-key.json', data: '{"signing":{}}' }
      ],
      targetEncryptionPublicKey: phone.publicKey,
      nonce: phone.nonce
    })

    await assert.rejects(phone.stage(bytes), /Refusing to restore device-key.json/)
    assert.equal(existsSync(phone.stagingPath), false)
  })

  it('restores a desktop transfer larger than 50 MB', async (t) => {
    const phone = createPhoneReceiver(t)
    const size = 50 * 1024 * 1024 + 1
    const { bytes } = createDesktopTransfer({
      files: [{ name: 'hyper-private/large-core', data: Buffer.alloc(size) }],
      targetEncryptionPublicKey: phone.publicKey,
      nonce: phone.nonce
    })

    const result = await phone.stage(bytes)
    assert.equal(result.restoredFiles, 1)
    assert.equal(statSync(join(phone.stagingPath, 'hyper-private/large-core')).size, size)
  })

  it('restores desktop private-hyper corestore from an identity transfer', async (t) => {
    const phone = createPhoneReceiver(t)
    const { bytes } = createDesktopTransfer({
      files: [{ name: 'hyper-private/CORESTORE', data: 'corestore' }],
      targetEncryptionPublicKey: phone.publicKey,
      nonce: phone.nonce
    })

    const result = await phone.stage(bytes)
    assert.equal(result.restoredFiles, 1)
    assert.equal(readFileSync(join(phone.stagingPath, 'hyper-private/CORESTORE'), 'utf8'), 'corestore')
  })

  it('restores privateHyperdrives.json from an identity transfer', async (t) => {
    const phone = createPhoneReceiver(t)
    const registry = JSON.stringify([{ name: 'private', url: 'hyper://entry', timestamp: 1 }])
    const { bytes } = createDesktopTransfer({
      files: [{ name: 'privateHyperdrives.json', data: registry }],
      targetEncryptionPublicKey: phone.publicKey,
      nonce: phone.nonce
    })

    const result = await phone.stage(bytes)
    assert.equal(result.restoredFiles, 1)
    assert.equal(readFileSync(join(phone.stagingPath, 'privateHyperdrives.json'), 'utf8'), registry)
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

      const adopted = readSyncedPrivateAdoptedDrives(targetPath)
      assert.equal(adopted.length, 1)
      assert.equal(adopted[0].key, 'f'.repeat(64))
      assert.equal(adopted[0].driveId, driveId)
      assert.equal(adopted[0].encrypted, true)
      assert.deepEqual(getPrivateDriveKeyRecord(targetPath), { ok: false })
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

      const adopted = readSyncedPrivateAdoptedDrives(targetPath)
      assert.equal(adopted.length, 1)
      assert.equal(adopted[0].key, 'a'.repeat(64))
      assert.equal(adopted[0].driveId, driveId)
      assert.equal(adopted[0].encrypted, true)
      assert.deepEqual(getPrivateDriveKeyRecord(targetPath), { ok: false })
      assert.equal(existsSync(join(targetPath, 'private-drive-key.json')), false)
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

      const adopted = readSyncedPrivateAdoptedDrives(targetPath)
      assert.equal(adopted.length, 1)
      assert.equal(adopted[0].driveId, driveId)
      assert.equal(adopted[0].encrypted, false)
      assert.equal(adopted[0].source, 'desktop')
      assert.deepEqual(getPrivateDriveKeyRecord(targetPath), { ok: false })
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

      assert.equal(existsSync(join(targetPath, 'CORESTORE')), false)
      assert.equal(existsSync(join(targetPath, 'private-drive-key.json')), false)
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

  // A desktop restore only replaces what it brought. It used to rename the
  // whole storage folder away and keep a short list, and that folder is the
  // app's documents: bookmarks, history, settings and downloads went with it.
  it('keeps everything on the phone across repeated desktop identity restores', () => {
    const storagePath = mkdtempSync(join(tmpdir(), 'peersky-identity-swap-'))

    try {
      mkdirSync(join(storagePath, 'hyper-sdk'), { recursive: true })
      mkdirSync(join(storagePath, 'browser-downloads'), { recursive: true })
      writeFileSync(join(storagePath, 'device-key.json'), 'device-key')
      writeFileSync(join(storagePath, 'hyper-sdk', 'peerchat-mobile.json'), 'mobile-chat')
      writeFileSync(join(storagePath, 'peerchat-ui-state.json'), 'mobile-ui')
      writeFileSync(join(storagePath, 'browser-bookmarks.json'), 'bookmarks')
      writeFileSync(join(storagePath, 'browser-history.json'), 'history')
      writeFileSync(join(storagePath, 'browser-preferences.json'), 'settings')
      writeFileSync(join(storagePath, 'browser-downloads', 'file.pdf'), 'pdf')
      writeFileSync(join(storagePath, 'welcome-seen'), '')

      for (const identity of ['desktop-b', 'desktop-c']) {
        const stagingPath = join(storagePath, RESTORE_STAGING_DIR)
        mkdirSync(stagingPath, { recursive: true })
        writeFileSync(join(stagingPath, 'peersky-identity.json'), identity)

        const result = commitStagedRestore({ storagePath, stagingPath, names: ['peersky-identity.json'] })
        assert.deepEqual(result.restored, ['peersky-identity.json'])
        assert.equal(readFileSync(join(storagePath, 'device-key.json'), 'utf8'), 'device-key')
        assert.equal(readFileSync(join(storagePath, 'hyper-sdk', 'peerchat-mobile.json'), 'utf8'), 'mobile-chat')
        assert.equal(readFileSync(join(storagePath, 'peerchat-ui-state.json'), 'utf8'), 'mobile-ui')
        assert.equal(readFileSync(join(storagePath, 'browser-bookmarks.json'), 'utf8'), 'bookmarks')
        assert.equal(readFileSync(join(storagePath, 'browser-history.json'), 'utf8'), 'history')
        assert.equal(readFileSync(join(storagePath, 'browser-preferences.json'), 'utf8'), 'settings')
        assert.equal(readFileSync(join(storagePath, 'browser-downloads', 'file.pdf'), 'utf8'), 'pdf')
        assert.ok(existsSync(join(storagePath, 'welcome-seen')))
        assert.equal(readFileSync(join(storagePath, 'peersky-identity.json'), 'utf8'), identity)
        assert.equal(existsSync(stagingPath), false)
      }
    } finally {
      rmSync(storagePath, { recursive: true, force: true })
    }
  })
})
