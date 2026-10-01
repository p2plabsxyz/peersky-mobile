import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import b4a from 'b4a'
import sodium from 'sodium-native'
import { create as createSDK } from 'hyper-sdk'
import {
  createBackupFileWriter,
  PAYLOAD_OFFSET,
  readBackupFileManifest
} from '../../backend/backup/backup-file.mjs'
import { createArchiveWriter } from '../../backend/backup/backup-archive.mjs'
import {
  createPhoneBackup,
  createPhoneTransfer,
  inspectPhoneBackupFile,
  planPhoneBackup,
  PHONE_BACKUP_FORMAT,
  resolvePhoneEntry,
  stagePhoneBackupFile
} from '../../backend/backup/phone-backup.mjs'
import { commitStagedRestore, RESTORE_STAGING_DIR } from '../../backend/backup/restore.mjs'
import { getDeviceKeys } from '../../backend/backup/device-keys.mjs'
import { parsePairingCode, createPairingCode } from '../../backend/backup/pairing-code.mjs'
import { classifyLinkDeviceCode, createMobilePairingCode } from '../../app/settings/identity-pairing.mjs'

const SWARM_OFF = { bootstrap: [], port: 0 }
const PASSPHRASE = 'correct horse battery staple'

async function withTempDirs (t, count) {
  const root = await mkdtemp(join(tmpdir(), 'peersky-phone-backup-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return Array.from({ length: count }, (_, index) => {
    const path = join(root, `dir-${index}`)
    mkdirSync(path, { recursive: true })
    return path
  })
}

// A phone's documents folder as the app leaves it: browser files the React
// Native side writes, a live Hyper store with a drive, and the PeerChat and
// P2PMD files that sit inside that store.
async function createPhone (documents, t, { drive = 'mydrive', text = 'hello from phone one' } = {}) {
  writeFileSync(join(documents, 'browser-bookmarks.json'), JSON.stringify({ items: [{ url: 'https://example.com/', title: 'Example', createdAt: 1 }] }))
  writeFileSync(join(documents, 'browser-history.json'), JSON.stringify({ version: 1, entries: [] }))
  writeFileSync(join(documents, 'browser-preferences.json'), JSON.stringify({ theme: 'dark' }))
  writeFileSync(join(documents, 'browser-tabs.json'), JSON.stringify({ version: 1, tabs: [] }))
  writeFileSync(join(documents, 'p2pmd-profile.json'), JSON.stringify({ name: 'Sunny Otter' }))
  // This phone's own keys and first-run marker never travel.
  writeFileSync(join(documents, 'device-key.json'), 'phone one device key')
  writeFileSync(join(documents, 'welcome-seen'), '')

  const storage = join(documents, 'hyper-sdk')
  const sdk = await createSDK({ storage, swarmOpts: SWARM_OFF, autoJoin: false })
  const source = await sdk.getDrive(drive)
  await source.put('/note.txt', b4a.from(text))
  const publicKey = b4a.toString(sdk.publicKey, 'hex')
  const driveKey = b4a.toString(source.key, 'hex')
  await sdk.close()

  writeFileSync(join(storage, 'peerchat-mobile.json'), JSON.stringify({ profile: { username: 'otter' } }))
  mkdirSync(join(storage, 'p2pmd-rooms'), { recursive: true })
  writeFileSync(join(storage, 'p2pmd-rooms', 'room.json'), JSON.stringify({ text: '# notes' }))

  return { publicKey, driveKey }
}

function listNames (directory) {
  return existsSync(directory) ? readdirSync(directory).sort() : []
}

