import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import b4a from 'b4a'
import Hyperbee from 'hyperbee'
import Hyperdrive from 'hyperdrive'
import { create as createSDK } from 'hyper-sdk'
import { discoveryKey, randomBytes } from 'hypercore-crypto'

import {
  decodesWithKey,
  isUnreadableDriveError,
  LINKED_PRIVATE_DRIVES_FILE,
  linkedPrivateDriveKeyFor,
  PRIVATE_DRIVE_ERROR,
  rememberLinkedPrivateDrive,
  resetLinkedPrivateDrivesCache
} from '../../backend/hyper/linked-private-drives.mjs'

const SWARM_OFF = { bootstrap: [], port: 0 }

function replicate (a, b) {
  const left = a.corestore.replicate(true)
  const right = b.corestore.replicate(false)
  left.pipe(right).pipe(left)
  return () => { left.destroy(); right.destroy() }
}

// A private drive the desktop made, as the public store sees it without the
// key: its first block fetched, and reading it as a header failed. That block
// is random bytes, which now and then read as a header after all and leave
// nothing to test, so a drive like that is made again.
async function makeUnreadablePrivateDrive (desktop, publicStore, key) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const made = new Hyperdrive(desktop.corestore.namespace(`private-${attempt}`), null, { encryptionKey: key })
    await made.ready()
    await made.put('/app-icon.png', b4a.from('picture bytes'))
    const seen = new Hyperdrive(publicStore.corestore.namespace(`seen-${attempt}`), made.key)
    await seen.ready()
    await seen.core.get(0, { timeout: 5000 })
    const failure = await seen.db.getHeader({ wait: false }).then(() => null, (error) => error)
    if (failure) return { made, seen, failure }
    await seen.close()
  }
  throw new Error('every drive read as a header without its key')
}

// A desktop linked to this phone made a private drive after the link. The phone
// had its key, but not the drive's address, so it read the drive from the
// public store, without the key: ciphertext, and a decoding error on screen.
test('a private drive reads as ciphertext without its key and opens with it', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'peersky-linked-'))
  const sdks = []
  t.after(async () => {
    await Promise.allSettled(sdks.map((sdk) => sdk.close()))
    await rm(root, { recursive: true, force: true })
  })
  const key = randomBytes(32)

  const desktop = await createSDK({ storage: join(root, 'desktop'), swarmOpts: SWARM_OFF, autoJoin: false })
  sdks.push(desktop)

  // The public store: no key, so the first block is not a header it can read.
  const publicStore = await createSDK({ storage: join(root, 'public'), swarmOpts: SWARM_OFF, autoJoin: false })
  sdks.push(publicStore)
  const stopPublic = replicate(desktop, publicStore)
  const { made, failure } = await makeUnreadablePrivateDrive(desktop, publicStore, key)
  stopPublic()
  assert.ok(failure, 'read without the key should fail')
  assert.equal(isUnreadableDriveError(failure), true, String(failure?.message))
  // As hypercore-fetch reports it, the stack as text.
  assert.equal(isUnreadableDriveError(String(failure.stack)), true)

  // The private store, with the linked key: the header decodes and the file reads.
  const privateStore = await createSDK({ storage: join(root, 'private'), swarmOpts: SWARM_OFF, autoJoin: false })
  sdks.push(privateStore)
  const stopPrivate = replicate(desktop, privateStore)
  const opened = new Hyperdrive(privateStore.corestore, made.key, { encryptionKey: key })
  await opened.ready()
  await opened.core.get(0, { timeout: 5000 })
  const header = await opened.db.getHeader({ wait: false })
  assert.equal(header.protocol, 'hyperbee')
  assert.equal(b4a.toString(await opened.get('/app-icon.png', { wait: true, timeout: 5000 })), 'picture bytes')

  stopPrivate()

  // The wrong key is as good as none: a phone that is not linked, or is linked
  // to another desktop, with a store of its own.
  const otherPhone = await createSDK({ storage: join(root, 'other'), swarmOpts: SWARM_OFF, autoJoin: false })
  sdks.push(otherPhone)
  const stopOther = replicate(desktop, otherPhone)
  // A wrong key reads random bytes too, which now and then read as a header
  // after all, so it is a wrong key that shows it. Read through a session, as
  // the probe does: a drive that failed to open would keep the core.
  let refused = null
  for (let attempt = 0; !refused && attempt < 20; attempt++) {
    const session = otherPhone.corestore.get({ key: made.key, encryption: { key: randomBytes(32) } })
    const bee = new Hyperbee(session)
    refused = await bee.getHeader({ wait: true, timeout: 5000 }).then(() => null, (error) => error)
    await bee.close()
    await session.close()
  }
  stopOther()
  assert.ok(refused, 'read with another key should fail')
  assert.equal(isUnreadableDriveError(refused), true)
})

