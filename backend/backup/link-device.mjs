import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import b4a from 'b4a'
import sodium from 'sodium-native'
import { getDefaultIdentityStoragePath, getDeviceKeys } from './device-keys.mjs'
import { clearPairingNonce, getLivePairingNonce } from './pairing-nonce.mjs'
import { parsePairingCode } from './pairing-code.mjs'
import {
  createPhoneBackup,
  createPhoneTransfer,
  inspectPhoneBackupFile,
  MAX_PHONE_TRANSFER_BYTES,
  PHONE_BACKUP_KIND,
  PHONE_TRANSFER_KIND,
  planPhoneBackup,
  stagePhoneBackupFile
} from './phone-backup.mjs'
import { stageDesktopTransferFile } from './desktop-transfer.mjs'
import { createDesktopTransfer, DESKTOP_TRANSFER_FILE_NAME } from './desktop-sync.mjs'
import { commitStagedRestore, recoverInterruptedRestore, RESTORE_STAGING_DIR } from './restore.mjs'
import { adoptTransferredPrivateDrive } from './private-drive-import.mjs'
import { isBackupFileHeader, isZipHeader, readFileHead } from './backup-file.mjs'
import { publishTransferFile, purgeTransferDrive, TRANSFER_FILE_NAME, transferDriveName } from './transfer-publisher.mjs'
import { fetchHyperToFile, resetHyperFetch } from '../hyper/fetch.mjs'
import { closeHyperOfflineDownloads } from '../hyper/offline-manager.mjs'
import {
  closeHyperRuntime,
  getHyperRuntime,
  getHyperStoragePath,
  getSyncedPrivateHyperStoragePath,
  holdHyperStores,
  withHyperRuntimeMaintenance,
  withHyperRuntimeOperation,
  withSyncedPrivateHyperRuntimeOperation
} from '../hyper/runtime.mjs'
import { hasPrivateDriveKey, resetPrivateDriveKeyCache } from '../hyper/private-keys.mjs'
import { closePeerChatService, exportPeerChatTransfer } from '../peerchat/runtime.mjs'
import { collectP2pmdNotes } from '../p2pmd/notes-transfer.mjs'
import { notifyApp } from '../rpc/notify.mjs'
import { RPC_APP_BACKUP_PROGRESS } from '../rpc/commands.mjs'

// Everything Link Device does: backups, transfers both ways, and restores.
// One job runs at a time, because two unpacks sharing a staging folder once
// made a store out of two backups. A restore waits decrypted in staging until
// the person compares the code and confirms, and carries an id so a
// confirmation only applies the restore it was shown for. One transfer goes
// out at a time, taken down when the screen closes or it expires.
const TRANSFER_DIR = '.peersky-transfer'
// Names the drive an outgoing transfer is on, written before anything is put
// on it, so if the app is killed while sending the next start can clear it.
const OUTGOING_MARKER = 'outgoing.json'

let pendingRestore = null
let outgoingTransfer = null
let activeJob = null

export function estimateBackup () {
  const plan = planPhoneBackup(getDefaultIdentityStoragePath())
  return { ok: true, bytes: plan.totalBytes, contents: plan.contents }
}

export function createBackupFile ({ outPath, passphrase, peerskyVersion, platform } = {}) {
  if (typeof outPath !== 'string' || !outPath.startsWith('/')) {
    return { ok: false, error: 'Missing a place to save the backup' }
  }

  return runExclusive(async () => {
    const storagePath = getDefaultIdentityStoragePath()
    const result = await withStoresClosed(() => createPhoneBackup({
      storagePath,
      outPath,
      passphrase,
      peerskyVersion,
      platform,
      onProgress: progress('packing')
    }))
    return { ok: true, path: result.path, bytes: result.bytes, contents: result.contents }
  })
}

