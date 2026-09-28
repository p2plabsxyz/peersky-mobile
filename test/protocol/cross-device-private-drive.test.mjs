import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Hyperdrive from 'hyperdrive'
import { create as createSDK } from 'hyper-sdk'
import z32 from 'z32'
import { restoreIdentityFromBackup } from '../../backend/backup/restore.mjs'
import {
  adoptTransferredPrivateDrive,
  extractTransferredPrivateDrive
} from '../../backend/backup/private-drive-import.mjs'
import { HYPERDRIVE_PRIVATE_DRIVE_NAME } from '../../backend/hyper/storage-core.mjs'
import { getPrivateDriveKeyRecord } from '../../backend/hyper/private-keys.mjs'
import { adoptedStoragePathFor, isAdoptedSyncedPrivateDrive, readSyncedPrivateAdoptedDrives } from '../../backend/hyper/runtime-routing.mjs'

const SWARM_OFF = { bootstrap: [], port: 0 }

describe('Cross-device private drive (desktop to mobile)', () => {
  it('restores, adopts, and decrypts a desktop+registry private drive without a key file', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'peersky-xdevice-'))
    const desktopStore = join(root, 'desktop')
    const mobileRestore = join(root, 'mobile')
    const syncedStore = join(root, 'mobile-hyper-sdk')
    const sdks = []

    t.after(async () => {
      await Promise.allSettled(sdks.map((sdk) => sdk.close()))
      await rm(root, { recursive: true, force: true })
    })

    const desktop = await createSDK({ storage: desktopStore, swarmOpts: SWARM_OFF, autoJoin: false, doReplicate: false })
    sdks.push(desktop)

    const sourceDrive = await desktop.getDrive('mydrive')
    await sourceDrive.put('/secret.txt', Buffer.from('top secret from desktop'))

    const driveId = sourceDrive.key.toString('hex')
    const driveZ32 = z32.encode(sourceDrive.key).toLowerCase()

    const registry = JSON.stringify([{
      name: 'mydrive',
      url: `hyper://${driveZ32}/`,
      timestamp: 1700000000000
    }])

    const backupBytes = createBackupZip(desktopStore, registry)

    const restored = await restoreIdentityFromBackup(backupBytes, mobileRestore)
    assert.equal(restored.restoredFiles > 0, true)
    assert.equal(readFileSync(join(mobileRestore, 'privateHyperdrives.json'), 'utf8'), registry)

    const transferred = extractTransferredPrivateDrive(mobileRestore)
    assert.equal(transferred.length, 1)
    assert.equal(transferred[0].source, 'desktop')
    assert.equal(transferred[0].encrypted, false)
    assert.equal(transferred[0].key, null)
    assert.equal(transferred[0].driveId, driveId)

    const adoption = adoptTransferredPrivateDrive(mobileRestore, syncedStore)
    assert.equal(adoption.adopted, true)
    assert.equal(adoption.driveId, driveId)
    assert.equal(adoption.encrypted, false)
    assert.deepEqual(adoption.driveIds, [driveId])

    const adoptedDrives = readSyncedPrivateAdoptedDrives(syncedStore)
    assert.equal(adoptedDrives.length, 1)
    assert.equal(adoptedDrives[0].driveId, driveId)
    assert.equal(adoptedDrives[0].encrypted, false)
    assert.equal(adoptedDrives[0].announce, false)

    // Adoption must never touch the phone's own key record: the adopted drive
    // is a separate read-only copy, and the phone keeps its own private drive
    // (and, if any, its own key) as the sole write target.
    assert.deepEqual(getPrivateDriveKeyRecord(syncedStore), { ok: false })

    // Adopted stores live in their own directory (hyper-sdk-adopted), never
    // overlaid onto the phone's synced-private store. The adopted drive must
    // reopen and read from there — read-only, so the phone cannot append to a
    // drive it would then silently diverge from.
    const adoptedStore = adoptedStoragePathFor(syncedStore)
    const mobile = await createSDK({
      storage: adoptedStore,
      corestoreOpts: { allowBackup: true, readOnly: true },
      swarmOpts: SWARM_OFF,
      autoJoin: false,
      doReplicate: false
    })
    sdks.push(mobile)

    const adoptedDrive = new Hyperdrive(mobile.corestore, Buffer.from(driveId, 'hex'))
    await adoptedDrive.ready()
    assert.equal(adoptedDrive.writable, false)

    const content = await adoptedDrive.get('/secret.txt')
    assert.equal(Buffer.from(content).toString(), 'top secret from desktop')

    const phoneOwn = await createSDK({
      storage: syncedStore,
      corestoreOpts: { allowBackup: true },
      swarmOpts: SWARM_OFF,
      autoJoin: false,
      doReplicate: false
    })
    sdks.push(phoneOwn)
    const ownDrive = new Hyperdrive(phoneOwn.namespace(HYPERDRIVE_PRIVATE_DRIVE_NAME))
    await ownDrive.ready()
    assert.equal(await ownDrive.get('/secret.txt'), null)

    await assert.rejects(
      () => adoptedDrive.put('/from-mobile.txt', Buffer.from('written on mobile')),
      /not writable|cannot append|readonly/i
    )
  })

  it('adopts a desktop v3 key export that lists entries as encrypted keyed drives', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'peersky-xdevice-'))
    const mobileRestore = join(root, 'mobile')
    const syncedStore = join(root, 'mobile-hyper-sdk')
    mkdirSync(mobileRestore, { recursive: true })

    const driveId = 'a'.repeat(64)
    const key = 'b'.repeat(64)
    writeFileSync(join(mobileRestore, 'private-drive-key.json'), JSON.stringify({
      version: 3,
      key,
      driveId,
      encrypted: true,
      announce: true,
      source: 'desktop',
      entries: [{ driveId }]
    }))
    writeFileSync(join(mobileRestore, 'privateHyperdrives.json'), JSON.stringify([{
      name: 'mydrive',
      url: `hyper://${z32.encode(Buffer.from(driveId, 'hex')).toLowerCase()}/`,
      timestamp: 1700000000000
    }]))

    const transferred = extractTransferredPrivateDrive(mobileRestore)
    assert.equal(transferred.length, 1)
    assert.equal(transferred[0].driveId, driveId)
    assert.equal(transferred[0].key, key)
    assert.equal(transferred[0].encrypted, true)
    assert.equal(transferred[0].announce, true)

    const adoption = adoptTransferredPrivateDrive(mobileRestore, syncedStore)
    assert.equal(adoption.adopted, true)
    assert.equal(adoption.driveId, driveId)
    assert.equal(adoption.encrypted, true)

    // The adopted drive's own encryption key is tracked on the adopted marker
    // entry, so it can be decrypted without hijacking the phone's key record.
    const adoptedDrives = readSyncedPrivateAdoptedDrives(syncedStore)
    assert.equal(adoptedDrives.length, 1)
    assert.equal(adoptedDrives[0].key, key)
    assert.deepEqual(getPrivateDriveKeyRecord(syncedStore), { ok: false })

    rmSync(root, { recursive: true, force: true })
  })

  it('adopts a desktop mobile-safe v3 key export carrying a top-level key and driveId', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'peersky-xdevice-'))
    const mobileRestore = join(root, 'mobile')
    const syncedStore = join(root, 'mobile-hyper-sdk')
    mkdirSync(mobileRestore, { recursive: true })

    const driveId = 'c'.repeat(64)
    const key = 'd'.repeat(64)
    writeFileSync(join(mobileRestore, 'private-drive-key.json'), JSON.stringify({
      version: 3,
      key,
      driveId,
      encrypted: true,
      announce: true,
      source: 'desktop'
    }))

    const transferred = extractTransferredPrivateDrive(mobileRestore)
    assert.equal(transferred.length, 1)
    assert.equal(transferred[0].driveId, driveId)
    assert.equal(transferred[0].key, key)
    assert.equal(transferred[0].encrypted, true)

    const adoption = adoptTransferredPrivateDrive(mobileRestore, syncedStore)
    assert.equal(adoption.adopted, true)
    assert.equal(adoption.driveId, driveId)
    assert.equal(adoption.encrypted, true)

    const adoptedDrives = readSyncedPrivateAdoptedDrives(syncedStore)
    assert.equal(adoptedDrives.length, 1)
    assert.equal(adoptedDrives[0].key, key)
    assert.deepEqual(getPrivateDriveKeyRecord(syncedStore), { ok: false })

    rmSync(root, { recursive: true, force: true })
  })

  it('keeps an adopted encrypted drive read-only and never hijacks the phone key record', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'peersky-xdevice-'))
    const desktopStore = join(root, 'desktop')
    const mobileRestore = join(root, 'mobile')
    const syncedStore = join(root, 'mobile-hyper-sdk')
    const sdks = []
    t.after(async () => {
      await Promise.allSettled(sdks.map((sdk) => sdk.close()))
      await rm(root, { recursive: true, force: true })
    })

    const encryptionKey = Buffer.alloc(32, 9)
    const source = await createSDK({
      storage: desktopStore,
      swarmOpts: SWARM_OFF,
      autoJoin: false,
      doReplicate: false
    })
    sdks.push(source)

    const sourceDrive = new Hyperdrive(source.namespace(HYPERDRIVE_PRIVATE_DRIVE_NAME), null, { encryptionKey })
    await sourceDrive.ready()
    await sourceDrive.put('/secret.txt', Buffer.from('sealed by desktop'))
    const driveId = sourceDrive.core.key.toString('hex')
    const driveZ32 = z32.encode(sourceDrive.core.key).toLowerCase()
    await source.corestore.flush?.().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 300))
    await source.close()

    const registry = JSON.stringify([{
      name: 'demo',
      url: `hyper://${driveZ32}/`,
      timestamp: 1700000000000,
      encrypted: true
    }])
    await restoreIdentityFromBackup(createBackupZip(desktopStore, registry), mobileRestore)
    writeFileSync(join(mobileRestore, 'private-drive-key.json'), JSON.stringify({
      version: 3,
      key: encryptionKey.toString('hex'),
      driveId,
      encrypted: true,
      announce: true,
      source: 'desktop'
    }))

    const adoption = adoptTransferredPrivateDrive(mobileRestore, syncedStore)
    assert.equal(adoption.adopted, true)
    assert.equal(adoption.driveId, driveId)
    assert.equal(adoption.encrypted, true)
    assert.equal(isAdoptedSyncedPrivateDrive(syncedStore, driveId), true)
    assert.equal(isAdoptedSyncedPrivateDrive(syncedStore, 'f'.repeat(64)), false)

    // The encryption key travels with the adopted marker entry, never into the
    // phone's own key record, so the phone's private drive stays the only
    // write target.
    const adoptedDrives = readSyncedPrivateAdoptedDrives(syncedStore)
    assert.equal(adoptedDrives.length, 1)
    assert.equal(adoptedDrives[0].key, encryptionKey.toString('hex'))
    assert.deepEqual(getPrivateDriveKeyRecord(syncedStore), { ok: false })

    const adoptedStore = adoptedStoragePathFor(syncedStore)
    const linked = await createSDK({
      storage: adoptedStore,
      corestoreOpts: { allowBackup: true, readOnly: true },
      swarmOpts: SWARM_OFF,
      autoJoin: false,
      doReplicate: false
    })
    sdks.push(linked)

    // The adopted open reads the linked desktop copy, but the receiving phone
    // may never append to it: the desktop is the single writer.
    const linkedDrive = new Hyperdrive(linked.corestore, Buffer.from(driveId, 'hex'), { encryptionKey })
    await linkedDrive.ready()
    assert.equal(linkedDrive.writable, false)
    assert.equal(Buffer.from(await linkedDrive.get('/secret.txt')).toString(), 'sealed by desktop')
    await assert.rejects(
      () => linkedDrive.put('/upload.txt', Buffer.from('written on phone')),
      /not writable|cannot append|readonly/i
    )
  })

  it('adopts every desktop private registry entry, not just the newest', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'peersky-xdevice-'))
    const mobileRestore = join(root, 'mobile')
    const syncedStore = join(root, 'mobile-hyper-sdk')
    mkdirSync(mobileRestore, { recursive: true })

    const names = ['one', 'two', 'three']
    const registry = names.map((name, index) => ({
      name,
      url: `hyper://${z32.encode(Buffer.alloc(32, index + 1)).toLowerCase()}/`,
      timestamp: 1700000000000 + index
    }))
    writeFileSync(join(mobileRestore, 'privateHyperdrives.json'), JSON.stringify(registry))

    const transferred = extractTransferredPrivateDrive(mobileRestore)
    assert.equal(transferred.length, names.length)

    const adoption = adoptTransferredPrivateDrive(mobileRestore, syncedStore)
    assert.equal(adoption.adopted, true)
    assert.equal(adoption.encrypted, false)
    assert.equal(adoption.driveIds.length, names.length)
    assert.deepEqual(
      adoption.driveIds.sort(),
      registry.map((entry) => Buffer.from(z32.decode(new URL(entry.url).hostname)).toString('hex')).sort()
    )

    const adoptedDrives = readSyncedPrivateAdoptedDrives(syncedStore)
    assert.equal(adoptedDrives.length, names.length)
    assert.equal(adoptedDrives.every((entry) => entry.encrypted === false), true)
    assert.equal(adoptedDrives.every((entry) => entry.announce === false), true)
    assert.equal(adoptedDrives.every((entry) => !('key' in entry)), true)
    assert.deepEqual(getPrivateDriveKeyRecord(syncedStore), { ok: false })

    rmSync(root, { recursive: true, force: true })
  })
})

