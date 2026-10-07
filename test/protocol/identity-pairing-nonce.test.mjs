// The nonce ties a desktop's transfer to the pairing code the phone is
// showing. It used to be reminted on every read of the key RPC, and the
// settings screen refetches on every re-render, so by the time the desktop
// had uploaded, the phone expected a different nonce and every restore failed
// the transfer's nonce check. The verification prompt sits behind that
// check, which is why it never appeared.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  clearPairingNonce,
  getLivePairingNonce,
  getOrCreatePairingNonce,
  PAIRING_NONCE_FILE,
  PAIRING_NONCE_TTL_MS
} from '../../backend/backup/pairing-nonce.mjs'

async function storage () {
  return mkdtemp(join(tmpdir(), 'peersky-pairing-nonce-'))
}

test('reading the pairing code twice returns the same nonce', async () => {
  const dir = await storage()
  try {
    const first = getOrCreatePairingNonce(dir)
    assert.match(first, /^[0-9a-f]{32}$/)
    // The settings screen reads this whenever it loads. Rerolling here is
    // what made every restore fail: the desktop had already built a transfer
    // against the nonce it was shown.
    for (let i = 0; i < 5; i++) assert.equal(getOrCreatePairingNonce(dir), first)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the nonce survives the process that made it', async () => {
  const dir = await storage()
  try {
    const first = getOrCreatePairingNonce(dir)
    // Pairing spans two apps and several minutes with the phone backgrounded.
    // Nothing here is held in memory, so a worklet restart cannot change it.
    assert.equal(getLivePairingNonce(dir), first)
    assert.equal(getOrCreatePairingNonce(dir), first)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a restore never mints a nonce of its own', async () => {
  const dir = await storage()
  try {
    // Nothing shown yet means nothing to answer, so a transfer cannot be
    // accepted against a nonce invented at restore time.
    assert.equal(getLivePairingNonce(dir), null)
    const shown = getOrCreatePairingNonce(dir)
    assert.equal(getLivePairingNonce(dir), shown)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an expired nonce stops being live and is replaced on the next read', async () => {
  const dir = await storage()
  try {
    const first = getOrCreatePairingNonce(dir)
    const after = Date.now() + PAIRING_NONCE_TTL_MS + 1

    assert.equal(getLivePairingNonce(dir, after), null)
    const second = getOrCreatePairingNonce(dir, after)
    assert.notEqual(second, first)
    assert.equal(getLivePairingNonce(dir, after), second)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the nonce cannot outlive the transfer it protects', async () => {
  // Transfers from the desktop and from another phone are both capped at 15
  // minutes. A longer-lived nonce would accept a code the transfer had
  // already stopped honouring.
  const desktop = await readFile(new URL('../../backend/backup/desktop-transfer.mjs', import.meta.url), 'utf8')
  assert.match(desktop, /const MAX_TTL = 15 \* 60 \* 1000/)
  const { PHONE_TRANSFER_TTL_MS } = await import('../../backend/backup/phone-backup.mjs')
  assert.equal(PHONE_TRANSFER_TTL_MS, 15 * 60 * 1000)
  assert.equal(PAIRING_NONCE_TTL_MS, 15 * 60 * 1000)
})

test('clearing it means the next restore has nothing to answer', async () => {
  const dir = await storage()
  try {
    getOrCreatePairingNonce(dir)
    clearPairingNonce(dir)
    assert.equal(getLivePairingNonce(dir), null)
    // Clearing something that was never there is not an error.
    clearPairingNonce(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a corrupt record is replaced rather than thrown', async () => {
  const dir = await storage()
  try {
    await writeFile(join(dir, PAIRING_NONCE_FILE), '{ not json')
    assert.equal(getLivePairingNonce(dir), null)
    assert.match(getOrCreatePairingNonce(dir), /^[0-9a-f]{32}$/)

    await writeFile(join(dir, PAIRING_NONCE_FILE), JSON.stringify({ nonce: 'short', expiresAt: Date.now() + 1000 }))
    assert.equal(getLivePairingNonce(dir), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

const router = await readFile(new URL('../../backend/rpc/router.mjs', import.meta.url), 'utf8')
const linkDevice = await readFile(new URL('../../backend/backup/link-device.mjs', import.meta.url), 'utf8')

function bodyOf (source, signature) {
  const start = source.indexOf(signature)
  assert.ok(start > -1, `${signature} is missing`)
  return source.slice(start, source.indexOf('\n}\n', start))
}

test('the router reads the nonce from disk and never mints one to restore with', () => {
  assert.match(router, /nonce: getOrCreatePairingNonce\(identityStoragePath\)/)
  // A restore has to answer the code that was shown, so it reads without
  // minting. getOrCreate here would hand every transfer a fresh nonce to
  // fail against.
  const receive = bodyOf(linkDevice, 'export function receiveTransfer')
  assert.match(receive, /const expectedNonce = getLivePairingNonce\(storagePath\)/)
  assert.match(receive, /stageDesktopTransferFile\(\{ filePath, stagingPath, deviceKeys, expectedNonce, now: startedAt \}\)/)
  assert.match(receive, /stagePhoneBackupFile\(\{[\s\S]*?expectedNonce,/)
  assert.doesNotMatch(linkDevice, /getOrCreatePairingNonce/)
  // Nothing in memory: a worklet restart must not change the answer.
  assert.doesNotMatch(router + linkDevice, /currentIdentityNonce/)
})

test('an expired pairing code says so instead of failing the nonce check', () => {
  const receive = bodyOf(linkDevice, 'export function receiveTransfer')
  assert.match(receive, /if \(!expectedNonce\)/)
  assert.match(receive, /Pairing code expired\. Reopen Link Device to get a new one\./)
  // Checked before anything is downloaded.
  assert.ok(receive.indexOf('if (!expectedNonce)') < receive.indexOf('fetchHyperToFile'))
})

test('removing an identity leaves the app usable, not half dead', () => {
  assert.match(router, /if \(req\.command === RPC_IDENTITY_REMOVE\) \{\s*replyJson\(req, await removeIdentity\(\)\)/)
  const handler = bodyOf(linkDevice, 'export function removeIdentity')

  // Both stores go: the private one holds drive cores adopted from the
  // desktop, and keeping them without the identity leaves data the user
  // thinks they deleted.
  assert.match(handler, /return withStoresClosed\(async \(\) => \{/)
  assert.match(handler, /for \(const target of \[storagePath, syncedPrivatePath\]\)/)
  assert.match(handler, /rmSync\(target, \{ recursive: true, force: true \}\)/)
  // iOS cannot be made to quit, so the runtime has to come back up on fresh
  // storage or the app sits there with nothing running. The stores reopen as
  // the removal finishes.
  assert.match(bodyOf(linkDevice, 'function withStoresClosed (task)'), /finally \{\s*release\(\)\s*await getHyperRuntime\(\)/)
})

test('a restart the platform cannot perform is asked for instead', async () => {
  const screen = await readFile(new URL('../../app/settings/LinkDevice.tsx', import.meta.url), 'utf8')
  const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  const restart = await readFile(new URL('../../app/RestartRequiredScreen.tsx', import.meta.url), 'utf8')
  const helper = screen.slice(
    screen.indexOf('const replaceData = useCallback'),
    screen.indexOf('async function pickBackupFile')
  )

  // BackHandler.exitApp is a no-op on iOS, and on newer Android it only sends
  // the app to the background, so exiting is never all there is.
  assert.match(helper, /onRestartRequired\(\)/)
  assert.match(helper, /if \(Platform\.OS === 'android'\) BackHandler\.exitApp\(\)/)
  assert.equal(screen.match(/BackHandler\.exitApp\(\)/g).length, 1)

  // What is on screen belongs to the data being replaced. It is swapped for a
  // screen that asks for the restart, on both platforms, until it gets one.
  assert.match(app, /onRestartRequired=\{\(\) => \{[\s\S]*?setRestartRequired\(true\)/)
  assert.ok(app.indexOf('if (restartRequired) {') < app.indexOf('if (!browserSessionReady) {'))
  assert.match(app, /return <RestartRequiredScreen isDark=\{browserIsDark\} \/>/)
  assert.match(restart, /Close PeerSky to finish/)

  // Every flow that replaces or removes data goes through it.
  assert.equal((screen.match(/onConfirmRestore=\{commitRestore\}/g) || []).length, 2)
  assert.match(bodyOf(screen, 'function removeData ()'), /replaceData\(RPC_IDENTITY_REMOVE/)
})

test('the device key is loaded once, not on every render', async () => {
  const screen = await readFile(new URL('../../app/settings/LinkDevice.tsx', import.meta.url), 'utf8')

  // The parent rebuilds onCallRpc every render. Keying an effect on it meant
  // fetch, setState, render, fetch again: a loop that flickered the screen and
  // hammered the key RPC. The ref keeps the latest, and the call made from it
  // never changes, so the code loads when the sheet opens and not otherwise.
  assert.match(screen, /onCallRpcRef\.current = onCallRpc/)
  assert.match(screen, /const call = useCallback<CallRpc>\(\(command, data = \{\}\) => onCallRpcRef\.current\(command, data\), \[\]\)/)
  const effect = screen.slice(screen.indexOf('call(RPC_IDENTITY_GET_KEY)') - 600, screen.indexOf('call(RPC_IDENTITY_GET_KEY)') + 600)
  assert.match(effect, /\}, \[call, visible\]\)/)
  assert.doesNotMatch(screen, /\}, \[onCallRpc\]\)/)
})

test('the transfer ceiling the nonce is matched to still exists', async () => {
  const transfer = await readFile(new URL('../../backend/backup/desktop-transfer.mjs', import.meta.url), 'utf8')
  assert.match(transfer, /const MAX_TTL = 15 \* 60 \* 1000/)
  // The nonce check is what the whole flow hangs on, so it stays ahead of the
  // SAS the user is asked to compare.
  const verify = transfer.slice(transfer.indexOf('export function verifyDesktopTransfer'))
  assert.ok(
    verify.indexOf('made for an older code from this phone') < verify.indexOf('sas: deriveVerificationCode'),
    'SAS is computed before the nonce check'
  )
})