export function inspectBackup ({ path } = {}) {
  if (typeof path !== 'string' || !path) return { ok: false, error: 'Missing a backup file' }
  const info = inspectPhoneBackupFile(path)
  if (info.kind === 'desktop-backup') {
    return {
      ok: false,
      code: 'DESKTOP_BACKUP',
      error: 'This backup was made on PeerSky Desktop, and a phone cannot open those. On the desktop, use Backup & Restore to send to this phone instead.'
    }
  }
  if (info.kind === 'transfer') {
    return {
      ok: false,
      code: 'WRONG_KIND',
      error: 'This file is a transfer made for one phone, not a backup. On the phone that sent it, use Sync with another device instead.'
    }
  }
  return { ok: true, ...info }
}

export function restoreBackupFile ({ path, passphrase } = {}) {
  if (typeof path !== 'string' || !path) return { ok: false, error: 'Missing a backup file' }

  return runExclusive(async () => {
    const storagePath = getDefaultIdentityStoragePath()
    const stagingPath = join(storagePath, RESTORE_STAGING_DIR)
    discardPendingRestore()

    const staged = await stagePhoneBackupFile({
      filePath: path,
      stagingPath,
      passphrase,
      kinds: [PHONE_BACKUP_KIND],
      onProgress: progress('unpacking')
    })
    const restoreId = holdRestore({ kind: 'phone', stagingPath, names: staged.names, replace: staged.replace })

    return {
      ok: true,
      restoreId,
      source: 'phone',
      restoredFiles: staged.restoredFiles,
      contents: staged.names,
      about: staged.about
    }
  })
}

/**
 * Receives what another device put up for this one: a desktop transfer (a
 * zip) or a phone transfer. Either way it is downloaded to disk, checked and
 * staged, and nothing is replaced until confirmRestore.
 */
export function receiveTransfer ({ hyperUrl } = {}) {
  const url = typeof hyperUrl === 'string' ? hyperUrl.trim() : ''
  if (!url) return { ok: false, error: 'Missing hyper:// identity transfer URL' }

  return runExclusive(async () => {
    const storagePath = getDefaultIdentityStoragePath()
    const expectedNonce = getLivePairingNonce(storagePath)
    if (!expectedNonce) {
      return { ok: false, error: 'Pairing code expired. Reopen Link Device to get a new one.' }
    }

    const deviceKeys = await getDeviceKeys(storagePath)
    const transferDir = join(storagePath, TRANSFER_DIR)
    const filePath = join(transferDir, `incoming-${Date.now()}.transfer`)
    const stagingPath = join(storagePath, RESTORE_STAGING_DIR)
    // The expiry is judged from when the download began, so a big transfer on
    // a slow connection is not refused for the time the connection took.
    const startedAt = Date.now()
    discardPendingRestore()
    mkdirSync(transferDir, { recursive: true })

    try {
      const downloaded = await fetchHyperToFile({
        url,
        filePath,
        maxBytes: MAX_PHONE_TRANSFER_BYTES,
        onProgress: progress('downloading')
      })
      if (!downloaded.ok) {
        return {
          ok: false,
          error: downloaded.error || `Unable to download identity transfer (${downloaded.status || 'unknown status'})`
        }
      }

      const head = readFileHead(filePath, 16)
      let staged
      let source
      if (isZipHeader(head)) {
        source = 'desktop'
        staged = await stageDesktopTransferFile({ filePath, stagingPath, deviceKeys, expectedNonce, now: startedAt })
      } else if (isBackupFileHeader(head)) {
        source = 'phone'
        staged = await stagePhoneBackupFile({
          filePath,
          stagingPath,
          deviceKeys,
          expectedNonce,
          now: startedAt,
          kinds: [PHONE_TRANSFER_KIND],
          onProgress: progress('unpacking')
        })
      } else {
        return { ok: false, error: 'That code does not lead to a PeerSky transfer.' }
      }

      const restoreId = holdRestore({ kind: source, stagingPath, names: staged.names, replace: staged.replace || [] })
      return { ok: true, restoreId, source, sas: staged.sas, restoredFiles: staged.restoredFiles, contents: staged.names }
    } finally {
      rmSync(filePath, { force: true })
      // The transfer was fetched through this phone's own store; a copy of it
      // there is only taking up space now.
      withHyperRuntimeOperation((runtime) => purgeTransferDrive(runtime, url)).catch(() => {})
    }
  })
}