function createBackupZip (desktopStore, registry) {
  const entries = []
  entries.push({ name: 'privateHyperdrives.json', bytes: Buffer.from(registry) })
  collectEntries(desktopStore, 'hyper-private', entries)

  const localChunks = []
  const centralDirectory = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name)
    const data = entry.bytes

    const localHeader = Buffer.alloc(30 + nameBytes.length)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(nameBytes.length, 26)
    nameBytes.copy(localHeader, 30)

    const local = Buffer.concat([localHeader, data])
    localChunks.push(local)

    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)
    centralDirectory.push(central)

    offset += local.length
  }

  const centralBytes = Buffer.concat(centralDirectory)
  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  endOfCentralDirectory.writeUInt16LE(entries.length, 8)
  endOfCentralDirectory.writeUInt16LE(entries.length, 10)
  endOfCentralDirectory.writeUInt32LE(centralBytes.length, 12)
  endOfCentralDirectory.writeUInt32LE(offset, 16)

  return Buffer.concat([...localChunks, centralBytes, endOfCentralDirectory])
}

function collectEntries (directory, prefix, out) {
  for (const name of readdirSync(directory)) {
    const full = join(directory, name)
    const relative = prefix ? `${prefix}/${name}` : name
    const info = statSync(full)

    if (info.isDirectory()) {
      out.push({ name: `${relative}/`, bytes: Buffer.alloc(0) })
      collectEntries(full, relative, out)
    } else {
      out.push({ name: relative, bytes: readFileSync(full) })
    }
  }
}
