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
 */
export function shareDriveOpens (sdk) {
  if (typeof sdk?.getDrive !== 'function') return sdk
  const getDrive = sdk.getDrive.bind(sdk)
  const opening = new Map()
  const undecodable = new Map()
  sdk.getDrive = (nameOrKeyOrUrl, opts) => {
    const id = driveOpenId(nameOrKeyOrUrl)
    if (!id) return getDrive(nameOrKeyOrUrl, opts)
    if (undecodable.has(id)) return Promise.reject(undecodable.get(id))
    if (!opening.has(id)) {
      const drive = getDrive(nameOrKeyOrUrl, opts)
      const done = () => { if (opening.get(id) === drive) opening.delete(id) }
      drive.then(done, (error) => {
        if (error?.code === 'DECODING_ERROR') undecodable.set(id, error)
        done()
      })
      opening.set(id, drive)
    }
    return opening.get(id)
  }
  return sdk
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