describe('phone backups', () => {
  it('moves a whole phone: browser data, the Hyper store, PeerChat and P2PMD', async (t) => {
    const [phoneOne, phoneTwo, outDir] = await withTempDirs(t, 3)
    const original = await createPhone(phoneOne, t)

    // The second phone already has things of its own that are not in the backup.
    writeFileSync(join(phoneTwo, 'device-key.json'), 'phone two device key')
    writeFileSync(join(phoneTwo, 'welcome-seen'), '')
    mkdirSync(join(phoneTwo, 'browser-downloads'), { recursive: true })
    writeFileSync(join(phoneTwo, 'browser-downloads', 'photo.jpg'), 'jpeg')
    writeFileSync(join(phoneTwo, 'browser-bookmarks.json'), 'phone two bookmarks')

    const backupPath = join(outDir, 'phone.peersky')
    const created = await createPhoneBackup({
      storagePath: phoneOne,
      outPath: backupPath,
      passphrase: PASSPHRASE,
      peerskyVersion: '1.2.3',
      platform: 'ios'
    })
    assert.equal(created.path, backupPath)
    assert.ok(created.contents.includes('hyper-sdk'))
    assert.ok(!created.contents.includes('device-key.json'))
    assert.ok(!created.contents.includes('welcome-seen'))
    assert.equal(existsSync(`${backupPath}.partial`), false)

    const inspected = inspectPhoneBackupFile(backupPath)
    assert.equal(inspected.kind, 'backup')
    assert.equal(inspected.needsPassphrase, true)
    assert.equal(inspected.platform, 'ios')
    assert.ok(inspected.contents.includes('browser-bookmarks.json'))

    const stagingPath = join(phoneTwo, RESTORE_STAGING_DIR)
    const staged = await stagePhoneBackupFile({ filePath: backupPath, stagingPath, passphrase: PASSPHRASE })
    assert.equal(staged.kind, 'peersky-encrypted-backup')
    assert.equal(staged.about.peerskyVersion, '1.2.3')
    assert.ok(staged.names.includes('hyper-sdk'))
    // The old store's device file does not travel; a fresh one is written.
    assert.ok(existsSync(join(stagingPath, 'hyper-sdk', 'CORESTORE')))

    // Nothing on the phone changed while staging.
    assert.equal(readFileSync(join(phoneTwo, 'browser-bookmarks.json'), 'utf8'), 'phone two bookmarks')

    commitStagedRestore({ storagePath: phoneTwo, stagingPath, names: staged.names, replace: staged.replace })

    // Restored.
    assert.equal(readFileSync(join(phoneTwo, 'p2pmd-profile.json'), 'utf8'), JSON.stringify({ name: 'Sunny Otter' }))
    assert.match(readFileSync(join(phoneTwo, 'browser-bookmarks.json'), 'utf8'), /example\.com/)
    // Left alone: this phone's own keys, first-run marker and downloads.
    assert.equal(readFileSync(join(phoneTwo, 'device-key.json'), 'utf8'), 'phone two device key')
    assert.ok(existsSync(join(phoneTwo, 'welcome-seen')))
    assert.equal(readFileSync(join(phoneTwo, 'browser-downloads', 'photo.jpg'), 'utf8'), 'jpeg')
    // No leftovers from the swap.
    assert.deepEqual(listNames(phoneTwo).filter((name) => name.startsWith('.')), [])

    // The store opens the ordinary way, with no allowBackup: the check that
    // refuses a copied store is satisfied by the fresh device file.
    const storage = join(phoneTwo, 'hyper-sdk')
    const sdk = await createSDK({ storage, swarmOpts: SWARM_OFF, autoJoin: false })
    t.after(() => sdk.close())
    // Same swarm identity, which is who this person is in PeerChat.
    assert.equal(b4a.toString(sdk.publicKey, 'hex'), original.publicKey)
    const drive = await sdk.getDrive('mydrive')
    assert.equal(b4a.toString(drive.key, 'hex'), original.driveKey)
    assert.equal(b4a.toString(await drive.get('/note.txt')), 'hello from phone one')
    // The drive is still writable here: it moved, it was not copied read-only.
    await drive.put('/after-restore.txt', b4a.from('still mine'))

    // PeerChat state and P2PMD snapshots were not swept into db/ by the
    // storage layer's old-layout migration.
    assert.equal(JSON.parse(readFileSync(join(storage, 'peerchat-mobile.json'), 'utf8')).profile.username, 'otter')
    assert.equal(JSON.parse(readFileSync(join(storage, 'p2pmd-rooms', 'room.json'), 'utf8')).text, '# notes')
    assert.equal(existsSync(join(storage, 'db', 'peerchat-mobile.json')), false)
  })

  it('refuses a wrong passphrase and leaves nothing behind', async (t) => {
    const [phoneOne, phoneTwo, outDir] = await withTempDirs(t, 3)
    await createPhone(phoneOne, t)
    const backupPath = join(outDir, 'phone.peersky')
    await createPhoneBackup({ storagePath: phoneOne, outPath: backupPath, passphrase: PASSPHRASE })

    const stagingPath = join(phoneTwo, RESTORE_STAGING_DIR)
    await assert.rejects(
      stagePhoneBackupFile({ filePath: backupPath, stagingPath, passphrase: 'not the passphrase' }),
      (error) => error.code === 'WRONG_PASSPHRASE' && /does not open this backup/.test(error.message)
    )
    await assert.rejects(
      stagePhoneBackupFile({ filePath: backupPath, stagingPath }),
      (error) => error.code === 'PASSPHRASE_REQUIRED'
    )
    assert.equal(existsSync(stagingPath), false)
  })

  it('needs a passphrase of at least 12 characters', async (t) => {
    const [phoneOne, outDir] = await withTempDirs(t, 2)
    writeFileSync(join(phoneOne, 'browser-bookmarks.json'), '{}')
    await assert.rejects(
      createPhoneBackup({ storagePath: phoneOne, outPath: join(outDir, 'a.peersky'), passphrase: 'short' }),
      (error) => error.code === 'WEAK_PASSPHRASE'
    )
    assert.equal(existsSync(join(outDir, 'a.peersky')), false)
  })

  it('catches a file that was changed or cut short', async (t) => {
    const [phoneOne, phoneTwo, outDir] = await withTempDirs(t, 3)
    await createPhone(phoneOne, t)
    const backupPath = join(outDir, 'phone.peersky')
    await createPhoneBackup({ storagePath: phoneOne, outPath: backupPath, passphrase: PASSPHRASE })
    const bytes = readFileSync(backupPath)
    const stagingPath = join(phoneTwo, RESTORE_STAGING_DIR)

    // One flipped byte deep in the payload fails that frame's authentication.
    const flipped = b4a.from(bytes)
    flipped[bytes.byteLength - 100] ^= 0x01
    writeFileSync(join(outDir, 'flipped.peersky'), flipped)
    await assert.rejects(
      stagePhoneBackupFile({ filePath: join(outDir, 'flipped.peersky'), stagingPath, passphrase: PASSPHRASE }),
      /damaged/
    )

    // Cut off on a frame boundary, so every frame left still authenticates:
    // only the missing final frame gives it away.
    const truncatedPath = join(outDir, 'truncated.peersky')
    writeFileSync(truncatedPath, bytes.subarray(0, lastFrameStart(bytes)))
    await assert.rejects(
      stagePhoneBackupFile({ filePath: truncatedPath, stagingPath, passphrase: PASSPHRASE }),
      /incomplete|cut short/
    )

    // Anything after the final frame is refused too.
    writeFileSync(join(outDir, 'extra.peersky'), b4a.concat([bytes, b4a.from('trailing')]))
    await assert.rejects(
      stagePhoneBackupFile({ filePath: join(outDir, 'extra.peersky'), stagingPath, passphrase: PASSPHRASE }),
      /after its end|cut short/
    )
    assert.equal(existsSync(stagingPath), false)
  })

  it('never follows a path out of the staging folder, and skips what it does not know', async (t) => {
    assert.throws(() => resolvePhoneEntry('hyper-sdk/../../evil', 'file'), /illegal path traversal/)
    assert.throws(() => resolvePhoneEntry('/etc/passwd', 'file'), /illegal path traversal/)
    assert.throws(() => resolvePhoneEntry('hyper-sdk\\..\\evil', 'file'), /illegal path traversal/)
    assert.equal(resolvePhoneEntry('device-key.json', 'file'), null)
    assert.equal(resolvePhoneEntry('pairing-nonce.json', 'file'), null)
    assert.equal(resolvePhoneEntry('something-new.json', 'file'), null)
    assert.equal(resolvePhoneEntry('hyper-sdk/CORESTORE', 'file'), null)
    assert.equal(resolvePhoneEntry('hyper-sdk/db/LOCK', 'file'), null)
    assert.deepEqual(resolvePhoneEntry('hyper-sdk/db/000001.sst', 'file'), { top: 'hyper-sdk', path: 'hyper-sdk/db/000001.sst' })

    // A hand-made file with a traversal entry is refused before anything is
    // written outside staging.
    const [phoneTwo, outDir] = await withTempDirs(t, 2)
    const evilPath = join(outDir, 'evil.peersky')
    await writeCustomBackup(evilPath, async (archive) => {
      await archive.addBytes('browser-bookmarks.json', b4a.from('{}'))
      await archive.addBytes('hyper-sdk/../../escaped.txt', b4a.from('nope'))
    })
    const stagingPath = join(phoneTwo, RESTORE_STAGING_DIR)
    await assert.rejects(
      stagePhoneBackupFile({ filePath: evilPath, stagingPath, passphrase: PASSPHRASE }),
      /illegal path traversal/
    )
    assert.equal(existsSync(join(phoneTwo, '..', 'escaped.txt')), false)
    assert.equal(existsSync(stagingPath), false)

    // A newer app's extra file is skipped, and the rest still restores.
    const newerPath = join(outDir, 'newer.peersky')
    await writeCustomBackup(newerPath, async (archive) => {
      await archive.addBytes('browser-bookmarks.json', b4a.from('{"items":[]}'))
      await archive.addBytes('from-the-future.json', b4a.from('{}'))
    })
    const staged = await stagePhoneBackupFile({ filePath: newerPath, stagingPath, passphrase: PASSPHRASE })
    assert.deepEqual(staged.names, ['browser-bookmarks.json'])
    assert.equal(existsSync(join(stagingPath, 'from-the-future.json')), false)
  })

  it('leaves locks, logs and the device file out of a backup', async (t) => {
    const [phoneOne] = await withTempDirs(t, 1)
    mkdirSync(join(phoneOne, 'hyper-sdk', 'db'), { recursive: true })
    for (const name of ['CORESTORE', 'db/LOCK', 'db/LOG', 'db/LOG.old.1700000000', 'db/000001.sst', 'db/CURRENT', 'db/x.lock']) {
      writeFileSync(join(phoneOne, 'hyper-sdk', name), name)
    }
    const plan = planPhoneBackup(phoneOne)
    assert.deepEqual(
      plan.entries.filter((entry) => entry.type === 'file').map((entry) => entry.name),
      ['hyper-sdk/db/000001.sst', 'hyper-sdk/db/CURRENT']
    )
  })

  it('tells a desktop backup and a stray file apart from a phone backup', async (t) => {
    const [outDir] = await withTempDirs(t, 1)
    writeFileSync(join(outDir, 'desktop.zip'), b4a.from([0x50, 0x4b, 0x03, 0x04, 0, 0]))
    assert.deepEqual(inspectPhoneBackupFile(join(outDir, 'desktop.zip')), { kind: 'desktop-backup' })

    writeFileSync(join(outDir, 'photo.jpg'), b4a.alloc(40000, 7))
    assert.throws(() => inspectPhoneBackupFile(join(outDir, 'photo.jpg')), /Not a PeerSky backup file/)
  })
})

