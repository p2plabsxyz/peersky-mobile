import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import b4a from 'b4a'
import { createArchiveWriter } from '../../backend/backup/backup-archive.mjs'
import {
  canSeal,
  openSealedForBackup,
  readSealedJson,
  sealFilesAtRest,
  setLocalSealKey,
  writeSealedJson
} from '../../backend/hyper/sealed-file.mjs'
import {
  getPrivateDriveKey,
  getPrivateDriveKeyRecord,
  importPrivateDriveKey,
  resetPrivateDriveKeyCache
} from '../../backend/hyper/private-keys.mjs'
import { readPrivateDriveRecords } from '../../backend/hyperdrive-viewer/drive-names.mjs'
import {
  readDeviceSyncState,
  recordDeviceHello,
  recordDriveListing,
  resetDeviceSyncStateCache
} from '../../backend/hyper/device-sync-state.mjs'
import { openText, sealText } from '../../app/privacy/sealed-text.mjs'
import { isLinkedPrivateKeyFile } from '../../app/hyperdrive/private-upload.mjs'

// The private drive key and the names of private files sat in plain files on
// the phone. They are locked now with a key the system keeps (the Keychain,
// or under an Android Keystore key), which the app hands the backend.
const KEY = 'a1'.repeat(32)
const OTHER_KEY = 'b2'.repeat(32)
const random = (length) => new Uint8Array(Array.from({ length }, (_, i) => (i * 37 + 11) % 256))