/**
 * Drops a staged restore. With an id, only that restore: a cancel from a
 * dialog that has gone stale must not drop a newer one.
 */
export function discardPendingRestore ({ restoreId } = {}) {
  const pending = pendingRestore
  if (!pending || (restoreId !== undefined && pending.id !== restoreId)) return { ok: true }
  pendingRestore = null
  rmSync(pending.stagingPath, { recursive: true, force: true })
  return { ok: true }
}

export function confirmRestore ({ restoreId } = {}) {
  return runExclusive(async () => {
    const pending = pendingRestore
    if (!pending || typeof restoreId !== 'string' || pending.id !== restoreId) {
      return { ok: false, error: 'That restore is no longer waiting. Start it again.' }
    }

    // Before the stores close, not while they are closed: taking a transfer
    // down needs them open.
    await stopOutgoingTransfer()

    return withStoresClosed(async () => {
      const storagePath = getDefaultIdentityStoragePath()
      try {
        commitStagedRestore({
          storagePath,
          stagingPath: pending.stagingPath,
          names: pending.names,
          replace: pending.replace
        })
        pendingRestore = null
      } catch (error) {
        return { ok: false, error: `Could not put the restore in place: ${error.message}` }
      }

      // A desktop transfer brings private drives to adopt. A phone restore has
      // already put them back where they were.
      let adoption = { adopted: false }
      if (pending.kind === 'desktop') {
        adoption = adoptTransferredPrivateDrive(storagePath, getSyncedPrivateHyperStoragePath())
        // The cores were copied into the adopted store; this copy is only space.
        if (adoption.adopted) rmSync(join(storagePath, 'hyper-private'), { recursive: true, force: true })
      }

      resetPrivateDriveKeyCache()
      // Used once and done. A restore answers the code that was shown.
      clearPairingNonce(storagePath)

      return {
        ok: true,
        requiresRestart: true,
        source: pending.kind,
        privateDriveRestored: adoption.adopted,
        privateDriveId: adoption.driveId || undefined,
        adoptedDriveIds: adoption.driveIds
      }
    })
  })
}

/**
 * Sends this phone to the device whose pairing code was scanned, sealed to it
 * and put on a drive for it to fetch. Both screens then show the same six
 * characters. Another phone gets everything, packed with the stores closed. A
 * desktop gets only what means something there, in its own format
 * (desktop-sync.mjs), and none of that needs the stores closed.
 */
