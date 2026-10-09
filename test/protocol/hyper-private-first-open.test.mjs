// Settings > P2P Data spun for good on a phone with private files. Opened
// right after launch, before anything else had opened the private store, the
// listing was the first to ask for the private drive. That open waited on the
// store, and the store's last step waited on that same open, so neither ever
// finished, and everything queued behind them stuck too.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { closeHyperRuntime, getPrivateHyperRuntime, getSyncedPrivateHyperdrive } from '../../backend/hyper/runtime.mjs'
import { getPrivateDriveKey, hasPrivateDriveKey } from '../../backend/hyper/private-keys.mjs'
import { createRoutedP2pStorageRuntime, HYPERDRIVE_PRIVATE_DRIVE_NAME } from '../../backend/hyper/storage-core.mjs'

const dir = await mkdtemp(path.join(tmpdir(), 'peersky-private-first-open-'))
// Where the worklet keeps its files; the stores sit beside it. Set only once
// everything is loaded, because some packages take a Bare global to mean they
// are running in Bare.
globalThis.Bare = { argv: [path.join(dir, 'device')] }

function within (promise, ms, what) {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} still waiting after ${ms / 1000}s`)), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

test('P2P data gets the private drive when nothing has opened the private store yet', async (t) => {
  t.after(async () => {
    const closed = await within(closeHyperRuntime(), 10_000, 'closing the stores').then(() => true, () => false)
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    // A store stuck opening never closes, and its sockets would keep this
    // file, and the whole run, waiting instead of failing.
    if (!closed) setTimeout(() => process.exit(1), 500)
  })

  // A phone that has a private drive: its key is on disk, and nothing is open.
  const store = path.join(dir, 'hyper-sdk-synced-private')
  assert.ok(getPrivateDriveKey(store))

  // What the listing asks, wired as storage.mjs wires it. The other drives it
  // lists come from the public store, which this one never touches.
  const listing = createRoutedP2pStorageRuntime(null, getPrivateHyperRuntime, () => getSyncedPrivateHyperdrive(), {
    hasPrivateDrive: () => hasPrivateDriveKey(store)
  })
  const drive = await within(listing.getExistingDrive(HYPERDRIVE_PRIVATE_DRIVE_NAME), 20_000, 'the private drive')
  assert.equal(drive.writable, true)

  // The drive the store opened is the one handed out, not a second open on
  // the same core, which would wait for the first to close.
  assert.equal(await within(getSyncedPrivateHyperdrive(), 5_000, 'asking again'), drive)
})
