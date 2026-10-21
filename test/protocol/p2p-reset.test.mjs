// Clear all P2P data takes this device's identity with it, as Reset P2P data
// with identities does on the desktop. It used to leave a desktop's key, the
// list of linked devices and the drives a desktop sent, so a phone that had
// cleared everything was still linked and kept syncing.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import {
  beginP2pReset,
  finishP2pReset,
  listP2pResetTargets,
  P2P_IDENTITY_ENTRIES,
  P2P_RESET_DIR,
  P2P_RESET_ID_FILE,
  P2P_RESET_TRASH_DIR,
  readP2pResetId,
  recoverP2pReset
} from '../../backend/hyper/p2p-reset.mjs'
import { DEVICE_KEY_FILE } from '../../backend/backup/device-keys.mjs'
import { PAIRING_NONCE_FILE } from '../../backend/backup/pairing-nonce.mjs'
import { PHONE_BACKUP_FILES, PHONE_BACKUP_STORES } from '../../backend/backup/phone-backup.mjs'
import { DEVICE_SYNC_FILE } from '../../backend/hyper/device-sync-state.mjs'
import { LINKED_PRIVATE_DRIVES_FILE } from '../../backend/hyper/linked-private-drives.mjs'
import { PRIVATE_DRIVE_KEY_FILE } from '../../backend/hyper/private-keys.mjs'
import { adoptedStoragePathFor, ADOPTED_STORAGE_DIR } from '../../backend/hyper/runtime-routing.mjs'
import { PEERCHAT_INCOMING_FILE } from '../../backend/peerchat/device-link.mjs'
import { P2PMD_INCOMING_FILE } from '../../backend/p2pmd/constants.mjs'