describe('phone to phone transfer', () => {
  async function pair (t) {
    const [phoneOne, phoneTwo, outDir] = await withTempDirs(t, 3)
    await createPhone(phoneOne, t, { text: 'moving to a new phone' })
    const senderKeys = await getKeysAt(join(phoneOne, 'keys'))
    const receiverKeys = await getKeysAt(join(phoneTwo, 'keys'))
    const nonce = b4a.toString(randomBytes(16), 'hex')
    const code = createMobilePairingCode(b4a.toString(receiverKeys.encryption.publicKey, 'hex'), nonce)
    return { phoneOne, phoneTwo, outDir, senderKeys, receiverKeys, nonce, code }
  }

  it('sends everything to the phone that showed the code, and both show the same six characters', async (t) => {
    const { phoneOne, phoneTwo, outDir, senderKeys, receiverKeys, nonce, code } = await pair(t)
    const target = parsePairingCode(code)
    assert.equal(target.deviceType, 'mobile')

    const transferPath = join(outDir, 'transfer.peersky')
    const sent = await createPhoneTransfer({ storagePath: phoneOne, outPath: transferPath, target, deviceKeys: senderKeys })
    assert.match(sent.verificationCode, /^[0-9A-F]{6}$/)
    assert.equal(inspectPhoneBackupFile(transferPath).kind, 'transfer')
    assert.equal(inspectPhoneBackupFile(transferPath).needsPassphrase, false)

    const stagingPath = join(phoneTwo, RESTORE_STAGING_DIR)
    const staged = await stagePhoneBackupFile({ filePath: transferPath, stagingPath, deviceKeys: receiverKeys, expectedNonce: nonce })
    assert.equal(staged.sas, sent.verificationCode)
    commitStagedRestore({ storagePath: phoneTwo, stagingPath, names: staged.names, replace: staged.replace })

    const sdk = await createSDK({ storage: join(phoneTwo, 'hyper-sdk'), swarmOpts: SWARM_OFF, autoJoin: false })
    t.after(() => sdk.close())
    const drive = await sdk.getDrive('mydrive')
    assert.equal(b4a.toString(await drive.get('/note.txt')), 'moving to a new phone')
  })

  it('refuses a transfer meant for another phone, another code, or one that expired', async (t) => {
    const { phoneOne, phoneTwo, outDir, senderKeys, receiverKeys, nonce } = await pair(t)
    const transferPath = join(outDir, 'transfer.peersky')
    let clock = 1_000_000
    await createPhoneTransfer({
      storagePath: phoneOne,
      outPath: transferPath,
      target: { encryptionPublicKey: b4a.toString(receiverKeys.encryption.publicKey, 'hex'), nonce },
      deviceKeys: senderKeys,
      ttlMs: 10 * 60 * 1000,
      now: () => clock
    })
    const stagingPath = join(phoneTwo, RESTORE_STAGING_DIR)
    const stranger = await getKeysAt(join(outDir, 'stranger'))

    await assert.rejects(
      stagePhoneBackupFile({ filePath: transferPath, stagingPath, deviceKeys: stranger, expectedNonce: nonce, now: clock }),
      /encrypted for a different device/
    )
    await assert.rejects(
      stagePhoneBackupFile({ filePath: transferPath, stagingPath, deviceKeys: receiverKeys, expectedNonce: 'f'.repeat(32), now: clock }),
      /different code/
    )
    await assert.rejects(
      stagePhoneBackupFile({ filePath: transferPath, stagingPath, deviceKeys: receiverKeys, expectedNonce: null, now: clock }),
      /different code/
    )
    clock += 11 * 60 * 1000
    await assert.rejects(
      stagePhoneBackupFile({ filePath: transferPath, stagingPath, deviceKeys: receiverKeys, expectedNonce: nonce, now: clock }),
      /expired/
    )
  })

  it('refuses a transfer whose signed details were changed', async (t) => {
    const { phoneOne, phoneTwo, outDir, senderKeys, receiverKeys, nonce } = await pair(t)
    const transferPath = join(outDir, 'transfer.peersky')
    await createPhoneTransfer({
      storagePath: phoneOne,
      outPath: transferPath,
      target: { encryptionPublicKey: b4a.toString(receiverKeys.encryption.publicKey, 'hex'), nonce },
      deviceKeys: senderKeys
    })

    // Move the whole window a second earlier, which keeps its length, and
    // rewrite the manifest area.
    const manifest = readBackupFileManifest(transferPath)
    manifest.identityTransfer.issuedAt -= 1000
    manifest.identityTransfer.expiresAt -= 1000
    rewriteManifest(transferPath, manifest)

    await assert.rejects(
      stagePhoneBackupFile({ filePath: transferPath, stagingPath: join(phoneTwo, RESTORE_STAGING_DIR), deviceKeys: receiverKeys, expectedNonce: nonce }),
      /signature is invalid/
    )
  })

  it('reads a pairing code from either device, and says what a scanned code is for', () => {
    const key = 'ab'.repeat(32)
    const nonce = 'cd'.repeat(16)

    assert.deepEqual(parsePairingCode(`peersky-identity:${key}?nonce=${nonce}&deviceType=mobile`), { encryptionPublicKey: key, nonce, deviceType: 'mobile', chat: false, notes: false })
    // The desktop puts deviceType first.
    assert.deepEqual(parsePairingCode(`peersky-identity:${key.toUpperCase()}?deviceType=desktop&nonce=${nonce}`), { encryptionPublicKey: key, nonce, deviceType: 'desktop', chat: false, notes: false })
    // A device that takes PeerChat or P2PMD notes in a transfer says so, this
    // phone included.
    assert.equal(parsePairingCode(`peersky-identity:${key}?deviceType=desktop&nonce=${nonce}&chat=1`).chat, true)
    assert.equal(parsePairingCode(`peersky-identity:${key}?deviceType=desktop&nonce=${nonce}&chat=1`).notes, false)
    assert.equal(parsePairingCode(`peersky-identity:${key}?deviceType=desktop&notes=1&nonce=${nonce}`).notes, true)
    assert.equal(parsePairingCode(createPairingCode(key, nonce, 'mobile')).chat, true)
    assert.equal(parsePairingCode(createPairingCode(key, nonce, 'mobile')).notes, true)
    assert.equal(parsePairingCode('hyper://abc'), null)
    assert.throws(() => parsePairingCode(`peersky-identity:${key}?nonce=short`), /damaged/)
    assert.equal(createPairingCode(key, nonce, 'tablet'), '')

    assert.equal(classifyLinkDeviceCode(`peersky-identity:${key}?nonce=${nonce}&deviceType=mobile`).kind, 'pairing')
    assert.equal(classifyLinkDeviceCode(`hyper://${'a'.repeat(52)}/transfer.peersky`).kind, 'transfer')
    assert.equal(classifyLinkDeviceCode('https://example.com').kind, 'invalid')
    assert.equal(classifyLinkDeviceCode(`peersky-identity:${key}?nonce=xyz`).kind, 'invalid')
    assert.equal(classifyLinkDeviceCode('').kind, 'empty')
  })
})

