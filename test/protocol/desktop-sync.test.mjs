import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createDecipheriv, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import b4a from 'b4a'
import sodium from 'sodium-native'
import { crc32, createStoredZip } from '../../backend/backup/zip-writer.mjs'
import { readZipEntries } from '../../backend/backup/zip.mjs'
import { openZipFile } from '../../backend/backup/zip-file.mjs'
import {
  collectDesktopSync,
  createDesktopTransfer,
  DESKTOP_TRANSFER_FILE_NAME,
  PHONE_BOOKMARKS_FILE,
  PHONE_PRIVATE_DRIVES_FILE,
  PHONE_TABS_FILE,
  sharedPrivateDrives
} from '../../backend/backup/desktop-sync.mjs'
import {
  deriveVerificationCode,
  IDENTITY_PAYLOAD_NAME,
  IDENTITY_TRANSFER_KIND,
  MANIFEST_NAME,
  verifyIdentityTransferSignature
} from '../../backend/backup/identity-transfer.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

async function tempDir (t) {
  const dir = await mkdtemp(join(tmpdir(), 'peersky-desktop-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function keyPair (kind) {
  if (kind === 'sign') {
    const publicKey = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
    const secretKey = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_keypair(publicKey, secretKey)
    return { publicKey, secretKey }
  }
  const publicKey = b4a.alloc(sodium.crypto_box_PUBLICKEYBYTES)
  const secretKey = b4a.alloc(sodium.crypto_box_SECRETKEYBYTES)
  sodium.crypto_box_keypair(publicKey, secretKey)
  return { publicKey, secretKey }
}

function deviceKeys () {
  return { signing: keyPair('sign'), encryption: keyPair('box') }
}

const hex = (bytes) => b4a.toString(bytes, 'hex')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function writeJson (path, value) {
  writeFileSync(path, JSON.stringify(value))
}

function seedBrowser (storagePath) {
  writeJson(join(storagePath, 'browser-tabs.json'), {
    version: 2,
    activeTabId: 'tab-1',
    nextTabIndex: 4,
    tabs: [
      {
        id: 'tab-1',
        title: 'Second page',
        history: [
          { url: 'https://example.com/first', source: { kind: 'web' } },
          { url: 'https://example.com/second', source: { kind: 'web' } }
        ],
        historyIndex: 1,
        entry: { url: 'https://example.com/first', source: { kind: 'web' } }
      },
      { id: 'tab-2', title: 'Home', history: [{ url: 'peersky://home', source: { kind: 'home' } }], historyIndex: 0 },
      { id: 'tab-3', title: '  A   drive  ', history: [{ url: 'hyper://blog.example/', source: { kind: 'p2p' } }], historyIndex: 0 },
      { id: 'tab-4', title: 'Again', history: [{ url: 'https://example.com/second', source: { kind: 'web' } }], historyIndex: 0 }
    ]
  })
  writeJson(join(storagePath, 'browser-bookmarks.json'), {
    items: [
      { url: 'https://news.example/', title: 'News', createdAt: 1700000000000 },
      { url: 'peersky://settings', title: 'Settings', createdAt: 1 }
    ]
  })
  writeJson(join(storagePath, 'browser-favourites.json'), {
    items: [
      { url: 'https://news.example/', title: 'News again', createdAt: 5 },
      { url: 'hyper://docs.example/', title: 'Docs', createdAt: 1700000001000 }
    ]
  })
}

function openDesktopTransfer (outer, target) {
  const entries = readZipEntries(outer)
  const byName = new Map(entries.map((entry) => [entry.name, entry.bytes]))
  const manifest = JSON.parse(b4a.toString(byName.get(MANIFEST_NAME)))
  const payload = byName.get(IDENTITY_PAYLOAD_NAME)
  const transfer = manifest.identityTransfer

  const contentKey = b4a.alloc(32)
  assert.ok(sodium.crypto_box_seal_open(contentKey, b4a.from(transfer.encryptedKey, 'hex'), target.publicKey, target.secretKey))
  const decipher = createDecipheriv('aes-256-gcm', contentKey, b4a.from(transfer.iv, 'hex'))
  decipher.setAuthTag(b4a.from(transfer.authTag, 'hex'))
  const inner = b4a.concat([decipher.update(payload), decipher.final()])
  const innerFiles = new Map(readZipEntries(inner).map((entry) => [entry.name, entry.bytes]))
  return { manifest, transfer, payload, innerFiles }
}

describe('the zip a phone hands a desktop', () => {
  it('uses the standard CRC-32', () => {
    assert.equal(crc32(b4a.from('123456789')), 0xcbf43926)
    assert.equal(crc32(b4a.alloc(0)), 0)
  })

  it('is read back entry for entry by both zip readers', async (t) => {
    const dir = await tempDir(t)
    const entries = [
      { name: 'manifest.json', bytes: b4a.from('{"a":1}') },
      { name: 'empty.bin', bytes: b4a.alloc(0) },
      { name: 'data.bin', bytes: b4a.from(Array.from({ length: 70000 }, (_, i) => i % 251)) }
    ]
    const zip = createStoredZip(entries)

    const parsed = readZipEntries(zip)
    assert.deepEqual(parsed.map((entry) => entry.name), entries.map((entry) => entry.name))
    for (const [index, entry] of parsed.entries()) assert.ok(b4a.equals(entry.bytes, entries[index].bytes))

    const path = join(dir, 'stored.zip')
    writeFileSync(path, zip)
    const file = openZipFile(path)
    try {
      const data = await file.readEntry(file.find('data.bin'))
      assert.ok(b4a.equals(data, entries[2].bytes))
    } finally {
      file.close()
    }
  })
})

describe('what a phone sends a desktop', () => {
  it('takes each tab at the page it is on, and the bookmarks and favourites once each', async (t) => {
    const storagePath = await tempDir(t)
    seedBrowser(storagePath)

    const sync = collectDesktopSync({ storagePath, syncedPrivatePath: join(storagePath, 'hyper-sdk-synced-private') })
    assert.deepEqual(sync.tabs, [
      { url: 'https://example.com/second', title: 'Second page' },
      { url: 'hyper://blog.example/', title: 'A drive' }
    ])
    assert.deepEqual(sync.bookmarks, [
      { url: 'https://news.example/', title: 'News', createdAt: 1700000000000 },
      { url: 'hyper://docs.example/', title: 'Docs', createdAt: 1700000001000 }
    ])
    assert.deepEqual(sync.privateDrives, [])
  })

  it('offers the private drive only when it uses the key the desktop sent', async (t) => {
    const storagePath = await tempDir(t)
    const synced = join(storagePath, 'hyper-sdk-synced-private')
    mkdirSync(synced, { recursive: true })
    const desktopKey = 'd'.repeat(64)
    const driveId = 'e'.repeat(64)

    // No desktop yet: the phone's drive is its own.
    writeJson(join(synced, 'private-drive-key.json'), { version: 2, key: 'a'.repeat(64), driveId })
    assert.deepEqual(sharedPrivateDrives(storagePath, synced), [])

    // A desktop sent its key, but the drive was made before, with the phone's.
    writeJson(join(storagePath, 'private-drive-key.json'), { version: 3, key: desktopKey, encrypted: true, source: 'desktop', entries: [] })
    assert.deepEqual(sharedPrivateDrives(storagePath, synced), [])

    // Made with the desktop's key: the desktop can open it.
    writeJson(join(synced, 'private-drive-key.json'), { version: 2, key: desktopKey, driveId })
    assert.deepEqual(sharedPrivateDrives(storagePath, synced), [{ driveId }])

    // A desktop that keeps private files on itself only sends no usable key.
    writeJson(join(storagePath, 'private-drive-key.json'), { version: 3, key: desktopKey, encrypted: false, driveId })
    assert.deepEqual(sharedPrivateDrives(storagePath, synced), [])
  })

  it('is a desktop identity transfer, sealed to the desktop, with the code both screens show', async (t) => {
    const storagePath = await tempDir(t)
    seedBrowser(storagePath)
    writeJson(join(storagePath, 'peersky-identity.json'), { version: 1, identityId: 'c'.repeat(64) })
    const phone = deviceKeys()
    const desktop = keyPair('box')
    const nonce = '0123456789abcdef0123456789abcdef'
    const outPath = join(storagePath, '.peersky-transfer', 'outgoing.zip')

    const created = await createDesktopTransfer({
      storagePath,
      syncedPrivatePath: join(storagePath, 'hyper-sdk-synced-private'),
      outPath,
      target: { encryptionPublicKey: hex(desktop.publicKey), nonce, deviceType: 'desktop' },
      deviceKeys: phone,
      peerskyVersion: '1.2.3',
      now: () => 1750000000000
    })

    assert.equal(created.verificationCode, deriveVerificationCode(hex(phone.signing.publicKey), hex(desktop.publicKey), nonce))
    assert.deepEqual(created.sent, { tabs: 2, bookmarks: 2, privateDrives: 0 })
    assert.equal(created.expiresAt, 1750000000000 + 15 * 60 * 1000)
    assert.equal(DESKTOP_TRANSFER_FILE_NAME, '/backup.zip')

    const outer = readFileSync(outPath)
    assert.equal(created.bytes, outer.byteLength)
    const { manifest, transfer, payload, innerFiles } = openDesktopTransfer(outer, desktop)

    // Everything the desktop checks before it decrypts anything.
    assert.equal(manifest.version, '1.0.0')
    assert.equal(manifest.kind, IDENTITY_TRANSFER_KIND)
    assert.equal(transfer.version, 1)
    assert.equal(transfer.targetDeviceType, 'desktop')
    assert.equal(transfer.identityId, 'c'.repeat(64))
    assert.match(transfer.channel, /^[0-9a-f]{64}$/)
    assert.match(transfer.encryptedKey, /^[0-9a-f]{160}$/)
    assert.match(transfer.iv, /^[0-9a-f]{24}$/)
    assert.match(transfer.authTag, /^[0-9a-f]{32}$/)
    assert.match(transfer.signature, /^[0-9a-f]{128}$/)
    assert.equal(transfer.nonce, nonce)
    assert.equal(transfer.payloadSha256, sha256(payload))
    assert.equal(transfer.expiresAt - transfer.issuedAt, 15 * 60 * 1000)
    assert.equal(verifyIdentityTransferSignature(transfer), true)
    assert.equal(verifyIdentityTransferSignature({ ...transfer, nonce: 'f'.repeat(32) }), false)

    const inner = JSON.parse(b4a.toString(innerFiles.get(MANIFEST_NAME)))
    assert.equal(inner.source, 'mobile')
    assert.deepEqual(Object.keys(inner.files).sort(), [PHONE_BOOKMARKS_FILE, PHONE_TABS_FILE])
    for (const [name, expected] of Object.entries(inner.files)) {
      assert.equal(`sha256:${sha256(innerFiles.get(name))}`, expected)
    }
    assert.equal(innerFiles.has(PHONE_PRIVATE_DRIVES_FILE), false)
    assert.deepEqual(JSON.parse(b4a.toString(innerFiles.get(PHONE_TABS_FILE))).tabs.map((tab) => tab.url), [
      'https://example.com/second',
      'hyper://blog.example/'
    ])
  })

  it('refuses a damaged code, and a phone with nothing to send', async (t) => {
    const storagePath = await tempDir(t)
    const phone = deviceKeys()
    const desktop = keyPair('box')
    const base = {
      storagePath,
      syncedPrivatePath: join(storagePath, 'hyper-sdk-synced-private'),
      outPath: join(storagePath, 'out.zip'),
      deviceKeys: phone
    }

    await assert.rejects(
      createDesktopTransfer({ ...base, target: { encryptionPublicKey: 'zz', nonce: '0'.repeat(32) } }),
      /pairing code is damaged/
    )
    await assert.rejects(
      createDesktopTransfer({ ...base, target: { encryptionPublicKey: hex(desktop.publicKey), nonce: '0'.repeat(32) } }),
      (error) => error.code === 'NOTHING_TO_SEND'
    )
  })
})

describe('sending from Link Device', () => {
  it('a desktop\'s code sends tabs and bookmarks in the desktop\'s format, with the stores left open', async () => {
    const source = await read('backend/backup/link-device.mjs')
    const send = source.slice(source.indexOf('export function sendTransfer'), source.indexOf('export async function stopOutgoingTransfer'))
    assert.doesNotMatch(send, /DESKTOP_TARGET/)
    assert.match(send, /const toDesktop = target\.deviceType === 'desktop'/)
    assert.match(send, /toDesktop\s*\? await createDesktopTransfer\(/)
    assert.match(send, /: await withStoresClosed\(\(\) => createPhoneTransfer\(/)
    assert.match(send, /fileName: toDesktop \? DESKTOP_TRANSFER_FILE_NAME : TRANSFER_FILE_NAME/)
  })
})
