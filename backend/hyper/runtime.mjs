/* global Bare */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import b4a from 'b4a'
import Hyperdrive from 'hyperdrive'
import { create as createSDK } from 'hyper-sdk'
import {
  getLANDiscoveryStatus,
  attachPrivateLANDiscovery,
  resetLANDiscovery,
  startLANDiscovery
} from './lan-discovery.mjs'
import { checkPrivateDriveDivergence } from './drive-state.mjs'
import {
  getPrivateDriveKey,
  getPrivateDriveId,
  getPrivateDriveKeyRecord,
  hasPrivateDriveKey,
  linkedPrivateDriveKey,
  rememberPrivateDriveId,
  resetPrivateDriveKeyCache
} from './private-keys.mjs'
import {
  closeRuntimeCandidates,
  createRuntimeCoordinator,
  initializeRuntimeCandidate
} from './runtime-coordinator.mjs'
import {
  adoptedStoragePathFor,
  createPrivateHyperRuntimeOptions,
  createSyncedPrivateHyperRuntimeOptions,
  isAdoptedSyncedPrivateDrive,
  matchesHyperdriveAddress,
  normalizeDriveAddressId,
  readSyncedPrivateAdoptedDrives
} from './runtime-routing.mjs'
import {
  getExistingNamedDrive,
  HYPERDRIVE_DEVICE_DRIVE_NAME,
  HYPERDRIVE_PRIVATE_DRIVE_NAME
} from './storage-core.mjs'
import { refreshHyperRuntimeNetwork } from './network-refresh.mjs'
import { shareDriveOpens } from './shared-drive-opens.mjs'
import { blockReportedDrives } from './blocked-drives.mjs'
import {
  decodesWithKey,
  linkedPrivateDriveKeyFor,
  rememberLinkedPrivateDrive,
  resetLinkedPrivateDrivesCache
} from './linked-private-drives.mjs'
import { getDefaultIdentityStoragePath } from '../backup/device-keys.mjs'

let sdk = null
let sdkOpening = null
let storagePath = null
let deviceOnlySdk = null
let deviceOnlySdkOpening = null
let deviceOnlyStoragePath = null
let deviceOnlyDriveId = null
let syncedPrivateSdk = null
let syncedPrivateSdkOpening = null
let syncedPrivateStoragePath = null
let syncedPrivateDriveId = null
let syncedPrivateDrive = null
let syncedPrivateDriveOpening = null
let adoptedSdk = null
let adoptedSdkOpening = null
let adoptedStoragePath = null
const syncedPrivateDrivesById = new Map()
const linkedPrivateDrivesById = new Map()
const adoptingLinkedDrives = new Map()
const privateDriveWarnings = new Map()
let networkRefresh = null
const runtimeCoordinator = createRuntimeCoordinator()

export function withHyperRuntimeOperation (task) {
  return runtimeCoordinator.runOperation(async () => task(await getHyperRuntime()))
}

export function withPrivateHyperRuntimeOperation (task) {
  return runtimeCoordinator.runOperation(async () => task(await getPrivateHyperRuntime()))
}

export function withSyncedPrivateHyperRuntimeOperation (task) {
  return runtimeCoordinator.runOperation(async () => task(await getSyncedPrivateHyperRuntime()))
}

export function withHyperRuntimeForAddress (address, task) {
  return runtimeCoordinator.runOperation(async () => {
    await learnSyncedPrivateDriveId()
    if (isDeviceOnlyHyperdriveAddress(address)) return task(await getPrivateHyperRuntime())
    if (isSyncedPrivateHyperdriveAddress(address) || isLinkedPrivateHyperdriveAddress(address)) {
      return task(withPrivateDriveKeys(await getSyncedPrivateHyperRuntime()))
    }
    return task(await getHyperRuntime())
  })
}

// Until this version the phone never saved which drive its private one was
// (see driveIdOf), so after a restart it could not tell a link to its own
// private files from anyone else's, and read them from the public store. A
// phone with a private key but no saved drive opens the drive once, which
// saves it.
let learningSyncedPrivateDriveId = null