// The phone's documents folder, as the backend sees it: the stores sit beside
// the identity files, and the browser keeps its own files there too.
function documents (t) {
  const root = mkdtempSync(join(tmpdir(), 'peersky-p2p-reset-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const identityPath = join(root, 'Documents')
  const synced = join(identityPath, 'hyper-sdk-synced-private')
  const stores = [
    join(identityPath, 'hyper-sdk'),
    join(identityPath, 'hyper-sdk-private'),
    synced,
    adoptedStoragePathFor(synced)
  ]
  for (const store of stores) mkdirSync(join(store, 'db'), { recursive: true })
  return { identityPath, stores, targets: listP2pResetTargets({ identityPath, stores }) }
}

function write (path, text = '{}') {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

// What a phone that was linked to a desktop and used every app holds.
function fillPhone ({ identityPath, stores }) {
  const [main, , synced] = stores
  write(join(main, 'peerchat-mobile.json'), '{"profile":{"username":"Sam"}}')
  write(join(main, 'peerchat-attachment-cache', 'photo.jpg'), 'jpg')
  write(join(main, 'p2pmd-public-notes.json'))
  write(join(synced, PRIVATE_DRIVE_KEY_FILE))
  write(`${main}-archive.json`)
  write(`${main}-offline.json`)
  for (const name of P2P_IDENTITY_ENTRIES) {
    if (FOLDERS.has(name)) mkdirSync(join(identityPath, name), { recursive: true })
    else write(join(identityPath, name))
  }
  write(join(identityPath, '.peersky-transfer', 'outgoing.json'))
  write(join(identityPath, 'hyper-private', 'db', 'CURRENT'), 'x')
}

const FOLDERS = new Set(['hyper-private', '.peersky-transfer'])

// What the browser keeps, which Clear all P2P data leaves alone.
const BROWSER_FILES = [
  'browser-tabs.json',
  'browser-bookmarks.json',
  'browser-favourites.json',
  'browser-history.json',
  'browser-preferences.json',
  'browser-download-sources.json',
  'peerchat-intro.json',
  'welcome-seen.json'
]

function fillBrowser ({ identityPath }) {
  for (const name of BROWSER_FILES) write(join(identityPath, name))
  write(join(identityPath, 'browser-downloads', 'report.pdf'), 'pdf')
}

describe('Clear all P2P data and this device\'s identity', () => {
  test('takes every store and the identity, and leaves the browser\'s own files', (t) => {
    const phone = documents(t)
    fillPhone(phone)
    fillBrowser(phone)

    beginP2pReset(phone.identityPath)
    const result = finishP2pReset(phone)

    assert.deepEqual(result.failed, [])
    for (const target of phone.targets) assert.equal(existsSync(target), false, target)
    assert.deepEqual(
      readdirSync(phone.identityPath).sort(),
      [...BROWSER_FILES, 'browser-downloads', P2P_RESET_ID_FILE].sort()
    )
    assert.equal(existsSync(join(phone.identityPath, 'browser-downloads', 'report.pdf')), true)
  })

  // PeerTunes keeps its songs in its page's own storage, which no clear here
  // reaches, so they all stayed. Each clear gives the device a new id, and the
  // page empties its library when it sees one.
  test('each clear gives the device a new reset id, kept apart from all it removes', (t) => {
    const phone = documents(t)
    fillPhone(phone)
    const first = readP2pResetId(phone.identityPath)
    assert.match(first, /^[0-9a-f]{32}$/)
    assert.equal(readP2pResetId(phone.identityPath), first, 'the same until a clear')
    assert.equal(phone.targets.includes(join(phone.identityPath, P2P_RESET_ID_FILE)), false)

    beginP2pReset(phone.identityPath)
    finishP2pReset(phone)
    const next = readP2pResetId(phone.identityPath)
    assert.match(next, /^[0-9a-f]{32}$/)
    assert.notEqual(next, first)

    // A clear the app was killed in gets one too, as it is finished.
    beginP2pReset(phone.identityPath)
    recoverP2pReset(phone)
    assert.notEqual(readP2pResetId(phone.identityPath), next)

    // Never written outside a real documents folder.
    assert.equal(readP2pResetId('.'), '')
    assert.equal(readP2pResetId(''), '')
  })

  // Half an identity is worse than either: a desktop's key with no drives, or
  // linked devices with no key to meet them.
  test('a clear the app is killed in is finished as the backend next starts', (t) => {
    const phone = documents(t)
    fillPhone(phone)
    fillBrowser(phone)

    beginP2pReset(phone.identityPath)
    // Killed here: marked as asked for, nothing removed yet.
    assert.equal(existsSync(join(phone.identityPath, PRIVATE_DRIVE_KEY_FILE)), true)

    assert.equal(recoverP2pReset(phone), true)
    for (const target of phone.targets) assert.equal(existsSync(target), false, target)
    assert.equal(existsSync(join(phone.identityPath, P2P_RESET_DIR)), false)
    assert.equal(existsSync(join(phone.identityPath, 'browser-tabs.json')), true)
  })

  test('a clear killed while deleting what it moved leaves that to delete, and nothing made since is touched', (t) => {
    const phone = documents(t)
    // Everything was moved, and the store came up fresh before the app died.
    write(join(phone.identityPath, P2P_RESET_TRASH_DIR, '0-hyper-sdk', 'peerchat-mobile.json'))
    write(join(phone.identityPath, `${P2P_RESET_TRASH_DIR}-1`, '3-device-key.json'))
    write(join(phone.stores[0], 'peerchat-mobile.json'), '{"profile":{"username":"New"}}')

    assert.equal(recoverP2pReset(phone), false)
    assert.equal(existsSync(join(phone.identityPath, P2P_RESET_TRASH_DIR)), false)
    assert.equal(existsSync(join(phone.identityPath, `${P2P_RESET_TRASH_DIR}-1`)), false)
    assert.equal(existsSync(join(phone.stores[0], 'peerchat-mobile.json')), true)
  })

  test('a start with no clear waiting touches nothing', (t) => {
    const phone = documents(t)
    fillPhone(phone)
    assert.equal(recoverP2pReset(phone), false)
    assert.deepEqual(finishP2pReset(phone), { ok: true, removed: [], failed: [] })
    for (const name of P2P_IDENTITY_ENTRIES) assert.equal(existsSync(join(phone.identityPath, name)), true, name)
  })

  // Moved, not deleted in place, so the mark that a clear is waiting goes in
  // the same step as what it moved, under a name an older one does not hold.
  test('no mark is left once it is done, even beside what an older clear left', (t) => {
    const phone = documents(t)
    fillPhone(phone)
    mkdirSync(join(phone.identityPath, P2P_RESET_TRASH_DIR, 'stuck'), { recursive: true })

    beginP2pReset(phone.identityPath)
    finishP2pReset(phone)
    assert.equal(existsSync(join(phone.identityPath, P2P_RESET_DIR)), false)
    assert.equal(existsSync(join(phone.identityPath, `${P2P_RESET_TRASH_DIR}-1`)), false)
  })

  test('nothing outside the documents folder is ever a target', () => {
    const targets = listP2pResetTargets({
      identityPath: '/phone/Documents/',
      stores: ['/phone/Documents/hyper-sdk', '/phone/Documents/hyper-sdk', '/elsewhere/hyper-sdk', '/phone/Documents/../hyper-sdk', null, '']
    })
    assert.ok(targets.includes('/phone/Documents/hyper-sdk'))
    assert.ok(targets.includes('/phone/Documents/hyper-sdk-offline.json'))
    assert.ok(targets.every((target) => target.startsWith('/phone/Documents/') && !target.includes('..')))
    assert.equal(new Set(targets).size, targets.length)
    assert.deepEqual(listP2pResetTargets({ identityPath: '', stores: ['/phone/Documents/hyper-sdk'] }), [])
  })

  // The list is held to the names the backend and the app really write.
  test('lists the identity under the names its files really have', () => {
    for (const name of [
      DEVICE_KEY_FILE,
      PAIRING_NONCE_FILE,
      PRIVATE_DRIVE_KEY_FILE,
      LINKED_PRIVATE_DRIVES_FILE,
      DEVICE_SYNC_FILE,
      PEERCHAT_INCOMING_FILE,
      P2PMD_INCOMING_FILE,
      'peersky-identity.json',
      'privateHyperdrives.json',
      'hyper-private',
      '.peersky-transfer'
    ]) {
      assert.ok(P2P_IDENTITY_ENTRIES.includes(name), name)
    }
    assert.equal(adoptedStoragePathFor('/phone/Documents/hyper-sdk-synced-private'), `/phone/Documents/${ADOPTED_STORAGE_DIR}`)
  })

  // Of all a phone backup carries, only the browser's tabs, bookmarks,
  // history and settings, and PeerChat's intro, stay.
  test('takes all a phone backup carries but the browser\'s own files', (t) => {
    const phone = documents(t)
    const stays = new Set([
      'browser-bookmarks.json',
      'browser-favourites.json',
      'browser-history.json',
      'browser-preferences.json',
      'browser-tabs.json',
      'peerchat-intro.json'
    ])
    for (const name of [...PHONE_BACKUP_STORES, ...PHONE_BACKUP_FILES]) {
      const path = join(phone.identityPath, name)
      assert.equal(phone.targets.includes(path), !stays.has(name), name)
    }
  })
})