// The keys are tried on the copy the public store holds. Opened in the private
// store to try, a drive under a key that does not fit would stay there. And a
// Hyperdrive takes its core for itself, so a second one waits forever on a
// drive that failed to open, as one that does not decode does once its first
// block is here.
test('a key is tried on the public copy, with nothing kept for one that does not fit', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'peersky-linked-try-'))
  const sdks = []
  const stops = []
  t.after(async () => {
    for (const stop of stops) stop()
    await Promise.allSettled(sdks.map((sdk) => sdk.close()))
    await rm(root, { recursive: true, force: true })
  })
  const key = randomBytes(32)

  const desktop = await createSDK({ storage: join(root, 'desktop'), swarmOpts: SWARM_OFF, autoJoin: false })
  sdks.push(desktop)

  const publicStore = await createSDK({ storage: join(root, 'public'), swarmOpts: SWARM_OFF, autoJoin: false })
  const privateStore = await createSDK({ storage: join(root, 'private'), swarmOpts: SWARM_OFF, autoJoin: false })
  sdks.push(publicStore, privateStore)
  stops.push(replicate(desktop, publicStore))
  const { made, seen, failure } = await makeUnreadablePrivateDrive(desktop, publicStore, key)
  assert.equal(failure?.code, 'DECODING_ERROR', String(failure))
  // With that block here, as after a restart, opening the drive fails, and
  // the drive that failed keeps its core.
  const held = publicStore.corestore.get({ key: made.key })
  await held.ready()
  await seen.close()
  const stuck = new Hyperdrive(publicStore.corestore.namespace('stuck'), made.key)
  const openFailure = await stuck.ready().then(() => null, (error) => error)
  assert.equal(openFailure?.code, 'DECODING_ERROR', String(openFailure))

  const probe = (encryptionKey) => Promise.race([
    decodesWithKey(publicStore.corestore, made.key, encryptionKey, 5000),
    new Promise((resolve) => setTimeout(() => resolve('waited'), 8000))
  ])
  assert.equal(await probe(randomBytes(32)), false)
  assert.equal(await probe(key), true)
  assert.equal(await privateStore.corestore.storage.hasCore(discoveryKey(made.key)), false)

  // Then read from the private store under the key that fit, opened once.
  stops.push(replicate(desktop, privateStore))
  const opened = new Hyperdrive(privateStore.corestore, made.key, { encryptionKey: key })
  await opened.ready()
  await opened.core.update({ wait: true })
  assert.equal(b4a.toString(await opened.get('/app-icon.png', { wait: true, timeout: 5000 })), 'picture bytes')
})

test('a drive that opened is remembered with the key that opened it', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'peersky-linked-list-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  resetLinkedPrivateDrivesCache()
  const linked = randomBytes(32)
  const own = randomBytes(32)
  const driveId = 'ab'.repeat(32)

  assert.equal(linkedPrivateDriveKeyFor(directory, driveId, [linked, own]), null)
  assert.equal(rememberLinkedPrivateDrive(directory, driveId, own), true)
  assert.ok(b4a.equals(linkedPrivateDriveKeyFor(directory, driveId, [linked, own]), own))
  // Read back from the file, as after a restart.
  resetLinkedPrivateDrivesCache()
  assert.ok(b4a.equals(linkedPrivateDriveKeyFor(directory, driveId.toUpperCase(), [linked, own]), own))
  // Under another identity, whose keys are different, it opens nothing.
  assert.equal(linkedPrivateDriveKeyFor(directory, driveId, [randomBytes(32)]), null)

  // Only a fingerprint is kept, never the key.
  const saved = await readFile(join(directory, LINKED_PRIVATE_DRIVES_FILE), 'utf8')
  assert.doesNotMatch(saved, new RegExp(b4a.toString(own, 'hex')))
  assert.match(saved, /"driveId": "abab/)

  assert.equal(rememberLinkedPrivateDrive(directory, 'not a drive', own), false)
  assert.equal(rememberLinkedPrivateDrive(directory, driveId, null), false)
})