describe('putting a restore in place', () => {
  it('replaces only what was restored, and clears data tied to it', async (t) => {
    const [storagePath] = await withTempDirs(t, 1)
    const stagingPath = join(storagePath, RESTORE_STAGING_DIR)
    mkdirSync(join(storagePath, 'hyper-sdk-synced-private'), { recursive: true })
    writeFileSync(join(storagePath, 'hyper-sdk-synced-private', 'old'), 'old')
    mkdirSync(join(storagePath, 'hyper-sdk-adopted'), { recursive: true })
    writeFileSync(join(storagePath, 'untouched.json'), 'keep me')
    mkdirSync(join(stagingPath, 'hyper-sdk-synced-private'), { recursive: true })
    writeFileSync(join(stagingPath, 'hyper-sdk-synced-private', 'new'), 'new')

    const result = commitStagedRestore({
      storagePath,
      stagingPath,
      names: ['hyper-sdk-synced-private'],
      replace: ['hyper-sdk-adopted']
    })

    assert.deepEqual(result, { restored: ['hyper-sdk-synced-private'], removed: ['hyper-sdk-adopted'] })
    assert.deepEqual(listNames(join(storagePath, 'hyper-sdk-synced-private')), ['new'])
    assert.equal(existsSync(join(storagePath, 'hyper-sdk-adopted')), false)
    assert.equal(readFileSync(join(storagePath, 'untouched.json'), 'utf8'), 'keep me')
    assert.equal(existsSync(stagingPath), false)
  })

  it('puts everything back when a move fails half way', async (t) => {
    const [storagePath] = await withTempDirs(t, 1)
    const stagingPath = join(storagePath, RESTORE_STAGING_DIR)
    writeFileSync(join(storagePath, 'browser-bookmarks.json'), 'old bookmarks')
    writeFileSync(join(storagePath, 'browser-history.json'), 'old history')
    mkdirSync(stagingPath, { recursive: true })
    writeFileSync(join(stagingPath, 'browser-bookmarks.json'), 'new bookmarks')
    // Named but never staged, so its move fails after the first one landed.

    assert.throws(() => commitStagedRestore({
      storagePath,
      stagingPath,
      names: ['browser-bookmarks.json', 'browser-history.json']
    }))

    assert.equal(readFileSync(join(storagePath, 'browser-bookmarks.json'), 'utf8'), 'old bookmarks')
    assert.equal(readFileSync(join(storagePath, 'browser-history.json'), 'utf8'), 'old history')
    assert.equal(readFileSync(join(stagingPath, 'browser-bookmarks.json'), 'utf8'), 'new bookmarks')
  })

  it('refuses names that would reach outside storage', async (t) => {
    const [storagePath] = await withTempDirs(t, 1)
    mkdirSync(join(storagePath, RESTORE_STAGING_DIR), { recursive: true })
    for (const name of ['../escape', 'a/b', '..', '.peersky-restore-previous']) {
      assert.throws(
        () => commitStagedRestore({ storagePath, stagingPath: join(storagePath, RESTORE_STAGING_DIR), names: [name] }),
        /Refusing to restore/
      )
    }
  })
})

