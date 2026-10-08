import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const IDENTITY_FILE = 'peersky-identity.json'
const IDENTITY_ID = /^[0-9a-f]{64}$/

export const ANOTHER_PROFILE_ERROR = 'This phone holds another PeerSky profile. Use "Remove my data from this phone" first, then link again.'

function identityIdIn (directory) {
  try {
    const path = join(directory, IDENTITY_FILE)
    if (!existsSync(path)) return ''
    const id = String(JSON.parse(readFileSync(path, 'utf8'))?.identityId || '').toLowerCase()
    return IDENTITY_ID.test(id) ? id : ''
  } catch {
    return ''
  }
}

/**
 * Whether a staged desktop transfer is a different profile from the one this
 * phone already has. Taking it over the top kept the first profile's private
 * key and the drives it opens, so the phone could still open that person's
 * private files after it was linked to someone else. The same profile on any
 * of its devices has one id, and a phone that never had one takes any.
 */
export function isAnotherProfile (storagePath, stagingPath) {
  const current = identityIdIn(storagePath)
  const incoming = identityIdIn(stagingPath)
  return Boolean(current && incoming && current !== incoming)
}