async function learnSyncedPrivateDriveId () {
  if (getSyncedPrivateDriveId()) return
  const storage = syncedPrivateStoragePath || (typeof Bare !== 'undefined' ? getSyncedPrivateHyperSdkStoragePath() : null)
  if (!storage || !hasPrivateDriveKey(storage)) return
  if (!learningSyncedPrivateDriveId) {
    learningSyncedPrivateDriveId = getSyncedPrivateHyperRuntime()
      .catch(() => {})
      .finally(() => { learningSyncedPrivateDriveId = null })
  }
  await learningSyncedPrivateDriveId
}

// The SDK opens a drive by address without its encryption key, and an
// encrypted drive read that way is only ciphertext. That is how the browser
// reads (hypercore-fetch asks the SDK), so a private link never opened on
// the phone that made it. The runtime handed out for a private address gives
// back this phone's own private drive, and the drives adopted from a desktop,
// already opened with their keys; anything else goes to the SDK as before.
const keyedRuntimes = new WeakMap()

function withPrivateDriveKeys (runtime) {
  if (!runtime || typeof runtime !== 'object') return runtime
  const existing = keyedRuntimes.get(runtime)
  if (existing) return existing

  const keyed = new Proxy(runtime, {
    get (target, property) {
      if (property === 'getDrive') {
        return async (nameOrKeyOrUrl, opts) => {
          const drive = await getKeyedPrivateHyperdrive(nameOrKeyOrUrl)
          return drive || target.getDrive(nameOrKeyOrUrl, opts)
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  keyedRuntimes.set(runtime, keyed)
  return keyed
}

/**
 * This phone's own private drive or a drive adopted from a desktop, opened
 * with its key, for an address, a hex id or a raw key. Null for any other.
 */
export async function getKeyedPrivateHyperdrive (address) {
  const id = b4a.isBuffer(address) ? b4a.toString(address, 'hex') : normalizeDriveAddressId(address)
  if (!id) return null
  if (id === getSyncedPrivateDriveId()) return getSyncedPrivateHyperdrive()
  const storage = syncedPrivateStoragePath || (typeof Bare !== 'undefined' ? getSyncedPrivateHyperSdkStoragePath() : null)
  if (isAdoptedSyncedPrivateDrive(storage, id)) return getSyncedPrivateHyperdriveForId(id)
  const key = linkedPrivateDriveKeyFor(getDefaultIdentityStoragePath(), id, privateDriveKeyCandidates())
  if (key) return getLinkedPrivateHyperdrive(id, key)
  return null
}

// The keys this phone can open private drives with: the one a desktop sent when
// it linked, and the phone's own. They are one key unless the phone had made
// its own before it was linked.
function privateDriveKeyCandidates () {
  const keys = []
  const linked = linkedPrivateDriveKey(getDefaultIdentityStoragePath())
  if (linked) keys.push(linked)
  const storage = syncedPrivateStoragePath || (typeof Bare !== 'undefined' ? getSyncedPrivateHyperSdkStoragePath() : null)
  const record = storage ? getPrivateDriveKeyRecord(storage) : { ok: false }
  const own = record.ok && record.encrypted ? record.key : null
  if (own && !keys.some((key) => b4a.equals(key, own))) keys.push(own)
  return keys
}

/** A private drive a linked device made after the link, found to open here. */
export function isLinkedPrivateHyperdriveAddress (address) {
  const id = normalizeDriveAddressId(address)
  if (!id) return false
  return linkedPrivateDriveKeyFor(getDefaultIdentityStoragePath(), id, privateDriveKeyCandidates()) !== null
}

// Opened in the synced private store, which replicates, and announced under
// the drive's own topic, since that store joins nothing by itself: the device
// that made the drive is found there.
async function openLinkedPrivateHyperdrive (id, key) {
  const runtime = await getSyncedPrivateHyperRuntime()
  const drive = new Hyperdrive(runtime.corestore, b4a.from(id, 'hex'), { encryptionKey: key })
  await drive.ready()
  if (!drive.core.discovery) await runtime.joinCore(drive.core)
  return drive
}

function getLinkedPrivateHyperdrive (id, key) {
  if (linkedPrivateDrivesById.has(id)) return linkedPrivateDrivesById.get(id)
  const opening = openLinkedPrivateHyperdrive(id, key)
  linkedPrivateDrivesById.set(id, opening)
  opening.catch(() => { if (linkedPrivateDrivesById.get(id) === opening) linkedPrivateDrivesById.delete(id) })
  return opening
}

/**
 * A drive the public store could only read as ciphertext, tried with this
 * phone's private keys. One that decodes its first block is the key: the drive
 * is remembered, and later reads go to the private store. False when none
 * does, or no copy of it came back in time.
 */
export function adoptLinkedPrivateDriveIfReadable (address, { timeout = 15000 } = {}) {
  const id = normalizeDriveAddressId(address)
  if (!id) return Promise.resolve(false)
  // A page asks for several files at once, and they share one try.
  if (!adoptingLinkedDrives.has(id)) {
    const adopting = runtimeCoordinator.runOperation(() => findLinkedPrivateDriveKey(id, timeout))
      .catch(() => false)
    adoptingLinkedDrives.set(id, adopting)
    adopting.finally(() => adoptingLinkedDrives.delete(id))
  }
  return adoptingLinkedDrives.get(id)
}

// The keys are tried on the copy the public store holds, which has the first
// block already. Opened in the private store to try, a drive that is not ours
// would stay in a store Link Device copies to the next device.
async function findLinkedPrivateDriveKey (id, timeout) {
  if (isLinkedPrivateHyperdriveAddress(id)) return true
  const keys = privateDriveKeyCandidates()
  if (keys.length === 0) return false
  const runtime = await getHyperRuntime()
  const driveKey = b4a.from(id, 'hex')
  for (const key of keys) {
    if (await decodesWithKey(runtime.corestore, driveKey, key, timeout)) {
      return rememberLinkedPrivateDrive(getDefaultIdentityStoragePath(), id, key)
    }
  }
  return false
}

export function withHyperRuntimeMaintenance (task, prepare) {
  return runtimeCoordinator.runMaintenance(task, prepare)
}

// While Link Device packs or replaces the stores, nothing may open them.
// PeerChat and the storage listing open the runtime directly rather than
// through the coordinator, so a maintenance window alone does not hold them
// back: PeerChat polls every few seconds, and one poll landing mid-backup
// reopened the store and rewrote files the backup was reading.
let storesHeld = null

export function holdHyperStores () {
  let release
  const held = new Promise((resolve) => { release = resolve })
  storesHeld = held
  return () => {
    if (storesHeld === held) storesHeld = null
    release()
  }
}

async function waitForHeldStores () {
  let held = storesHeld
  while (held) {
    await held
    held = storesHeld
  }
}

export async function getHyperRuntime () {
  if (sdk) return sdk
  await waitForHeldStores()
  if (sdk) return sdk

  if (!sdkOpening) {
    storagePath = getHyperSdkStoragePath()
    sdkOpening = createSDK({ storage: storagePath })
      .then(shareDriveOpens)
      .then(blockReportedDrives)
      .then(async (runtime) => {
        await startLANDiscovery(runtime)
        sdk = runtime
        return runtime
      })
  }

  try {
    return await sdkOpening
  } finally {
    sdkOpening = null
  }
}

export async function getPrivateHyperRuntime () {
  if (deviceOnlySdk) return deviceOnlySdk
  await waitForHeldStores()
  if (deviceOnlySdk) return deviceOnlySdk

  if (!deviceOnlySdkOpening) {
    deviceOnlyStoragePath = getPrivateHyperSdkStoragePath()
    deviceOnlySdkOpening = initializeRuntimeCandidate(
      () => createSDK(createPrivateHyperRuntimeOptions(deviceOnlyStoragePath)).then(shareDriveOpens),
      async (runtime) => {
        const drive = await getExistingNamedDrive(runtime, {
          driveName: HYPERDRIVE_DEVICE_DRIVE_NAME,
          autoJoin: false
        })
        rememberDeviceOnlyHyperdrive(drive)
        deviceOnlySdk = runtime
      }
    )
  }

  try {
    return await deviceOnlySdkOpening
  } finally {
    deviceOnlySdkOpening = null
  }
}

export async function getSyncedPrivateHyperRuntime () {
  if (syncedPrivateSdk) return syncedPrivateSdk
  await waitForHeldStores()
  if (syncedPrivateSdk) return syncedPrivateSdk

  if (!syncedPrivateSdkOpening) {
    syncedPrivateStoragePath = getSyncedPrivateHyperSdkStoragePath()
    syncedPrivateSdkOpening = initializeRuntimeCandidate(
      // Found over Wi-Fi as well as the internet, as the public store is, so a
      // private file comes over the LAN with the internet down.
      () => createSDK(createSyncedPrivateHyperRuntimeOptions(syncedPrivateStoragePath))
        .then(shareDriveOpens)
        .then(async (runtime) => {
          await attachPrivateLANDiscovery(runtime)
          return runtime
        }),
      async (runtime) => {
        const drive = await getSyncedPrivateHyperdrive(runtime)
        rememberSyncedPrivateHyperdrive(drive)
        syncedPrivateSdk = runtime
      }
    )
  }

  try {
    return await syncedPrivateSdkOpening
  } finally {
    syncedPrivateSdkOpening = null
  }
}

export async function getSyncedPrivateHyperdrive (runtime = null) {
  if (runtime && syncedPrivateDrive) return syncedPrivateDrive

  if (syncedPrivateDriveOpening) return syncedPrivateDriveOpening
  if (syncedPrivateDrive) return syncedPrivateDrive

  const open = (async () => {
    const target = runtime || await getSyncedPrivateHyperRuntime()
    const storage = syncedPrivateStoragePath || getSyncedPrivateHyperSdkStoragePath()
    const driveId = getSyncedPrivateDriveId()
    const encryptionKey = getPrivateDriveKey(storage, { linkedKey: linkedPrivateDriveKey(getDefaultIdentityStoragePath()) })
    if (!driveId && !encryptionKey) throw new Error('Private drive encryption key is unavailable.')

    const announce = encryptionKey !== null && shouldAnnounceSyncedPrivateDrive(storage)
    const driveOptions = encryptionKey ? { encryptionKey } : undefined

    // Legacy guard: before received drives were made read-only, adopting a
    // desktop identity overwrote the phone's own key record, so existing
    // devices can still hold a record that points at an adopted desktop drive.
    // Treat that as an adopted drive (read-only, opened from the adopted
    // store) instead of the phone's own drive so the phone never writes the
    // desktop writer copy again.
    if (driveId && isAdoptedSyncedPrivateDrive(storage, driveId)) {
      const adoptedRuntime = await getAdoptedPrivateHyperRuntime()
      const adoptedDrive = new Hyperdrive(
        adoptedRuntime.corestore,
        b4a.from(driveId, 'hex'),
        driveOptions
      )
      await adoptedDrive.ready()
      await recordPrivateDriveDivergence(adoptedDriveHeadStatePath(), adoptedDrive)
      syncedPrivateDrive = adoptedDrive
      return adoptedDrive
    }

    // The phone's own private drive always lives in its own synced-private
    // namespace, never in the adopted store. Adopted drives (imported from a
    // desktop identity transfer) are separate, read-only on this device, and
    // are reached through getSyncedPrivateHyperdriveForId() instead. Routing
    // the phone's own open here into the adopted store would hand the phone the
    // desktop writer keys and let both devices write the same drive, silently
    // diverging their lists.
    const corestore = target.namespace(HYPERDRIVE_PRIVATE_DRIVE_NAME)
    const drive = new Hyperdrive(
      corestore,
      driveId ? b4a.from(driveId, 'hex') : undefined,
      driveOptions
    )
    await drive.ready()
    await recordPrivateDriveDivergence(storage, drive)

    if (announce && !drive.core.discovery) {
      await target.joinCore(drive.core)
    }

    syncedPrivateDrive = drive
    return drive
  })().finally(() => {
    syncedPrivateDriveOpening = null
  })

  syncedPrivateDriveOpening = open
  return open
}

export async function getSyncedPrivateHyperdriveForId (driveId, runtime = null) {
  const normalized = String(driveId || '').toLowerCase()
  if (syncedPrivateDrivesById.has(normalized)) return syncedPrivateDrivesById.get(normalized)

  const storage = syncedPrivateStoragePath || getSyncedPrivateHyperSdkStoragePath()
  const adopted = readSyncedPrivateAdoptedDrives(storage).find((entry) => entry.driveId === normalized)
  if (!adopted) return null

  // Adopted drives live in their own corestore (see runtime-routing.mjs), a
  // separate store that never replicates and never joins a swarm topic. The
  // `runtime` argument is kept for call-site compatibility but intentionally
  // ignored: adopted drives always open from the adopted store.
  const target = await getAdoptedPrivateHyperRuntime()
  const record = getPrivateDriveKeyRecord(storage)
  const legacyKey = record.ok && record.driveId === normalized ? record.key : null
  const encryptionKeyHex = adopted.key || (adopted.encrypted && legacyKey ? b4a.toString(legacyKey, 'hex') : null)
  const driveOptions = encryptionKeyHex ? { encryptionKey: b4a.from(encryptionKeyHex, 'hex') } : undefined
  const drive = new Hyperdrive(
    target.corestore,
    b4a.from(normalized, 'hex'),
    driveOptions
  )
  await drive.ready()
  await recordPrivateDriveDivergence(adoptedDriveHeadStatePath(), drive)

  syncedPrivateDrivesById.set(normalized, drive)
  return drive
}

export async function getAdoptedPrivateHyperRuntime () {
  if (adoptedSdk) return adoptedSdk
  await waitForHeldStores()
  if (adoptedSdk) return adoptedSdk

  if (!adoptedSdkOpening) {
    adoptedStoragePath = adoptedStoragePathFor(getSyncedPrivateHyperSdkStoragePath())
    adoptedSdkOpening = initializeRuntimeCandidate(
      () => createSDK({
        storage: adoptedStoragePath,
        autoJoin: false,
        doReplicate: false,
        // Received drives are read-only on this device: the desktop holds the
        // only writer keys, and the phone must never append to a drive it can
        // then diverge from. Reads of the copied cores keep working.
        corestoreOpts: { allowBackup: true, readOnly: true }
      }).then(shareDriveOpens),
      async (runtime) => {
        adoptedSdk = runtime
      }
    )
  }

  try {
    return await adoptedSdkOpening
  } finally {
    adoptedSdkOpening = null
  }
}

// Drive ids are kept as hex: that is what every lookup compares against
// (normalizeDriveAddressId turns an address into hex), and what the key
// record accepts. drive.id is the z32 form, and keeping that meant this
// phone never recognised a link to its own private or device-only drive,
// and never saved which drive its private one was.
function driveIdOf (drive) {
  if (drive?.key && b4a.isBuffer(drive.key)) return b4a.toString(drive.key, 'hex')
  return normalizeDriveAddressId(drive?.id)
}

export function rememberDeviceOnlyHyperdrive (drive) {
  const id = driveIdOf(drive)
  if (!id) return
  deviceOnlyDriveId = id

  const path = deviceOnlyStoragePath || (typeof Bare !== 'undefined' ? getPrivateHyperSdkStoragePath() : null)
  if (!path) return

  try {
    writeFileSync(join(path, 'device-drive-id.json'), JSON.stringify({ version: 1, driveId: deviceOnlyDriveId }, null, 2))
  } catch {}
}

export function rememberSyncedPrivateHyperdrive (drive) {
  const id = driveIdOf(drive)
  if (!id) return
  syncedPrivateDriveId = id

  const path = syncedPrivateStoragePath || (typeof Bare !== 'undefined' ? getSyncedPrivateHyperSdkStoragePath() : null)
  if (!path) return

  rememberPrivateDriveId(path, syncedPrivateDriveId)
}

export function isSyncedPrivateHyperdriveAddress (address) {
  return isSyncedPrivateHyperdriveAddressInternal(address)
}

export function isDeviceOnlyHyperdriveAddress (address) {
  return isDeviceOnlyHyperdriveAddressInternal(address)
}

/**
 * This phone's private drive, one adopted from a desktop, one a linked device
 * made since, or the device-only one.
 */
export async function isPrivateHyperAddress (address) {
  await learnSyncedPrivateDriveId()
  return isSyncedPrivateHyperdriveAddressInternal(address) ||
    isLinkedPrivateHyperdriveAddress(address) ||
    isDeviceOnlyHyperdriveAddressInternal(address)
}

export function getHyperStoragePath () {
  if (!storagePath && typeof Bare !== 'undefined') storagePath = getHyperSdkStoragePath()
  return storagePath
}

export function getPrivateHyperStoragePath () {
  if (!deviceOnlyStoragePath && typeof Bare !== 'undefined') {
    deviceOnlyStoragePath = getPrivateHyperSdkStoragePath()
  }
  return deviceOnlyStoragePath
}

export function getSyncedPrivateHyperStoragePath () {
  if (!syncedPrivateStoragePath && typeof Bare !== 'undefined') {
    syncedPrivateStoragePath = getSyncedPrivateHyperSdkStoragePath()
  }
  return syncedPrivateStoragePath
}

export function ensureLANDiscovery () {
  return withHyperRuntimeOperation((runtime) => startLANDiscovery(runtime))
}

export function refreshHyperNetworking () {
  if (!networkRefresh) {
    networkRefresh = withHyperRuntimeOperation(refreshHyperRuntimeNetwork)
      .finally(() => { networkRefresh = null })
  }
  return networkRefresh
}

export { getLANDiscoveryStatus }

export function getPrivateDriveWarnings () {
  return Array.from(privateDriveWarnings.entries()).map(([driveId, message]) => ({
    driveId,
    url: `hyper://${driveId}/`,
    message
  }))
}

export function getPrivateDriveWarningForDriveId (driveId) {
  const normalized = String(driveId || '').toLowerCase()
  if (privateDriveWarnings.has(normalized)) return privateDriveWarnings.get(normalized)
  return null
}

export async function closeHyperRuntime () {
  try {
    await closeRuntimeCandidates([
      sdk || sdkOpening,
      deviceOnlySdk || deviceOnlySdkOpening,
      syncedPrivateSdk || syncedPrivateSdkOpening,
      adoptedSdk || adoptedSdkOpening,
      syncedPrivateDrive
    ])
  } finally {
    sdk = null
    sdkOpening = null
    deviceOnlySdk = null
    deviceOnlySdkOpening = null
    syncedPrivateSdk = null
    syncedPrivateSdkOpening = null
    adoptedSdk = null
    adoptedSdkOpening = null
    adoptedStoragePath = null
    syncedPrivateDrive = null
    syncedPrivateDriveOpening = null
    syncedPrivateDrivesById.clear()
    linkedPrivateDrivesById.clear()
    privateDriveWarnings.clear()
    deviceOnlyDriveId = null
    syncedPrivateDriveId = null
    resetPrivateDriveKeyCache()
    resetLinkedPrivateDrivesCache()
    networkRefresh = null
    resetLANDiscovery()
  }
}

function adoptedDriveHeadStatePath () {
  return adoptedStoragePath || adoptedStoragePathFor(getSyncedPrivateHyperSdkStoragePath())
}

async function recordPrivateDriveDivergence (stateStoragePath, drive) {
  const hexId = drive?.core?.key ? b4a.toString(drive.core.key, 'hex').toLowerCase() : null
  if (!hexId || !stateStoragePath) return

  const { diverged } = await checkPrivateDriveDivergence({
    storagePath: stateStoragePath,
    driveId: hexId,
    core: drive.core
  })

  const message = 'This private drive changed on another device. It is open read-only here; copy anything you need, then re-import the identity to get the latest copy.'
  if (diverged) privateDriveWarnings.set(hexId, message)
  else privateDriveWarnings.delete(hexId)
}

function getHyperSdkStoragePath () {
  const workletStoragePath = Bare.argv[0]
  if (!workletStoragePath) return 'hyper-storage'

  // Hyper SDK needs an app-owned storage directory. Bare.argv[0] can point at
  // the mutable device file used by Bare itself, so keep Hyper data beside it.
  return joinSiblingPath(workletStoragePath, 'hyper-sdk')
}

function getPrivateHyperSdkStoragePath () {
  const workletStoragePath = Bare.argv[0]
  if (!workletStoragePath) return 'hyper-storage-private'
  return joinSiblingPath(workletStoragePath, 'hyper-sdk-private')
}

function getSyncedPrivateHyperSdkStoragePath () {
  const workletStoragePath = Bare.argv[0]
  if (!workletStoragePath) return 'hyper-storage-synced-private'
  return joinSiblingPath(workletStoragePath, 'hyper-sdk-synced-private')
}

function isDeviceOnlyHyperdriveAddressInternal (address) {
  return matchesHyperdriveAddress(address, getDeviceOnlyDriveId())
}

function isSyncedPrivateHyperdriveAddressInternal (address) {
  if (matchesHyperdriveAddress(address, getSyncedPrivateDriveId())) return true
  const storage = syncedPrivateStoragePath || (typeof Bare !== 'undefined' ? getSyncedPrivateHyperSdkStoragePath() : null)
  return readSyncedPrivateAdoptedDrives(storage).some((entry) => matchesHyperdriveAddress(address, entry.driveId))
}

function shouldAnnounceSyncedPrivateDrive (storage) {
  const record = getPrivateDriveKeyRecord(storage)
  if (!record.ok) return true
  return record.announce !== false
}

function getDeviceOnlyDriveId () {
  if (deviceOnlyDriveId) return deviceOnlyDriveId

  if (typeof Bare !== 'undefined') {
    try {
      const parsed = JSON.parse(readFileSync(getDeviceOnlyDriveIdFile(), 'utf8'))
      // Older versions wrote the z32 form.
      if (parsed && typeof parsed.driveId === 'string') deviceOnlyDriveId = normalizeDriveAddressId(parsed.driveId)
    } catch {}
  }

  return deviceOnlyDriveId
}

function getSyncedPrivateDriveId () {
  if (syncedPrivateDriveId) return syncedPrivateDriveId
  if (syncedPrivateDrive) syncedPrivateDriveId = driveIdOf(syncedPrivateDrive)
  const path = syncedPrivateStoragePath || (typeof Bare !== 'undefined' ? getSyncedPrivateHyperSdkStoragePath() : null)
  if (!syncedPrivateDriveId && path) syncedPrivateDriveId = getPrivateDriveId(path)
  return syncedPrivateDriveId
}

function getDeviceOnlyDriveIdFile () {
  return join(getPrivateHyperSdkStoragePath(), 'device-drive-id.json')
}

function joinSiblingPath (filepath, siblingName) {
  const normalized = String(filepath).replace(/[/\\]+$/, '')
  const separatorIndex = Math.max(
    normalized.lastIndexOf('/'),
    normalized.lastIndexOf('\\')
  )

  if (separatorIndex === -1) return `${normalized}-${siblingName}`

  return `${normalized.slice(0, separatorIndex + 1)}${siblingName}`
}