test('only a decoding failure counts as a private drive, and it is said plainly', () => {
  assert.equal(isUnreadableDriveError('Error: Decoded message is not valid\n    at decode'), true)
  // What a phone showed for a linked desktop's new private drive.
  assert.equal(isUnreadableDriveError('HypercoreError: DECODING_ERROR: Groups are not supported (discovery key: znzb49adddaxhw7fdnxpwu85tz7qgw7snwd7xugcu4gjc)\n    at Hypercore._decode'), true)
  assert.equal(isUnreadableDriveError('HypercoreError: DECODING_ERROR: Unknown wire type: 6 (discovery key: 33ureiaiir6i9uiqge84kgig1siz1chmczdbzd1de)\n    at Hyperdrive._open'), true)
  assert.equal(isUnreadableDriveError({ code: 'DECODING_ERROR', message: 'DECODING_ERROR: Decoding error' }), true)
  assert.equal(isUnreadableDriveError('Hyper content is unavailable. Connect to the network or wait for a peer, then try again.'), false)
  assert.equal(isUnreadableDriveError('File not found'), false)
  assert.equal(isUnreadableDriveError(null), false)
  assert.match(PRIVATE_DRIVE_ERROR, /^This drive is private\. Only devices linked to the one that made it can open it\.$/)
})

test('the phone reads a linked device\'s new private drive through the private store', async () => {
  const fetchSource = await readFile(new URL('../../backend/hyper/fetch.mjs', import.meta.url), 'utf8')
  const runtime = await readFile(new URL('../../backend/hyper/runtime.mjs', import.meta.url), 'utf8')
  // Tried with the private keys only when the public store could not decode it,
  // read again if one opens it, or if another read got there first, and
  // otherwise refused in plain words.
  assert.match(fetchSource, /if \(result\?\.ok === false && isUnreadableDriveError\(result\.error\)\) \{\s+if \(await isPrivateHyperAddress\(target\.driveAddress\) \|\|\s+await adoptLinkedPrivateDriveIfReadable\(target\.driveAddress\)\) return read\(\)\s+return \{ ok: false, status: 403, error: PRIVATE_DRIVE_ERROR \}/)
  // One try per drive, however many of its files a page asks for, on the copy
  // the public store holds.
  assert.match(runtime, /if \(!adoptingLinkedDrives\.has\(id\)\) \{\s+const adopting = runtimeCoordinator\.runOperation\(\(\) => findLinkedPrivateDriveKey\(id, timeout\)\)/)
  assert.match(runtime, /const runtime = await getHyperRuntime\(\)\s+const driveKey = b4a\.from\(id, 'hex'\)\s+for \(const key of keys\) \{\s+if \(await decodesWithKey\(runtime\.corestore, driveKey, key, timeout\)\) \{/)
  // Later reads go to the synced private store with its keys.
  assert.match(runtime, /if \(isSyncedPrivateHyperdriveAddress\(address\) \|\| isLinkedPrivateHyperdriveAddress\(address\)\) \{\s+return task\(withPrivateDriveKeys\(await getSyncedPrivateHyperRuntime\(\)\)\)/)
  // And it is private to pages from other sites, like the phone's own.
  assert.match(runtime, /isLinkedPrivateHyperdriveAddress\(address\) \|\|\s+isDeviceOnlyHyperdriveAddressInternal\(address\)/)
  // Announced under its own topic, or the device that made it is never found.
  assert.match(runtime, /if \(!drive\.core\.discovery\) await runtime\.joinCore\(drive\.core\)/)
})