describe('private files locked with the phone\'s secure storage', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'peersky-sealed-'))
    setLocalSealKey(KEY)
    resetPrivateDriveKeyCache()
    resetDeviceSyncStateCache()
  })

  afterEach(() => {
    setLocalSealKey(null)
    resetPrivateDriveKeyCache()
    resetDeviceSyncStateCache()
    rmSync(dir, { recursive: true, force: true })
  })

  it('makes the private drive key locked, so the file shows no key', () => {
    const key = getPrivateDriveKey(dir)
    const onDisk = readFileSync(join(dir, 'private-drive-key.json'), 'utf8')
    assert.ok(!onDisk.includes(b4a.toString(key, 'hex')))
    assert.ok(onDisk.includes('peersky-sealed'))
    resetPrivateDriveKeyCache()
    assert.ok(b4a.equals(getPrivateDriveKey(dir), key))
  })

  it('reads a key written before locking came in, and the start locks it', () => {
    const hex = 'c3'.repeat(32)
    writeFileSync(join(dir, 'private-drive-key.json'), JSON.stringify({ version: 2, key: hex }))
    assert.equal(b4a.toString(getPrivateDriveKey(dir), 'hex'), hex)
    assert.deepEqual(sealFilesAtRest([join(dir, 'private-drive-key.json')]), [join(dir, 'private-drive-key.json')])
    assert.ok(!readFileSync(join(dir, 'private-drive-key.json'), 'utf8').includes(hex))
    resetPrivateDriveKeyCache()
    assert.equal(b4a.toString(getPrivateDriveKey(dir), 'hex'), hex)
  })

  it('never makes a new key over a locked one it cannot open', () => {
    getPrivateDriveKey(dir)
    const before = readFileSync(join(dir, 'private-drive-key.json'), 'utf8')
    setLocalSealKey(OTHER_KEY)
    resetPrivateDriveKeyCache()
    assert.equal(getPrivateDriveKeyRecord(dir).locked, true)
    assert.throws(() => getPrivateDriveKey(dir), /locked/)
    assert.equal(readFileSync(join(dir, 'private-drive-key.json'), 'utf8'), before)
  })

  it('locks a key a desktop sent too', () => {
    const hex = 'd4'.repeat(32)
    importPrivateDriveKey(dir, { key: hex, driveId: 'e5'.repeat(32) })
    assert.ok(!readFileSync(join(dir, 'private-drive-key.json'), 'utf8').includes(hex))
    assert.equal(b4a.toString(getPrivateDriveKeyRecord(dir).key, 'hex'), hex)
  })

  it('reads the desktop\'s list of private drive names, locked or not', () => {
    const list = [{ name: 'passport-scan.jpg', url: `hyper://${'f6'.repeat(32)}/`, timestamp: 1 }]
    writeFileSync(join(dir, 'privateHyperdrives.json'), JSON.stringify(list))
    assert.equal(readPrivateDriveRecords(dir)[0].name, 'passport-scan.jpg')
    sealFilesAtRest([join(dir, 'privateHyperdrives.json')])
    assert.ok(!readFileSync(join(dir, 'privateHyperdrives.json'), 'utf8').includes('passport'))
    assert.equal(readPrivateDriveRecords(dir)[0].name, 'passport-scan.jpg')
  })

  it('locks the names and sizes of the files on your other devices', () => {
    const drive = '17'.repeat(32)
    recordDeviceHello(dir, { id: '28'.repeat(32), type: 'desktop', drives: [drive] })
    recordDriveListing(dir, drive, { items: [{ type: 'file', name: 'tax-return-2025.pdf', path: '/tax-return-2025.pdf', byteLength: 14000 }] })
    assert.ok(!readFileSync(join(dir, 'device-sync.json'), 'utf8').includes('tax-return'))
    resetDeviceSyncStateCache()
    assert.ok(JSON.stringify(readDeviceSyncState(dir)).includes('tax-return-2025.pdf'))
  })

  it('a backup carries locked files unlocked, since the phone it goes to has a key of its own', async () => {
    writeSealedJson(join(dir, 'private-drive-key.json'), { version: 2, key: 'c3'.repeat(32) })
    const chunks = []
    const archive = createArchiveWriter(async (bytes) => { chunks.push(bytes) })
    await archive.addFile('private-drive-key.json', join(dir, 'private-drive-key.json'))
    await archive.end()
    assert.ok(b4a.concat(chunks).includes(b4a.from('c3'.repeat(32))))
  })

  it('a backup stops at a locked file this phone cannot open, rather than packing it useless', () => {
    writeSealedJson(join(dir, 'x.json'), { a: 1 })
    setLocalSealKey(OTHER_KEY)
    assert.throws(() => openSealedForBackup(readFileSync(join(dir, 'x.json')), 'x.json'), /locked/)
  })

  it('leaves files plain when the system gave no key', () => {
    setLocalSealKey('')
    assert.equal(canSeal(), false)
    writeSealedJson(join(dir, 'x.json'), { a: 1 })
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'x.json'), 'utf8')), { a: 1 })
    assert.equal(readSealedJson(join(dir, 'x.json')).sealed, false)
  })

  // The screen asks whether a desktop's key is here before a private upload
  // or a private note. Read as plain JSON, a locked file said no, and a
  // linked phone was told to link first.
  it('the app sees a linked phone as linked once its key file is locked', () => {
    importPrivateDriveKey(dir, { key: 'd4'.repeat(32), driveId: 'e5'.repeat(32) })
    const onDisk = readFileSync(join(dir, 'private-drive-key.json'), 'utf8')
    assert.ok(onDisk.includes('peersky-sealed'))
    assert.equal(isLinkedPrivateKeyFile(onDisk, KEY), true)
    assert.equal(isLinkedPrivateKeyFile(onDisk, OTHER_KEY), false)
    assert.equal(isLinkedPrivateKeyFile(onDisk, null), false)
    assert.equal(isLinkedPrivateKeyFile(JSON.stringify({ version: 3, key: 'd4'.repeat(32) }), null), true)
    assert.equal(isLinkedPrivateKeyFile(JSON.stringify({ key: 'd4'.repeat(32), encrypted: false }), KEY), false)
    assert.equal(isLinkedPrivateKeyFile('', KEY), false)
  })

  it('the app locks the Recent list the way the backend does, so a backup opens it too', () => {
    const text = JSON.stringify([{ name: 'passport-scan.jpg', visibility: 'private' }])
    const locked = sealText(text, KEY, random)
    assert.ok(!locked.includes('passport'))
    assert.equal(openText(locked, KEY).text, text)
    writeFileSync(join(dir, 'hyperdrive-recents.json'), locked)
    assert.deepEqual(readSealedJson(join(dir, 'hyperdrive-recents.json')).value, JSON.parse(text))
    writeSealedJson(join(dir, 'from-backend.json'), { a: 'b' })
    assert.equal(openText(readFileSync(join(dir, 'from-backend.json'), 'utf8'), KEY).text, '{"a":"b"}')
    assert.throws(() => openText(locked, OTHER_KEY))
    assert.equal(openText('[1]', null).sealed, false)
  })
})
