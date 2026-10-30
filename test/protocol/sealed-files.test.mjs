import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  PRIVATE_DRIVE_KEY_FILE,
  resetPrivateDriveKeyCache
} from '../../backend/hyper/private-keys.mjs'
import { PRIVATE_DRIVE_REGISTRY_FILE, readPrivateDriveRecords } from '../../backend/hyperdrive-viewer/drive-names.mjs'
import {
  DEVICE_SYNC_FILE,
  readDeviceSyncState,
  recordDeviceHello,
  recordDriveListing,
  resetDeviceSyncStateCache
} from '../../backend/hyper/device-sync-state.mjs'
import { P2P_IDENTITY_ENTRIES } from '../../backend/hyper/p2p-reset.mjs'
import { openText, sealText } from '../../app/privacy/sealed-text.mjs'
import { isLinkedPrivateKeyFile } from '../../app/hyperdrive/private-upload.mjs'
import {
  decideLocalSealKey,
  LOCAL_SEAL_KEY_CHECK_FILE,
  LOCAL_SEALED_FILES,
  localSealKeyCheckFromDigest,
  localSealKeyCheckInput,
  parseLocalSealKeyCheck,
  serializeLocalSealKeyCheck
} from '../../app/privacy/local-seal-key-state.mjs'

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

// Android's secure storage gives back nothing, and deletes what it held, when
// its Keystore key is gone or cannot open the value. The app made a new key
// then, which left every file the old one locked shut for good, and the
// backend, with no key, wrote over them in the open.
describe('a seal key made on this phone is never made again', () => {
  let dir
  const check = (key) => localSealKeyCheckFromDigest(createHash('sha256').update(localSealKeyCheckInput(key)).digest('hex'))
  const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'peersky-seal-key-'))
    resetPrivateDriveKeyCache()
    resetDeviceSyncStateCache()
  })

  afterEach(() => {
    setLocalSealKey(null)
    resetPrivateDriveKeyCache()
    resetDeviceSyncStateCache()
    rmSync(dir, { recursive: true, force: true })
  })

  it('makes the first key only where none was made', () => {
    assert.equal(decideLocalSealKey({ storedKey: null, storedKeyCheck: '', check: null, lockedFiles: false }), 'make')
    // A check kept, or a file a key locked: one was made here.
    assert.equal(decideLocalSealKey({ storedKey: null, storedKeyCheck: '', check: check(KEY), lockedFiles: false }), 'missing')
    assert.equal(decideLocalSealKey({ storedKey: null, storedKeyCheck: '', check: null, lockedFiles: true }), 'missing')
    assert.equal(decideLocalSealKey({ storedKey: 'not a key', storedKeyCheck: '', check: check(KEY), lockedFiles: false }), 'missing')
  })

  it('uses the key that comes back, if it is the one the check was made from', () => {
    assert.equal(decideLocalSealKey({ storedKey: KEY, storedKeyCheck: check(KEY), check: check(KEY), lockedFiles: true }), 'use')
    // Made before the check was kept: the check is made from it now.
    assert.equal(decideLocalSealKey({ storedKey: KEY, storedKeyCheck: check(KEY), check: null, lockedFiles: true }), 'use')
    assert.equal(decideLocalSealKey({ storedKey: OTHER_KEY, storedKeyCheck: check(OTHER_KEY), check: check(KEY), lockedFiles: false }), 'missing')
  })

  it('keeps a check that says nothing of the key', () => {
    const text = serializeLocalSealKeyCheck(check(KEY))
    assert.equal(parseLocalSealKeyCheck(text), check(KEY))
    assert.ok(!text.includes(KEY))
    assert.equal(check(KEY).length, 32)
    assert.notEqual(check(KEY), check(OTHER_KEY))
    for (const bad of ['', 'x', JSON.stringify({ version: 2, check: check(KEY) }), JSON.stringify({ version: 1, check: 'short' })]) {
      assert.equal(parseLocalSealKeyCheck(bad), null, bad)
    }
  })

  it('looks for the files the backend really locks, and a clear takes the check', () => {
    for (const name of [
      PRIVATE_DRIVE_KEY_FILE,
      PRIVATE_DRIVE_REGISTRY_FILE,
      DEVICE_SYNC_FILE,
      'hyperdrive-recents.json',
      `hyper-sdk-synced-private/${PRIVATE_DRIVE_KEY_FILE}`
    ]) {
      assert.ok(LOCAL_SEALED_FILES.includes(name), name)
    }
    assert.ok(P2P_IDENTITY_ENTRIES.includes(LOCAL_SEAL_KEY_CHECK_FILE))
  })

  it('writes nothing it would lock while the key made here is missing', () => {
    setLocalSealKey(KEY)
    const keyFile = join(dir, 'private-drive-key.json')
    getPrivateDriveKey(dir)
    const drive = '17'.repeat(32)
    recordDeviceHello(dir, { id: '28'.repeat(32), type: 'desktop', drives: [drive] })
    const listFile = join(dir, 'device-sync.json')
    const lockedKey = readFileSync(keyFile)
    const lockedList = readFileSync(listFile)

    setLocalSealKey('', { missing: true })
    resetPrivateDriveKeyCache()
    resetDeviceSyncStateCache()
    assert.equal(canSeal(), false)
    assert.throws(() => writeSealedJson(keyFile, { version: 2, key: 'c3'.repeat(32) }), { code: 'SEAL_KEY_MISSING' })
    assert.throws(() => getPrivateDriveKey(dir))
    recordDeviceHello(dir, { id: '39'.repeat(32), type: 'desktop', drives: [] })
    assert.deepEqual(readFileSync(keyFile), lockedKey)
    assert.deepEqual(readFileSync(listFile), lockedList)
    assert.throws(() => writeSealedJson(join(dir, 'new.json'), { a: 1 }), { code: 'SEAL_KEY_MISSING' })
    assert.equal(existsSync(join(dir, 'new.json')), false)
    assert.deepEqual(sealFilesAtRest([keyFile]), [])

    // A phone with no secure storage at all writes them as it always did.
    setLocalSealKey('')
    writeSealedJson(join(dir, 'plain.json'), { b: 1 })
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'plain.json'), 'utf8')), { b: 1 })
  })

  it('the app reads its check first and tells the backend when the key is missing', () => {
    const app = read('app/privacy/local-seal-key.ts')
    assert.ok(app.indexOf('const check = readCheck(checkFile)') < app.indexOf('SecureStore.getItemAsync(ITEM, OPTIONS)'))
    assert.match(app, /if \(decision === 'missing'\) \{\s+missing = true[\s\S]{0,200}return null/)
    assert.match(app, /if \(decision === 'make'\) \{\s+value = toHex\(getRandomBytes\(32\)\)/)
    assert.equal(app.match(/getRandomBytes\(32\)/g)?.length, 1)
    // Not read at all, with a key made here before, is missing too.
    assert.match(app, /missing = Boolean\(check\) \|\| lockedFiles/)

    assert.match(read('app/backend.ts'), /\[getBackendStoragePath\(\), sealKey \|\| '', isLocalSealKeyMissing\(\) \? 'missing' : ''\]/)
    assert.match(read('backend/main.mjs'), /setLocalSealKey\(Bare\.argv\[1\], \{ missing: Bare\.argv\[2\] === 'missing' \}\)/)
    assert.match(read('app/hyperdrive/recents-store.ts'), /if \(!key && isLocalSealKeyMissing\(\)\) return false/)
  })
})
