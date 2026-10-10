// The phone meets its other devices only once a desktop has linked it, and
// only on the private store that replicates. These run the real runtime, as
// the app does, with the worklet's files in a folder of their own.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  closeHyperRuntime,
  ensureDeviceSync,
  forgetDeviceSyncDevice,
  getDeviceSyncSnapshot,
  setDeviceSyncMetered
} from '../../backend/hyper/runtime.mjs'
import { recordDeviceHello, recordDriveListing } from '../../backend/hyper/device-sync-state.mjs'

const dir = await mkdtemp(path.join(tmpdir(), 'peersky-device-sync-runtime-'))
// Set only once everything is loaded: some packages take a Bare global to
// mean they are running in Bare.
globalThis.Bare = { argv: [path.join(dir, 'hyper-storage')] }

function within (promise, ms, what) {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} still waiting after ${ms / 1000}s`)), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

test.after(async () => {
  const closed = await within(closeHyperRuntime(), 10_000, 'closing the stores').then(() => true, () => false)
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  if (!closed) setTimeout(() => process.exit(1), 500)
})

test('a phone no desktop has linked starts nothing and opens no store', async () => {
  assert.equal(await ensureDeviceSync(), false)
  assert.equal(existsSync(path.join(dir, 'hyper-sdk-synced-private')), false)
  assert.deepEqual(getDeviceSyncSnapshot(), { linked: false, running: false, devices: [], files: [] })
})

test('a linked phone meets its devices on the private store, and stops with it', async () => {
  // What a desktop transfer leaves at the top of the phone's files.
  await writeFile(path.join(dir, 'private-drive-key.json'), JSON.stringify({
    version: 2,
    createdAt: new Date().toISOString(),
    key: '5a'.repeat(32)
  }))

  assert.equal(await within(ensureDeviceSync(), 20_000, 'starting the sync'), true)
  assert.equal(existsSync(path.join(dir, 'hyper-sdk-synced-private')), true)
  let snapshot = getDeviceSyncSnapshot()
  assert.equal(snapshot.linked, true)
  assert.equal(snapshot.running, true)
  // Asking again starts nothing new.
  assert.equal(await ensureDeviceSync(), true)
  setDeviceSyncMetered(true)
  setDeviceSyncMetered(false)

  // What Settings and Hyperdrive read: each device, and each file with the
  // device it is on and an address to open it at.
  const desktop = '7c'.repeat(32)
  const drive = 'd1'.repeat(32)
  recordDeviceHello(dir, { id: desktop, type: 'desktop', drives: [drive], now: 1000 })
  recordDriveListing(dir, drive, { items: [{ type: 'file', name: 'notes.pdf', path: '/notes.pdf', byteLength: 2048 }] })
  snapshot = getDeviceSyncSnapshot()
  assert.deepEqual(snapshot.devices, [{ id: desktop, type: 'desktop', online: false, firstSeen: 1000, lastSeen: 1000 }])
  assert.deepEqual(snapshot.files, [{
    type: 'file',
    name: 'notes.pdf',
    path: '/notes.pdf',
    byteLength: 2048,
    deviceId: desktop,
    deviceType: 'desktop',
    driveId: drive,
    url: `hyper://${drive}/notes.pdf`
  }])

  assert.equal(forgetDeviceSyncDevice(desktop), true)
  assert.deepEqual(getDeviceSyncSnapshot().devices, [])

  await within(closeHyperRuntime(), 10_000, 'closing the stores')
  assert.equal(getDeviceSyncSnapshot().running, false)
})