export function sendTransfer ({ pairingCode, peerskyVersion, platform } = {}) {
  let target
  try {
    target = parsePairingCode(pairingCode)
  } catch (error) {
    return { ok: false, error: error.message }
  }
  if (!target) {
    return { ok: false, error: 'That is not a pairing code. On the other device, open Link Device or Backup & Restore and scan the code it shows.' }
  }
  const toDesktop = target.deviceType === 'desktop'

  return runExclusive(async () => {
    const storagePath = getDefaultIdentityStoragePath()
    const deviceKeys = await getDeviceKeys(storagePath)
    if (target.encryptionPublicKey === b4a.toString(deviceKeys.encryption.publicKey, 'hex')) {
      return { ok: false, error: 'That is this phone\'s own code. Scan the code on the other device.' }
    }

    await stopOutgoingTransfer()
    const transferDir = join(storagePath, TRANSFER_DIR)
    mkdirSync(transferDir, { recursive: true })
    const filePath = join(transferDir, `outgoing-${target.nonce}.${toDesktop ? 'zip' : 'peersky'}`)
    const driveName = transferDriveName(target.nonce)

    try {
      // The private drive is opened first: that saves which drive it is, for
      // the desktop to be told, and announces it, so the desktop can fetch it.
      if (toDesktop && hasPrivateDriveKey(getSyncedPrivateHyperStoragePath())) {
        await withSyncedPrivateHyperRuntimeOperation(() => {}).catch(() => {})
      }
      // PeerChat goes only to a desktop whose code says it takes it.
      const chat = toDesktop && target.chat
        ? await exportPeerChatTransfer('desktop').catch((error) => {
          console.warn(`[link-device] PeerChat was not packed: ${error.message}`)
          return null
        })
        : null
      // So do P2PMD notes. Never anything tied to this phone, such as a
      // drive address: only keys, names and the text of notes it hosts.
      let notes = null
      if (toDesktop && target.notes) {
        try {
          notes = collectP2pmdNotes({ documentsPath: storagePath, hyperStoragePath: getHyperStoragePath() })
        } catch (error) {
          console.warn(`[link-device] P2PMD notes were not packed: ${error.message}`)
        }
      }
      const created = toDesktop
        ? await createDesktopTransfer({
          storagePath,
          syncedPrivatePath: getSyncedPrivateHyperStoragePath(),
          outPath: filePath,
          target,
          deviceKeys,
          peerskyVersion,
          chat,
          notes: notes?.transfer || null
        })
        : await withStoresClosed(() => createPhoneTransfer({
          storagePath,
          outPath: filePath,
          target,
          deviceKeys,
          peerskyVersion,
          platform,
          onProgress: progress('packing')
        }))

      writeFileSync(join(transferDir, OUTGOING_MARKER), JSON.stringify({ driveName, expiresAt: created.expiresAt }))
      let published
      try {
        published = await withHyperRuntimeOperation((runtime) => publishTransferFile(runtime, {
          driveName,
          filePath,
          fileName: toDesktop ? DESKTOP_TRANSFER_FILE_NAME : TRANSFER_FILE_NAME,
          onProgress: progress('sharing')
        }))
      } catch (error) {
        // Whatever made it onto the drive before the failure is cleared now,
        // not left in the store to be copied into every later backup.
        await clearTransferDrive(driveName)
        throw error
      }

      const timer = setTimeout(() => {
        stopOutgoingTransfer().catch(() => {})
      }, Math.max(0, created.expiresAt - Date.now()) + 60 * 1000)
      if (typeof timer?.unref === 'function') timer.unref()
      outgoingTransfer = { driveName, expiresAt: created.expiresAt, timer }

      return {
        ok: true,
        url: published.url,
        verificationCode: created.verificationCode,
        expiresAt: created.expiresAt,
        bytes: created.bytes,
        deviceType: target.deviceType,
        sent: created.sent,
        // Notes that went with their text. The app marks them shared, so this
        // phone looks for them on the desktop before hosting them itself.
        sharedNotes: notes?.shared || []
      }
    } finally {
      // The drive holds its own copy now.
      rmSync(filePath, { force: true })
    }
  })
}

export async function stopOutgoingTransfer () {
  const current = outgoingTransfer
  outgoingTransfer = null
  if (!current) return { ok: true }

  clearTimeout(current.timer)
  await clearTransferDrive(current.driveName)
  return { ok: true }
}

async function clearTransferDrive (driveName) {
  try {
    await withHyperRuntimeOperation((runtime) => purgeTransferDrive(runtime, driveName))
  } catch {}
  try {
    rmSync(join(getDefaultIdentityStoragePath(), TRANSFER_DIR, OUTGOING_MARKER), { force: true })
  } catch {}
}

/**
 * Deletes everything PeerSky keeps on this phone. The other half of moving to
 * a new phone: two phones on one identity write the same chat feed and fork
 * it, so the old one has to stop being that profile.
 */
