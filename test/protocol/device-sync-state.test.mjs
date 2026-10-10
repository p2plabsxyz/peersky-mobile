import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'
import {
  DEVICE_SYNC_FILE,
  forgetSyncedDevice,
  MAX_SYNCED_DEVICES,
  readDeviceSyncState,
  recordDeviceHello,
  recordDeviceSeen,
  recordDriveListing,
  resetDeviceSyncStateCache,
  syncedDriveOwners
} from '../../backend/hyper/device-sync-state.mjs'

const DESKTOP = '11'.repeat(32)
const SECOND = '22'.repeat(32)
const DRIVE = 'aa'.repeat(32)
const OTHER_DRIVE = 'bb'.repeat(32)

function folder () {
  resetDeviceSyncStateCache()
  return mkdtempSync(join(tmpdir(), 'device-sync-state-'))
}

describe('device sync state', () => {
  let directory = null
  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true })
    directory = null
  })

  test('a device that says hello is listed, with what it is and its drives', () => {
    directory = folder()
    assert.deepEqual(recordDeviceHello(directory, { id: DESKTOP, type: 'desktop', drives: [DRIVE], now: 1000 }).added, [DRIVE])
    // Saying the same again adds nothing.
    assert.deepEqual(recordDeviceHello(directory, { id: DESKTOP, type: 'desktop', drives: [DRIVE], now: 2000 }).added, [])
    assert.deepEqual(recordDeviceHello(directory, { id: DESKTOP, type: 'desktop', drives: [DRIVE, OTHER_DRIVE], now: 3000 }).added, [OTHER_DRIVE])

    const [device] = readDeviceSyncState(directory).devices
    assert.deepEqual(device, { id: DESKTOP, type: 'desktop', firstSeen: 1000, lastSeen: 3000, drives: [DRIVE, OTHER_DRIVE] })

    // Read back from the file, as after a restart.
    resetDeviceSyncStateCache()
    assert.deepEqual(readDeviceSyncState(directory).devices[0], device)
    const saved = readFileSync(join(directory, DEVICE_SYNC_FILE), 'utf8')
    assert.doesNotMatch(saved, /key/i)
  })

  test('the files of a drive are kept until its device stops listing it', () => {
    directory = folder()
    recordDeviceHello(directory, { id: DESKTOP, type: 'desktop', drives: [DRIVE], now: 1000 })
    recordDriveListing(directory, DRIVE, { items: [{ type: 'file', name: 'a.pdf', path: '/a.pdf', byteLength: 12 }], now: 1500 })
    // A drive nobody listed is not kept.
    recordDriveListing(directory, OTHER_DRIVE, { items: [{ type: 'file', name: 'b.pdf', path: '/b.pdf', byteLength: 1 }] })
    let state = readDeviceSyncState(directory)
    assert.deepEqual(Object.keys(state.listings), [DRIVE])
    assert.deepEqual(state.listings[DRIVE].items, [{ type: 'file', name: 'a.pdf', path: '/a.pdf', byteLength: 12 }])

    recordDeviceHello(directory, { id: DESKTOP, type: 'desktop', drives: [OTHER_DRIVE], now: 2000 })
    state = readDeviceSyncState(directory)
    assert.deepEqual(Object.keys(state.listings), [])
  })

  test('going offline keeps the device, with when it was last seen', () => {
    directory = folder()
    recordDeviceHello(directory, { id: DESKTOP, type: 'desktop', drives: [], now: 1000 })
    recordDeviceSeen(directory, DESKTOP, 5000)
    assert.equal(readDeviceSyncState(directory).devices[0].lastSeen, 5000)
    // Nothing is made up for a device never met.
    recordDeviceSeen(directory, SECOND, 6000)
    assert.equal(readDeviceSyncState(directory).devices.length, 1)
  })

  test('the list holds the devices seen most recently, and a forgotten one goes with its files', () => {
    directory = folder()
    for (let index = 0; index < MAX_SYNCED_DEVICES + 4; index++) {
      recordDeviceHello(directory, { id: index.toString(16).padStart(64, '0'), type: index % 2 ? 'phone' : 'desktop', drives: [], now: 1000 + index })
    }
    const devices = readDeviceSyncState(directory).devices
    assert.equal(devices.length, MAX_SYNCED_DEVICES)
    assert.equal(devices[0].lastSeen, 1000 + MAX_SYNCED_DEVICES + 3)

    recordDeviceHello(directory, { id: DESKTOP, type: 'desktop', drives: [DRIVE], now: 9000 })
    recordDriveListing(directory, DRIVE, { items: [{ type: 'directory', name: 'Photos', path: '/Photos/' }] })
    assert.equal(forgetSyncedDevice(directory, DESKTOP), true)
    assert.equal(forgetSyncedDevice(directory, DESKTOP), false)
    const state = readDeviceSyncState(directory)
    assert.equal(state.devices.some((device) => device.id === DESKTOP), false)
    assert.deepEqual(state.listings, {})
  })

  test('a drive two devices list belongs to the one seen last', () => {
    directory = folder()
    recordDeviceHello(directory, { id: DESKTOP, type: 'desktop', drives: [DRIVE], now: 1000 })
    recordDeviceHello(directory, { id: SECOND, type: 'desktop', drives: [DRIVE], now: 2000 })
    assert.equal(syncedDriveOwners(directory).get(DRIVE).id, SECOND)
  })

  test('a damaged or hand-edited file reads as nothing rather than breaking', () => {
    directory = folder()
    writeFileSync(join(directory, DEVICE_SYNC_FILE), '{"version":1,"devices":[{"id":"zz","type":"desktop"},{"id":"' + DESKTOP + '","type":"toaster"}],"listings":{"x":{}}}')
    assert.deepEqual(readDeviceSyncState(directory), { version: 1, devices: [], listings: {} })
    resetDeviceSyncStateCache()
    writeFileSync(join(directory, DEVICE_SYNC_FILE), 'not json')
    assert.deepEqual(readDeviceSyncState(directory), { version: 1, devices: [], listings: {} })
    // Bad input to the writers changes nothing.
    assert.deepEqual(recordDeviceHello(directory, { id: 'short', type: 'desktop' }).added, [])
    assert.deepEqual(recordDeviceHello(directory, { id: DESKTOP, type: 'tablet' }).added, [])
  })
})
