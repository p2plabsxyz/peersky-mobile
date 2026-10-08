import { createHash } from 'node:crypto'

import { normalizeDriveAddressId } from './runtime-routing.mjs'

// What a page may do through the fetch bridge, beyond what the app itself
// does. A hyper:// page and an https:// one get the same rules. A page's named
// drives live under a prefix of its own, so `?key=p2pmd` from a page is never
// P2PMD's drive, and a page writes only to drives it created. Everything else
// it reads, private drives aside.

const MAX_NAME_LENGTH = 64
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const MAX_SITES = 256
const MAX_DRIVES_PER_SITE = 64
// A name the Hyper runtime looks up over DNS, such as agregore.mauve.moe.
const HYPER_DOMAIN = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/

// For this session only. The publish flow always asks for its drive by name
// before it writes, which puts the drive back in the list after a restart.
const createdDrives = new Map()

/**
 * Who a page is to the bridge: a hyper:// page by the drive in its address, or
 * by the domain name it was opened under, and an https:// page by its origin.
 * Only the first is a drive id, so only a page inside a drive is that drive's
 * own. Null for any other page.
 */
export function pageSiteId (pageUrl) {
  try {
    const url = new URL(String(pageUrl || ''))
    // Bare's URL has no origin, which is this.
    if (url.protocol === 'https:') return `https://${url.host}`
    if (url.protocol !== 'hyper:') return null
    const host = url.hostname.toLowerCase()
    return normalizeDriveAddressId(host) || (HYPER_DOMAIN.test(host) ? host : null)
  } catch {
    return null
  }
}

/** Whether this write asks for a named drive: POST hyper://localhost/?key=name. */
export function isNamedDriveRequest (requestUrl, method) {
  if (method !== 'POST') return false
  try {
    const url = new URL(requestUrl)
    return url.hostname === 'localhost' && url.searchParams.has('key')
  } catch {
    return false
  }
}

/**
 * The request with the page's own prefix on the drive name, or an error. The
 * prefix comes from the page's address, so two sites asking for the same name
 * get different drives and neither gets one of the app's.
 */
export function namespacePageDriveRequest (requestUrl, siteId) {
  const url = new URL(requestUrl)
  const name = url.searchParams.get('key') || ''
  if (name.length > MAX_NAME_LENGTH || !NAME.test(name)) {
    return { error: 'Drive names are letters, digits, dots, dashes and underscores, up to 64 of them' }
  }
  const prefix = createHash('sha256').update(siteId).digest('hex').slice(0, 16)
  url.searchParams.set('key', `site-${prefix}-${name}`)
  return { url: url.href }
}

export function rememberPageDrive (siteId, driveUrl) {
  const driveId = normalizeDriveAddressId(String(driveUrl || '').trim())
  if (!siteId || !driveId) return
  let drives = createdDrives.get(siteId)
  if (!drives) {
    if (createdDrives.size >= MAX_SITES) createdDrives.delete(createdDrives.keys().next().value)
    drives = new Set()
    createdDrives.set(siteId, drives)
  }
  if (drives.size >= MAX_DRIVES_PER_SITE) drives.delete(drives.values().next().value)
  drives.add(driveId)
}

export function pageMayWriteTo (siteId, driveAddress) {
  const driveId = normalizeDriveAddressId(driveAddress)
  return Boolean(siteId && driveId && createdDrives.get(siteId)?.has(driveId))
}

export function resetPageAccess () {
  createdDrives.clear()
}
