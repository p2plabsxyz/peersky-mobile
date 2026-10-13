import b4a from 'b4a'
import { normalizeDriveAddressId } from './runtime-routing.mjs'

/**
 * hyper-sdk keeps a drive for later only once it is ready, and Hyperdrive opens
 * its core exclusively, so a second open of a drive that is still getting ready
 * waits for the first to close, which a kept drive never does. Reads of a drive
 * not opened yet that arrive together, as a page's files do, left all but one
 * hanging for good. Opens of one drive at the same time now share one.
 *
 * A drive whose first block does not decode, someone's private drive read
 * without its key, fails to open and is never closed, so it holds its core for
 * good too: every later open of it waited forever. That failure cannot change,
 * since the block never does, so later opens get it straight away.
 *
 * A drive this phone made is opened by its name and by its address too: a
 * PeerChat room's files drive by name to upload, and by address to show a
 * picture sent earlier. hyper-sdk keeps a drive opened by address under its
 * key only, so the open by name made a second drive, which waited for the
 * first to let go of its core, for good, and every upload after it queued
 * behind. An open by name now learns the drive's key first, from a session on
 * its core that takes no lock, and shares the open of that key.
 */
export function shareDriveOpens (sdk) {
  if (typeof sdk?.getDrive !== 'function') return sdk
  const getDrive = sdk.getDrive.bind(sdk)
  const opening = new Map()
  const undecodable = new Map()

  const share = (id, open) => {
    if (undecodable.has(id)) return Promise.reject(undecodable.get(id))
    if (!opening.has(id)) {
      const drive = open()
      const done = () => { if (opening.get(id) === drive) opening.delete(id) }
      drive.then(done, (error) => {
        if (error?.code === 'DECODING_ERROR') undecodable.set(id, error)
        done()
      })
      opening.set(id, drive)
    }
    return opening.get(id)
  }

  sdk.getDrive = (nameOrKeyOrUrl, opts) => {
    const id = driveOpenId(nameOrKeyOrUrl)
    if (!id) return getDrive(nameOrKeyOrUrl, opts)
    if (!id.startsWith('name:')) return share(id, () => getDrive(nameOrKeyOrUrl, opts))
    return share(id, async () => {
      const key = await namedDriveKey(sdk, nameOrKeyOrUrl)
      if (!key) return getDrive(nameOrKeyOrUrl, opts)
      const kept = Array.isArray(sdk.drives) ? sdk.drives.find((drive) => drive?.key && b4a.equals(drive.key, key)) : null
      if (kept) return kept
      // Being opened by its address right now: that open is the one.
      return share(b4a.toString(key, 'hex'), () => getDrive(nameOrKeyOrUrl, opts))
    })
  }
  return sdk
}

// The key of a drive made here under this name, or null if none was. Read from
// a plain session on the drive's db core, which takes no lock.
async function namedDriveKey (sdk, name) {
  if (typeof sdk.namespace !== 'function') return null
  const store = sdk.namespace(name)
  // Never made here: nothing can have it open by its address either.
  const made = await store.storage?.getAlias?.({ name: 'db', namespace: store.ns }).catch(() => null)
  if (!made) return null
  const core = store.get({ name: 'db' })
  try {
    await core.ready()
    return core.key
  } catch {
    return null
  } finally {
    await core.close().catch(() => {})
  }
}

// One drive by any of the names it is asked for by: an address, a z32 or hex
// key, or the key itself. A drive's name, or a domain, only by itself.
export function driveOpenId (nameOrKeyOrUrl) {
  if (b4a.isBuffer(nameOrKeyOrUrl)) {
    return nameOrKeyOrUrl.byteLength === 32 ? b4a.toString(nameOrKeyOrUrl, 'hex') : null
  }
  if (typeof nameOrKeyOrUrl !== 'string' || !nameOrKeyOrUrl) return null
  let url = null
  try {
    url = new URL(nameOrKeyOrUrl)
  } catch {}
  if (url && (url.protocol !== 'hyper:' || !url.hostname)) return null
  const key = normalizeDriveAddressId(url ? url.hostname : nameOrKeyOrUrl)
  if (key) return key
  return url ? `host:${url.hostname}` : `name:${nameOrKeyOrUrl}`
}
