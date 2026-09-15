import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Hyperdrive from 'hyperdrive'
import { create as createSDK } from 'hyper-sdk'
import {
  adoptTransferredPrivateDrive
} from '../../backend/backup/private-drive-import.mjs'
import {
  getPrivateDriveKey,
  getPrivateDriveId,
  getPrivateDriveKeyRecord,
  rememberPrivateDriveId,
  resetPrivateDriveKeyCache
} from '../../backend/hyper/private-keys.mjs'
import { readSyncedPrivateAdoptedDrives, adoptedStoragePathFor } from '../../backend/hyper/runtime-routing.mjs'
import { HYPERDRIVE_PRIVATE_DRIVE_NAME } from '../../backend/hyper/storage-core.mjs'

const SWARM_OFF = { bootstrap: [], port: 0 }
const ENCRYPTED_PRIVATE_DRIVE_NAME = 'hyperdrive-private'

describe('Encrypted private drive sync guards', () => {
  it('two stores with the same key read the same encrypted drive', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'peersky-guard-same-'))
    const sdks = []
    t.after(async () => {
      await Promise.allSettled(sdks.map((sdk) => sdk.close()))
      await rm(root, { recursive: true, force: true })
    })

    const encryptionKey = Buffer.alloc(32, 7)
    const sourceDir = join(root, 'source')

    const source = await createSDK({
      storage: sourceDir,
      swarmOpts: SWARM_OFF,
      autoJoin: false,
      doReplicate: false
    })
    sdks.push(source)

    const sourceDrive = new Hyperdrive(source.namespace(ENCRYPTED_PRIVATE_DRIVE_NAME), null, { encryptionKey })
    await sourceDrive.ready()
    await sourceDrive.put('/note.txt', Buffer.from('shared private note'))
    const keyBytes = BinaryToHex(sourceDrive.core.key)
    await source.corestore.flush?.().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 300))
    await source.close()

    const peerDir = join(root, 'peerA')
    cpSync(sourceDir, peerDir, { recursive: true })

    const peerA = await createSDK({
      storage: peerDir,
      corestoreOpts: { allowBackup: true },
      swarmOpts: SWARM_OFF,
      autoJoin: false,
      doReplicate: false
    })
    sdks.push(peerA)

    const driveA = new Hyperdrive(peerA.corestore, HexToBinary(keyBytes), { encryptionKey })
    await driveA.ready()
    assert.equal(Buffer.from(await driveA.get('/note.txt')).toString(), 'shared private note')
  })

  it('a store with a different key cannot read the encrypted drive', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'peersky-guard-diff-'))
    const sdks = []
    t.after(async () => {
      await Promise.allSettled(sdks.map((sdk) => sdk.close()))
      await rm(root, { recursive: true, force: true })
    })

    const encryptionKey = Buffer.alloc(32, 7)
    const sourceDir = join(root, 'source')

    const source = await createSDK({
      storage: sourceDir,
      swarmOpts: SWARM_OFF,
      autoJoin: false,
      doReplicate: false
    })
    sdks.push(source)

    const sourceDrive = new Hyperdrive(source.namespace(ENCRYPTED_PRIVATE_DRIVE_NAME), null, { encryptionKey })
    await sourceDrive.ready()
    await sourceDrive.put('/secret.txt', Buffer.from('never reached'))
    const keyBytes = BinaryToHex(sourceDrive.core.key)
    await source.corestore.flush?.().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 300))
    await source.close()

    const intruderDir = join(root, 'intruder')
    cpSync(sourceDir, intruderDir, { recursive: true })

    const intruder = await createSDK({
      storage: intruderDir,
      corestoreOpts: { allowBackup: true },
      swarmOpts: SWARM_OFF,
      autoJoin: false,
      doReplicate: false
    })
    sdks.push(intruder)

    const wrongKey = Buffer.alloc(32, 42)
    const drive = new Hyperdrive(intruder.corestore, HexToBinary(keyBytes), { encryptionKey: wrongKey })
    await assert.rejects(async () => {
      await drive.ready()
      await drive.get('/secret.txt')
    })
  })

  it('adopting an unencrypted drive records announce:false, lands in its own store, and never announces', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'peersky-guard-announce-'))
    const sdks = []
    const drives = []
    const trackDrive = (drive) => { drives.push(drive); return drive }
    t.after(async () => {
      await Promise.allSettled(drives.map((drive) => drive.close?.()))
      await Promise.allSettled(sdks.map((sdk) => sdk.close()))
      resetPrivateDriveKeyCache()
      await rm(root, { recursive: true, force: true })
    })

    const sourcePath = join(root, 'source')
    const syncedStore = join(root, 'synced')
    const adoptedStore = adoptedStoragePathFor(syncedStore)

    // Real desktop corestore: unencrypted drive with a file, so the adopted
    // store at least contains a real drive we can open after adoption.
    mkdirSync(join(sourcePath, 'hyper-private'), { recursive: true })
    const desktop = await createSDK({
      storage: join(sourcePath, 'hyper-private'),
      swarmOpts: SWARM_OFF,
      autoJoin: false,
      doReplicate: false
    })
    sdks.push(desktop)
    const desktopDrive = await desktop.getDrive('mydrive')
    await desktopDrive.put('/note.txt', Buffer.from('desktop note'))
    const driveId = Buffer.from(desktopDrive.key).toString('hex').toLowerCase()
    await desktop.corestore.flush?.().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 300))
    await desktop.close()

    writeFileSync(join(sourcePath, 'privateHyperdrives.json'), JSON.stringify([{
      name: 'files',
      url: `hyper://${driveId}/`,
      timestamp: 1700000000000
    }]))

    resetPrivateDriveKeyCache()
    const adoption = adoptTransferredPrivateDrive(sourcePath, syncedStore)
    assert.equal(adoption.adopted, true)

    const adopted = readSyncedPrivateAdoptedDrives(syncedStore)
    assert.equal(adopted.length, 1)
    assert.equal(adopted[0].encrypted, false)
    assert.equal(adopted[0].announce, false)

    const record = getPrivateDriveKeyRecord(syncedStore)
    assert.equal(record.ok, true)
    assert.equal(record.encrypted, false)
    assert.equal(record.announce, false)

    const mobile = await createSDK({
      storage: adoptedStore,
      corestoreOpts: { allowBackup: true },
      swarmOpts: SWARM_OFF,
      autoJoin: false,
      doReplicate: false
    })
    sdks.push(mobile)

    const adoptedDrive = trackDrive(new Hyperdrive(mobile.corestore, HexToBinary(driveId)))
    await adoptedDrive.ready()
    assert.equal(Buffer.from(await adoptedDrive.get('/note.txt')).toString(), 'desktop note')
    const discovery = adoptedDrive.core.discovery
    assert.ok(discovery === null || discovery === undefined, 'adopted drive must not join any swarm topic')
  })

  it('adoptions do not corrupt either store: reopen phone + adopted stores and read a file from each', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'peersky-guard-merge-'))
    const sdks = []
    const drives = []
    const trackDrive = (drive) => { drives.push(drive); return drive }
    t.after(async () => {
      await Promise.allSettled(drives.map((drive) => drive.close?.()))
      await Promise.allSettled(sdks.map((sdk) => sdk.close()))
      resetPrivateDriveKeyCache()
      await rm(root, { recursive: true, force: true })
    })

    const sourcePath = join(root, 'source')
    const syncedStore = join(root, 'synced')
    const adoptedStore = adoptedStoragePathFor(syncedStore)

    // Phone side: the app's order — open the store FIRST, then write the key
    // record (the CORESTORE marker must exist before the key file is written,
    // otherwise tmpFixStorage moves the unknown file into db/), then open the
    // encrypted drive with that same key.
    const phoneSdk = await createSDK({
      storage: syncedStore,
      swarmOpts: SWARM_OFF,
      autoJoin: false,
      doReplicate: false
    })
    sdks.push(phoneSdk)
    resetPrivateDriveKeyCache()
    const phoneKey = getPrivateDriveKey(syncedStore)
    assert.ok(phoneKey)
    const phoneDriveId = Buffer.from((await (async () => {
      const drive = trackDrive(new Hyperdrive(phoneSdk.namespace(ENCRYPTED_PRIVATE_DRIVE_NAME), null, { encryptionKey: phoneKey }))
      await drive.ready()
      await drive.put('/phone-note.txt', Buffer.from('on the phone'))
      return drive
    })()).core.key).toString('hex').toLowerCase()
    await phoneSdk.corestore.flush?.().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 300))
    await phoneSdk.close()
    resetPrivateDriveKeyCache()
    assert.equal(rememberPrivateDriveId(syncedStore, phoneDriveId), true)

    // Desktop side: a real unencrypted corestore (hyper-private) with a file.
    mkdirSync(join(sourcePath, 'hyper-private'), { recursive: true })
    const desktop = await createSDK({
      storage: join(sourcePath, 'hyper-private'),
      swarmOpts: SWARM_OFF,
      autoJoin: false,
      doReplicate: false
    })
    sdks.push(desktop)
    const desktopDrive = await desktop.getDrive('mydrive')
    await desktopDrive.put('/desktop-note.txt', Buffer.from('from the desktop'))
    const desktopDriveId = Buffer.from(desktopDrive.key).toString('hex').toLowerCase()
    await desktop.corestore.flush?.().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 300))
    await desktop.close()

    writeFileSync(join(sourcePath, 'privateHyperdrives.json'), JSON.stringify([{
      name: 'files',
      url: `hyper://${desktopDriveId}/`,
      timestamp: 1700000000000
    }]))

    const adoption = adoptTransferredPrivateDrive(sourcePath, syncedStore)
    assert.equal(adoption.adopted, true)
    assert.equal(adoption.encrypted, false)

    // The phone's own key and drive stay primary and intact.
    assert.equal(getPrivateDriveKey(syncedStore).toString('hex'), phoneKey.toString('hex'))
    assert.equal(getPrivateDriveId(syncedStore), phoneDriveId)

    const adopted = readSyncedPrivateAdoptedDrives(syncedStore)
    assert.equal(adopted.length, 1)
    assert.equal(adopted[0].driveId, desktopDriveId)
    assert.equal(adopted[0].encrypted, false)
    assert.equal(adopted[0].announce, false)

    // Reopen the PHONE store (its own directory, never merged): same key,
    // same namespace, must still read its file.
    const reopenedPhone = await createSDK({
      storage: syncedStore,
      swarmOpts: SWARM_OFF,
      autoJoin: false,
      doReplicate: false
    })
    sdks.push(reopenedPhone)
    const phoneDrive = trackDrive(new Hyperdrive(
      reopenedPhone.namespace(HYPERDRIVE_PRIVATE_DRIVE_NAME),
      HexToBinary(phoneDriveId),
      { encryptionKey: getPrivateDriveKey(syncedStore) }
    ))
    await phoneDrive.ready()
    assert.equal(Buffer.from(await phoneDrive.get('/phone-note.txt')).toString(), 'on the phone')
    await phoneDrive.close()

    // Reopen the ADOPTED store: unencrypted desktop drive from its own store.
    const reopenedAdopted = await createSDK({
      storage: adoptedStore,
      corestoreOpts: { allowBackup: true },
      swarmOpts: SWARM_OFF,
      autoJoin: false,
      doReplicate: false
    })
    sdks.push(reopenedAdopted)
    const desktopDrive2 = trackDrive(new Hyperdrive(reopenedAdopted.corestore, HexToBinary(desktopDriveId)))
    await desktopDrive2.ready()
    assert.equal(Buffer.from(await desktopDrive2.get('/desktop-note.txt')).toString(), 'from the desktop')

    // Double-check the phone store again after the adopted store was opened:
    // the overlay bug left the phone store unreadable ("Invalid device file");
    // with separate stores it must still open and read.
    const phoneDriveAgain = trackDrive(new Hyperdrive(
      reopenedPhone.namespace(HYPERDRIVE_PRIVATE_DRIVE_NAME),
      HexToBinary(phoneDriveId),
      { encryptionKey: getPrivateDriveKey(syncedStore) }
    ))
    await phoneDriveAgain.ready()
    assert.equal(Buffer.from(await phoneDriveAgain.get('/phone-note.txt')).toString(), 'on the phone')
  })
})

function HexToBinary (hex) {
  return Buffer.from(hex, 'hex')
}

function BinaryToHex (binary) {
  return Buffer.from(binary).toString('hex')
}