async function getKeysAt (path) {
  mkdirSync(path, { recursive: true })
  // getDeviceKeys caches its first answer for the life of the process, which
  // is right for the app and wrong for a test that needs several devices.
  const keys = {
    signing: { publicKey: b4a.alloc(32), secretKey: b4a.alloc(64) },
    encryption: { publicKey: b4a.alloc(32), secretKey: b4a.alloc(32) }
  }
  sodium.crypto_sign_keypair(keys.signing.publicKey, keys.signing.secretKey)
  sodium.crypto_box_keypair(keys.encryption.publicKey, keys.encryption.secretKey)
  assert.equal(typeof getDeviceKeys, 'function')
  return keys
}

function keyCheck (key) {
  const check = b4a.alloc(16)
  sodium.crypto_generichash(check, b4a.from('peersky-backup-key-check'), key)
  return check
}

function randomBytes (length) {
  const bytes = b4a.alloc(length)
  sodium.randombytes_buf(bytes)
  return bytes
}

// Walks the frames and returns where the last one starts.
function lastFrameStart (bytes) {
  let position = PAYLOAD_OFFSET + 24
  let last = position
  while (position < bytes.byteLength) {
    last = position
    position += 4 + bytes.readUInt32LE(position)
  }
  return last
}

function rewriteManifest (filePath, manifest) {
  const bytes = readFileSync(filePath)
  const area = b4a.alloc(PAYLOAD_OFFSET - 20, 0x20)
  area.set(b4a.from(JSON.stringify(manifest)), 0)
  bytes.set(area, 20)
  writeFileSync(filePath, bytes)
}

// Builds a passphrase backup by hand, for archives the app would never write.
async function writeCustomBackup (filePath, fill) {
  const { BACKUP_KDF, deriveBackupKey } = await import('../../backend/backup/phone-backup.mjs')
  const salt = randomBytes(sodium.crypto_pwhash_SALTBYTES)
  const key = await deriveBackupKey(PASSPHRASE, salt, BACKUP_KDF)
  const writer = createBackupFileWriter(filePath, key)
  const archive = createArchiveWriter((bytes) => writer.write(bytes))
  await fill(archive)
  await archive.end()
  writer.finish((payload) => ({
    version: 1,
    kind: 'peersky-encrypted-backup',
    format: PHONE_BACKUP_FORMAT,
    deviceType: 'mobile',
    createdAt: new Date().toISOString(),
    contents: ['browser-bookmarks.json'],
    sizeBytes: 64,
    encryption: {
      algorithm: 'xchacha20poly1305-secretstream',
      ...BACKUP_KDF,
      salt: b4a.toString(salt, 'hex'),
      check: b4a.toString(keyCheck(key), 'hex')
    },
    ...payload
  }))
  assert.ok(statSync(filePath).size > PAYLOAD_OFFSET)
}
