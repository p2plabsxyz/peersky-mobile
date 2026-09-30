import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import b4a from 'b4a'
import Corestore from 'corestore'
import {
  getPrivateDriveKey,
  getPrivateDriveKeyRecord,
  linkedPrivateDriveKey,
  resetPrivateDriveKeyCache
} from '../../backend/hyper/private-keys.mjs'
import { adoptTransferredPrivateDrive } from '../../backend/backup/private-drive-import.mjs'
import { readSyncedPrivateAdoptedDrives } from '../../backend/hyper/runtime-routing.mjs'
import { isLinkedPrivateKey } from '../../app/hyperdrive/private-upload.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const hex = (bytes) => b4a.toString(bytes, 'hex')

async function tempDir (t) {
  const dir = await mkdtemp(join(tmpdir(), 'peersky-linked-key-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function writeJson (path, value) {
  writeFileSync(path, JSON.stringify(value))
}

describe('private uploads use the key the desktop sent', () => {
  it('a phone with no key of its own takes the desktop\'s', async (t) => {
    resetPrivateDriveKeyCache()
    t.after(() => resetPrivateDriveKeyCache())
    const storagePath = await tempDir(t)
    const synced = join(storagePath, 'hyper-sdk-synced-private')
    mkdirSync(synced, { recursive: true })
    writeJson(join(storagePath, 'private-drive-key.json'), { version: 3, key: 'd'.repeat(64), encrypted: true, source: 'desktop', entries: [] })

    const linked = linkedPrivateDriveKey(storagePath)
    assert.equal(hex(linked), 'd'.repeat(64))
    const key = getPrivateDriveKey(synced, { linkedKey: linked })
    assert.equal(hex(key), 'd'.repeat(64))
    assert.equal(hex(getPrivateDriveKeyRecord(synced).key), 'd'.repeat(64))
  })

  it('a key already made is never swapped, or its files would be lost', async (t) => {
    resetPrivateDriveKeyCache()
    t.after(() => resetPrivateDriveKeyCache())
    const storagePath = await tempDir(t)
    const synced = join(storagePath, 'hyper-sdk-synced-private')
    mkdirSync(synced, { recursive: true })
    writeJson(join(synced, 'private-drive-key.json'), { version: 2, key: 'a'.repeat(64) })

    const key = getPrivateDriveKey(synced, { linkedKey: b4a.from('d'.repeat(64), 'hex') })
    assert.equal(hex(key), 'a'.repeat(64))
  })

  it('without a desktop, a phone makes a key of its own as before', async (t) => {
    resetPrivateDriveKeyCache()
    t.after(() => resetPrivateDriveKeyCache())
    const storagePath = await tempDir(t)
    const synced = join(storagePath, 'hyper-sdk-synced-private')
    mkdirSync(synced, { recursive: true })

    assert.equal(linkedPrivateDriveKey(storagePath), null)
    const key = getPrivateDriveKey(synced, { linkedKey: linkedPrivateDriveKey(storagePath) })
    assert.equal(key.byteLength, 32)
    assert.notEqual(hex(key), 'd'.repeat(64))
  })

  it('the phone\'s own drive coming back from the desktop is not adopted as the desktop\'s', async (t) => {
    const storagePath = await tempDir(t)
    const synced = join(storagePath, 'hyper-sdk-synced-private')
    mkdirSync(synced, { recursive: true })
    const own = 'e'.repeat(64)
    const desktopDrive = 'f'.repeat(64)
    writeJson(join(synced, 'private-drive-key.json'), { version: 2, key: 'd'.repeat(64), driveId: own })
    writeJson(join(storagePath, 'private-drive-key.json'), {
      version: 3,
      key: 'd'.repeat(64),
      driveId: desktopDrive,
      encrypted: true,
      announce: true,
      source: 'desktop',
      entries: [{ driveId: desktopDrive }, { driveId: own }]
    })

    const adoption = adoptTransferredPrivateDrive(storagePath, synced, join(storagePath, 'hyper-sdk-adopted'))
    assert.equal(adoption.adopted, true)
    assert.deepEqual(adoption.driveIds, [desktopDrive])
    assert.deepEqual(readSyncedPrivateAdoptedDrives(synced).map((entry) => entry.driveId), [desktopDrive])
  })

  it('a drive adopted before the phone had a private store stays known once the store opens', async (t) => {
    const storagePath = await tempDir(t)
    const synced = join(storagePath, 'hyper-sdk-synced-private')
    const phoneDrive = 'a'.repeat(64)
    const secondDrive = 'b'.repeat(64)
    const desktopKey = (fill) => ({
      version: 3,
      key: 'd'.repeat(64),
      encrypted: true,
      announce: true,
      source: 'desktop',
      entries: [{ driveId: fill, key: 'c'.repeat(64) }]
    })

    // A phone linked before its first private upload: nothing in the
    // private store's folder but the marker the adoption writes.
    writeJson(join(storagePath, 'private-drive-key.json'), desktopKey(phoneDrive))
    assert.equal(adoptTransferredPrivateDrive(storagePath, synced, join(storagePath, 'hyper-sdk-adopted')).adopted, true)

    // The storage layer moves what it does not know into db/ as it opens.
    const store = new Corestore(synced)
    await store.ready()
    await store.close()
    assert.equal(existsSync(join(synced, 'adopted-corestore.json')), false)
    assert.deepEqual(readSyncedPrivateAdoptedDrives(synced).map((entry) => [entry.driveId, entry.key]), [[phoneDrive, 'c'.repeat(64)]])

    // The next adoption keeps it, and puts the marker back where it belongs.
    writeJson(join(storagePath, 'private-drive-key.json'), desktopKey(secondDrive))
    assert.equal(adoptTransferredPrivateDrive(storagePath, synced, join(storagePath, 'hyper-sdk-adopted')).adopted, true)
    assert.equal(existsSync(join(synced, 'adopted-corestore.json')), true)
    assert.equal(existsSync(join(synced, 'db', 'adopted-corestore.json')), false)
    assert.deepEqual(readSyncedPrivateAdoptedDrives(synced).map((entry) => entry.driveId), [phoneDrive, secondDrive])
  })

  it('the screen asks to link the desktop before a private upload', async () => {
    assert.equal(isLinkedPrivateKey(JSON.stringify({ version: 3, key: 'd'.repeat(64), encrypted: true })), true)
    assert.equal(isLinkedPrivateKey(JSON.stringify({ version: 3, key: 'd'.repeat(64), encrypted: false })), false)
    assert.equal(isLinkedPrivateKey(JSON.stringify({ version: 3, driveId: 'e'.repeat(64) })), false)
    assert.equal(isLinkedPrivateKey('not json'), false)

    const screen = await read('app/hyperdrive/HyperdriveScreen.tsx')
    assert.match(screen, /\{ text: 'Private', onPress: \(\) => choosePrivate\(source\) \}/)
    const gate = screen.slice(screen.indexOf('function choosePrivate'), screen.indexOf('async function uploadFile'))
    assert.match(gate, /if \(hasLinkedIdentity\(\)\) \{\s*void uploadFile\('private', source\)/)
    assert.match(gate, /'Link PeerSky Desktop first'/)
    assert.match(gate, /\{ text: 'This device only', onPress: \(\) => void uploadFile\('device', source\) \}/)
    assert.match(gate, /\{ text: 'Link Device', onPress: onOpenLinkDevice \}/)

    const app = await read('app/index.tsx')
    assert.match(app, /onOpenLinkDevice=\{\(\) => \{\s*setBrowserSettingsInitialPage\('link-device'\)/)
  })
})
