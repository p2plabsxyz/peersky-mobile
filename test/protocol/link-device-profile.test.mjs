// A phone with one person's PeerSky took another person's desktop transfer
// over the top. It kept the first profile's private key and the drives that
// key opens, so it still opened their private files once linked to someone
// else. It now asks for the phone's data to be removed first.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ANOTHER_PROFILE_ERROR, isAnotherProfile } from '../../backend/backup/profile-guard.mjs'
import { RESTORE_STAGING_DIR } from '../../backend/backup/restore.mjs'
import { stageDesktopTransferFile } from '../../backend/backup/desktop-transfer.mjs'
import { createDesktopTransfer, createDeviceKeys } from '../fixtures/desktop-transfer.mjs'

const id = () => crypto.randomBytes(32).toString('hex')
const identity = (identityId) => JSON.stringify({ version: 1, identityId, createdAt: new Date().toISOString() })

function folders (t) {
  const root = mkdtempSync(join(tmpdir(), 'peersky-profile-guard-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const storagePath = join(root, 'documents')
  const stagingPath = join(storagePath, RESTORE_STAGING_DIR)
  mkdirSync(stagingPath, { recursive: true })
  return { root, storagePath, stagingPath }
}

describe('linking a phone that already has a PeerSky profile', () => {
  it('takes the same profile again, from any of its devices', (t) => {
    const { storagePath, stagingPath } = folders(t)
    const mine = id()
    writeFileSync(join(storagePath, 'peersky-identity.json'), identity(mine))
    writeFileSync(join(stagingPath, 'peersky-identity.json'), identity(mine.toUpperCase()))
    assert.equal(isAnotherProfile(storagePath, stagingPath), false)
  })

  it('takes any profile on a phone that never had one', (t) => {
    const { storagePath, stagingPath } = folders(t)
    writeFileSync(join(stagingPath, 'peersky-identity.json'), identity(id()))
    assert.equal(isAnotherProfile(storagePath, stagingPath), false)
  })

  it('refuses another person\'s profile, from a real desktop transfer', async (t) => {
    const { root, storagePath, stagingPath } = folders(t)
    writeFileSync(join(storagePath, 'peersky-identity.json'), identity(id()))
    const keys = createDeviceKeys()
    const nonce = crypto.randomBytes(16).toString('hex')
    const { bytes } = createDesktopTransfer({
      files: [{ name: 'peersky-identity.json', data: identity(id()) }],
      targetEncryptionPublicKey: Buffer.from(keys.encryption.publicKey).toString('hex'),
      nonce
    })
    const filePath = join(root, 'transfer.zip')
    writeFileSync(filePath, bytes)
    await stageDesktopTransferFile({ filePath, stagingPath, deviceKeys: keys, expectedNonce: nonce })
    assert.equal(isAnotherProfile(storagePath, stagingPath), true)
    assert.match(ANOTHER_PROFILE_ERROR, /Remove my data from this phone/)
  })

  it('cannot tell from a damaged or missing record, and does not guess', (t) => {
    const { storagePath, stagingPath } = folders(t)
    writeFileSync(join(storagePath, 'peersky-identity.json'), '{ not json')
    writeFileSync(join(stagingPath, 'peersky-identity.json'), identity(id()))
    assert.equal(isAnotherProfile(storagePath, stagingPath), false)
    writeFileSync(join(storagePath, 'peersky-identity.json'), identity(id()))
    rmSync(join(stagingPath, 'peersky-identity.json'))
    assert.equal(isAnotherProfile(storagePath, stagingPath), false)
  })

  it('is checked before a desktop transfer is held for confirming, and nothing is kept', () => {
    const source = readFileSync(new URL('../../backend/backup/link-device.mjs', import.meta.url), 'utf8')
    const receive = source.slice(source.indexOf('export function receiveTransfer ('), source.indexOf('export function discardPendingRestore ('))
    assert.match(receive, /staged = await stageDesktopTransferFile\([^)]*\)\s+if \(isAnotherProfile\(storagePath, stagingPath\)\) \{\s+rmSync\(stagingPath, \{ recursive: true, force: true \}\)\s+return \{ ok: false, error: ANOTHER_PROFILE_ERROR \}/)
    assert.ok(receive.indexOf('isAnotherProfile(') < receive.indexOf('holdRestore('))
  })
})
