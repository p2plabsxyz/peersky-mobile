import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import {
  forgetSyncedDevice,
  markDeviceFilesSeen,
  newDeviceFileCount,
  readDeviceSyncState,
  recordDeviceHello,
  recordDriveListing,
  resetDeviceSyncStateCache
} from '../../backend/hyper/device-sync-state.mjs'

// The same cases as PeerSky Desktop's test/p2p/device-sync-new-files.test.js:
// a file another device shares shows on the Hyperdrive shortcut until the
// Hyperdrive screen shows it.

const PHONE = 'd1'.repeat(32)
const DESKTOP = 'd2'.repeat(32)
const PHONE_DRIVE = 'e1'.repeat(32)
const DESKTOP_DRIVE = 'e2'.repeat(32)
const LATER_DRIVE = 'e3'.repeat(32)

const file = (name, seq) => ({ type: 'file', name, path: `/${name}`, byteLength: 1, seq })
const folder = (name, seq) => ({ type: 'directory', name, path: `/${name}/`, byteLength: 0, seq })

function list (directory, drive, items, version, now) {
  recordDriveListing(directory, drive, { items, truncated: false, version, now })
}

function reopened (directory) {
  resetDeviceSyncStateCache()
  return readDeviceSyncState(directory)
}

describe('files a linked device adds count as new until they are seen', () => {
  let directory = null
  beforeEach(() => {
    resetDeviceSyncStateCache()
    directory = mkdtempSync(join(tmpdir(), 'peersky-new-files-'))
  })
  afterEach(() => {
    resetDeviceSyncStateCache()
    if (directory) rmSync(directory, { recursive: true, force: true })
    directory = null
  })

  test('counts what a device writes after it was first listed, not what it had', () => {
    recordDeviceHello(directory, { id: PHONE, type: 'phone', drives: [PHONE_DRIVE], now: 1 })
    // Linking is not uploading: what the phone had when the two met is not new.
    list(directory, PHONE_DRIVE, [file('old.jpg', 3), folder('Trip', 5)], 8, 100)
    assert.equal(newDeviceFileCount(directory), 0)

    // The phone shares two files and then a folder.
    list(directory, PHONE_DRIVE, [file('b.jpg', 10), file('a.jpg', 9), file('old.jpg', 3), folder('Trip', 5)], 11, 200)
    assert.equal(newDeviceFileCount(directory), 2)
    list(directory, PHONE_DRIVE, [folder('Party', 12), file('b.jpg', 10), file('a.jpg', 9), file('old.jpg', 3), folder('Trip', 5)], 14, 300)
    assert.equal(newDeviceFileCount(directory), 3)

    const listed = readDeviceSyncState(directory).listings[PHONE_DRIVE].items
    assert.deepEqual(listed.map((entry) => [entry.name, entry.addedAt > 0]), [
      ['Party', true], ['b.jpg', true], ['a.jpg', true], ['old.jpg', false], ['Trip', false]
    ])
    // Kept on disk, so they are still new after a restart.
    assert.deepEqual(reopened(directory).listings[PHONE_DRIVE].items.map((item) => item.addedAt), [300, 200, 200, 0, 0])
    assert.equal(newDeviceFileCount(directory), 3)
  })

  test('is seen once the app shows the list, and only what came before', () => {
    recordDeviceHello(directory, { id: PHONE, type: 'phone', drives: [PHONE_DRIVE], now: 1 })
    list(directory, PHONE_DRIVE, [file('old.jpg', 3)], 4, 100)
    list(directory, PHONE_DRIVE, [file('new.jpg', 4), file('old.jpg', 3)], 5, 200)
    assert.equal(markDeviceFilesSeen(directory, 250), true)
    assert.equal(newDeviceFileCount(directory), 0)
    assert.equal(newDeviceFileCount(directory), 0)
    // Nothing new: nothing written.
    assert.equal(markDeviceFilesSeen(directory, 260), false)
    assert.equal(reopened(directory).seenAt, 250)

    list(directory, PHONE_DRIVE, [file('newer.jpg', 5), file('new.jpg', 4), file('old.jpg', 3)], 6, 300)
    assert.equal(newDeviceFileCount(directory), 1)
    const state = readDeviceSyncState(directory)
    assert.deepEqual(state.listings[PHONE_DRIVE].items.map((item) => item.addedAt > state.seenAt), [true, false, false])
  })

  test('stays seen if the clock is set back after a file came', () => {
    recordDeviceHello(directory, { id: PHONE, type: 'phone', drives: [PHONE_DRIVE], now: 1 })
    list(directory, PHONE_DRIVE, [], 1, 100)
    list(directory, PHONE_DRIVE, [file('a.jpg', 1)], 2, 5000)
    markDeviceFilesSeen(directory, 1000)
    assert.equal(newDeviceFileCount(directory), 0)
    assert.equal(reopened(directory).seenAt, 5000)
  })

  test('does not count an older file that only now fits in a listing cut short at a hundred', () => {
    recordDeviceHello(directory, { id: PHONE, type: 'phone', drives: [PHONE_DRIVE], now: 1 })
    recordDriveListing(directory, PHONE_DRIVE, { items: [file('a.jpg', 2)], truncated: true, version: 50, now: 100 })
    // One deleted makes room for one listed before it: old.jpg sat at 7.
    recordDriveListing(directory, PHONE_DRIVE, { items: [file('a.jpg', 2), file('old.jpg', 7)], truncated: true, version: 51, now: 200 })
    assert.equal(newDeviceFileCount(directory), 0)
  })

  test('counts a file shared again under the same name', () => {
    recordDeviceHello(directory, { id: PHONE, type: 'phone', drives: [PHONE_DRIVE], now: 1 })
    list(directory, PHONE_DRIVE, [file('scan.pdf', 2)], 3, 100)
    list(directory, PHONE_DRIVE, [file('scan.pdf', 3)], 4, 200)
    assert.equal(newDeviceFileCount(directory), 1)
  })

  test('counts all of a drive a known device starts listing later', () => {
    recordDeviceHello(directory, { id: DESKTOP, type: 'desktop', drives: [DESKTOP_DRIVE], now: 1 })
    list(directory, DESKTOP_DRIVE, [file('report.pdf', 2)], 3, 100)
    // Another desktop makes a drive for each private upload.
    recordDeviceHello(directory, { id: DESKTOP, type: 'desktop', drives: [LATER_DRIVE, DESKTOP_DRIVE], now: 2 })
    assert.equal(newDeviceFileCount(directory), 0)
    list(directory, LATER_DRIVE, [folder('Slides', 2), file('notes.txt', 1)], 3, 200)
    assert.equal(newDeviceFileCount(directory), 2)
    // Saying hello again with the same drives changes nothing.
    recordDeviceHello(directory, { id: DESKTOP, type: 'desktop', drives: [LATER_DRIVE, DESKTOP_DRIVE], now: 3 })
    list(directory, LATER_DRIVE, [folder('Slides', 2), file('notes.txt', 1)], 3, 300)
    assert.equal(newDeviceFileCount(directory), 2)
  })

  test('does not count a device met for the first time, with every drive it has', () => {
    recordDeviceHello(directory, { id: PHONE, type: 'phone', drives: [PHONE_DRIVE, LATER_DRIVE], now: 1 })
    list(directory, PHONE_DRIVE, [file('a.jpg', 1)], 2, 100)
    list(directory, LATER_DRIVE, [file('b.jpg', 1)], 2, 100)
    assert.equal(newDeviceFileCount(directory), 0)
  })

  test('reads a listing kept by an older PeerSky as seen, and counts from the next one', () => {
    recordDeviceHello(directory, { id: PHONE, type: 'phone', drives: [PHONE_DRIVE], now: 1 })
    // 1.0.1 kept no version and no marks.
    recordDriveListing(directory, PHONE_DRIVE, { items: [{ type: 'file', name: 'a.jpg', path: '/a.jpg', byteLength: 1 }], now: 50 })
    assert.equal(reopened(directory).listings[PHONE_DRIVE].version, null)
    list(directory, PHONE_DRIVE, [file('b.jpg', 9), file('a.jpg', 1)], 10, 100)
    assert.equal(newDeviceFileCount(directory), 0)
    list(directory, PHONE_DRIVE, [file('c.jpg', 10), file('b.jpg', 9), file('a.jpg', 1)], 11, 200)
    assert.equal(newDeviceFileCount(directory), 1)
  })

  test('drops the count of a device taken off the list, and counts a drive two devices list once', () => {
    recordDeviceHello(directory, { id: PHONE, type: 'phone', drives: [PHONE_DRIVE], now: 1 })
    recordDeviceHello(directory, { id: DESKTOP, type: 'desktop', drives: [], now: 1 })
    list(directory, PHONE_DRIVE, [], 1, 100)
    list(directory, PHONE_DRIVE, [file('a.jpg', 1), file('b.jpg', 2)], 3, 200)
    recordDeviceHello(directory, { id: DESKTOP, type: 'desktop', drives: [PHONE_DRIVE], now: 2 })
    assert.equal(newDeviceFileCount(directory), 2)
    forgetSyncedDevice(directory, PHONE)
    assert.equal(newDeviceFileCount(directory), 2)
    forgetSyncedDevice(directory, DESKTOP)
    assert.equal(newDeviceFileCount(directory), 0)
    assert.equal(markDeviceFilesSeen(directory, 300), false)
  })

  test('takes no marks a stored file made up', () => {
    recordDeviceHello(directory, { id: PHONE, type: 'phone', drives: [PHONE_DRIVE], now: 1 })
    list(directory, PHONE_DRIVE, [{ ...file('a.jpg', 1), addedAt: -5 }, { ...file('b.jpg', 1), addedAt: 'soon' }], null, 100)
    const items = reopened(directory).listings[PHONE_DRIVE].items
    assert.deepEqual(items.map((item) => item.addedAt), [0, 0])
    assert.equal(items.every((item) => !('seq' in item)), true)
  })
})
