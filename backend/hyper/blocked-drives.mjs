import { createHash } from 'node:crypto'
import b4a from 'b4a'
import { driveOpenId } from './shared-drive-opens.mjs'

// Drives PeerSky will not open, show or pass on, after a valid copyright
// notice (TERMS.md, Copyright). PeerSky cannot take anything off other
// people's devices or out of the network; this keeps PeerSky itself out of it.
// Each entry is the sha256 of a drive's 32-byte key in hex, so the list does
// not hand out the addresses it blocks.
export const BLOCKED_DRIVES = new Set([])

export const BLOCKED_DRIVE_MESSAGE = 'PeerSky does not open this address. It was reported to us for copyright infringement.'

/** Whether an address, a z32 or hex key, or a key is on the list. */
export function isBlockedDrive (nameOrKeyOrUrl, blocked = BLOCKED_DRIVES) {
  if (blocked.size === 0) return false
  const id = driveOpenId(nameOrKeyOrUrl)
  if (!id || !/^[0-9a-f]{64}$/.test(id)) return false
  return blocked.has(blockedDriveHash(id))
}

/** What goes on the list for a drive, from its key in hex. */
export function blockedDriveHash (keyHex) {
  return createHash('sha256').update(b4a.from(keyHex, 'hex')).digest('hex')
}

export function blockedDriveError () {
  return Object.assign(new Error(BLOCKED_DRIVE_MESSAGE), { code: 'BLOCKED_DRIVE', status: 451 })
}

/**
 * Turns the SDK's drive opens away for blocked drives. A drive that is never
 * opened is never announced or served, so this stops PeerSky passing it on as
 * well as showing it. Everything that opens a drive goes through here: pages,
 * Hyperdrive, PeerTunes, PeerChat attachments and drives kept offline.
 */
export function blockReportedDrives (sdk, blocked = BLOCKED_DRIVES) {
  if (typeof sdk?.getDrive !== 'function') return sdk
  const getDrive = sdk.getDrive.bind(sdk)
  sdk.getDrive = (nameOrKeyOrUrl, opts) => {
    if (isBlockedDrive(nameOrKeyOrUrl, blocked)) return Promise.reject(blockedDriveError())
    return getDrive(nameOrKeyOrUrl, opts)
  }
  return sdk
}