export function removeIdentity () {
  return runExclusive(async () => {
    discardPendingRestore()
    await stopOutgoingTransfer()

    return withStoresClosed(async () => {
      const storagePath = getDefaultIdentityStoragePath()
      const syncedPrivatePath = getSyncedPrivateHyperStoragePath()

      // The private store goes too. It holds drive cores adopted from the
      // desktop, and keeping them behind without the identity leaves data the
      // user thinks they deleted.
      for (const target of [storagePath, syncedPrivatePath]) {
        try { rmSync(target, { recursive: true, force: true }) } catch {}
      }
      resetPrivateDriveKeyCache()

      // The runtime comes back up on fresh storage as the stores reopen. iOS
      // has no supported way to quit an app, so leaving it closed would strand
      // the user in a half-dead app until they killed it by hand.
      return { ok: true, requiresRestart: true }
    })
  })
}

/**
 * Anything a killed app left half done, run as the backend starts and before
 * any store is opened: a restore swap is undone, and staging and half-written
 * transfer files are removed. Nothing can be waiting on them, because a
 * pending restore and an outgoing transfer only live in memory.
 */
export function recoverLinkDeviceStorage () {
  const storagePath = getDefaultIdentityStoragePath()
  try { recoverInterruptedRestore(storagePath) } catch (error) {
    console.error('[link-device] Could not undo an interrupted restore:', error)
  }

  for (const name of [RESTORE_STAGING_DIR, `${RESTORE_STAGING_DIR}.inner.zip`]) {
    try { rmSync(join(storagePath, name), { recursive: true, force: true }) } catch {}
  }

  const transferDir = join(storagePath, TRANSFER_DIR)
  try {
    for (const entry of existsSync(transferDir) ? readdirSync(transferDir) : []) {
      if (entry.startsWith('incoming-') || entry.startsWith('outgoing-')) {
        rmSync(join(transferDir, entry), { force: true })
      }
    }
  } catch {}
}

/**
 * Clears the drive of a send the app was killed during. Needs the runtime, so
 * it runs once the app has asked for it to start.
 */
export function clearOrphanedTransfer () {
  if (outgoingTransfer) return
  const driveName = readOutgoingMarker(join(getDefaultIdentityStoragePath(), TRANSFER_DIR))
  if (driveName) clearTransferDrive(driveName).catch(() => {})
}

function readOutgoingMarker (transferDir) {
  try {
    const parsed = JSON.parse(readFileSync(join(transferDir, OUTGOING_MARKER), 'utf8'))
    return typeof parsed?.driveName === 'string' && /^peersky-transfer-[0-9a-f-]+$/.test(parsed.driveName)
      ? parsed.driveName
      : null
  } catch {
    return null
  }
}

async function runExclusive (task) {
  if (activeJob) {
    return {
      ok: false,
      code: 'BUSY',
      error: 'Link Device is still busy with the last thing you asked. Wait for it to finish, then try again.'
    }
  }
  activeJob = task
  try {
    return await task()
  } finally {
    activeJob = null
  }
}

function holdRestore ({ kind, stagingPath, names, replace }) {
  const id = b4a.alloc(8)
  sodium.randombytes_buf(id)
  pendingRestore = { id: b4a.toString(id, 'hex'), kind, stagingPath, names, replace }
  return pendingRestore.id
}

// Reading or replacing the Hyper stores needs them closed: a copy of a live
// store can catch it half written. They are held shut for the whole task, so
// nothing that opens them directly, PeerChat's polling included, can reopen
// them part way through. Offline downloads are left for the app to resume,
// because only the app knows whether it is on Wi-Fi.
function withStoresClosed (task) {
  return withHyperRuntimeMaintenance(async () => {
    const release = holdHyperStores()
    try {
      await closePeerChatService()
      await closeHyperRuntime()
      resetHyperFetch()
      return await task()
    } finally {
      release()
      await getHyperRuntime().catch(() => {})
    }
  }, closeHyperOfflineDownloads)
}

// At most four updates a second, and always the last one.
function progress (phase) {
  let lastSent = 0
  return (done, total) => {
    const now = Date.now()
    if (now - lastSent < 250 && done < total) return
    lastSent = now
    notifyApp(RPC_APP_BACKUP_PROGRESS, { phase, done, total: total || null })
  }
}
