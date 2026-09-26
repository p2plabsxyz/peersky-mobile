// The nonce ties a desktop's transfer to the pairing code the phone is
// showing. It used to be reminted on every read of the key RPC, and the
// settings screen refetches on every re-render, so by the time the desktop
// had uploaded, the phone expected a different nonce and every restore failed
// the check in decryptIdentityTransfer. The verification prompt sits behind
// that check, which is why it never appeared.
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
  // decryptIdentityTransfer caps a transfer at 15 minutes. A longer-lived
  // nonce would accept a code the transfer had already stopped honouring.
  const transfer = await readFile(new URL('../../backend/backup/identity-transfer.mjs', import.meta.url), 'utf8')
  assert.match(transfer, /const MAX_TTL = 15 \* 60 \* 1000/)
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

test('the router reads the nonce from disk and never mints one to restore with', () => {
  assert.match(router, /nonce: getOrCreatePairingNonce\(identityStoragePath\)/)
  // A restore has to answer the code that was shown, so it reads without
  // minting. getOrCreate here would hand every transfer a fresh nonce to
  // fail against.
  assert.match(router, /const expectedNonce = getLivePairingNonce\(getDefaultIdentityStoragePath\(\)\)/)
  assert.match(router, /decryptIdentityTransfer\(downloaded\.bytes, keys, expectedNonce\)/)
  // Nothing in memory: a worklet restart must not change the answer.
  assert.doesNotMatch(router, /currentIdentityNonce/)
})

test('an expired pairing code says so instead of failing the nonce check', () => {
  const restore = router.slice(router.indexOf('if (req.command === RPC_IDENTITY_RESTORE_FROM_HYPER)'))
  assert.match(restore, /if \(!expectedNonce\)/)
  assert.match(restore, /Pairing code expired\. Reopen Link Device to get a new one\./)
})

test('removing an identity leaves the app usable, not half dead', () => {
  const remove = router.slice(router.indexOf('req.command === RPC_IDENTITY_REMOVE'))
  const handler = remove.slice(0, remove.indexOf('replyJson(req, result)'))

  // Both stores go: the private one holds drive cores adopted from the
  // desktop, and keeping them without the identity leaves data the user
  // thinks they deleted.
  assert.match(handler, /for \(const target of \[storagePath, syncedPrivatePath\]\)/)
  assert.match(handler, /rmSync\(target, \{ recursive: true, force: true \}\)/)
  // iOS cannot be made to quit, so the runtime has to come back up on fresh
  // storage or the app sits there with nothing running.
  assert.match(handler, /await getHyperRuntime\(\)/)
})

test('a restart the platform cannot perform is asked for instead', async () => {
  const screen = await readFile(new URL('../../app/settings/SettingsScreen.tsx', import.meta.url), 'utf8')
  const helper = screen.slice(
    screen.indexOf('function finishAndRestart'),
    screen.indexOf('function removeIdentity')
  )

  // BackHandler.exitApp is a no-op on iOS, so both flows used to finish by
  // doing nothing visible at all.
  assert.match(helper, /Platform\.OS === 'android'/)
  assert.match(helper, /BackHandler\.exitApp\(\)/)
  assert.match(helper, /Close PeerSky to finish/)

  // Neither flow may call exitApp directly any more, or it silently does
  // nothing on the platform being tested.
  const flows = screen.slice(screen.indexOf('function finishAndRestart'))
  assert.equal(flows.match(/BackHandler\.exitApp\(\)/g).length, 1)
  assert.match(flows, /finishAndRestart\('Your identity has been restored\.'\)/)
  assert.match(flows, /finishAndRestart\('This phone no longer holds your identity\.'\)/)
})

test('the device key is loaded once, not on every render', async () => {
  const screen = await readFile(new URL('../../app/settings/SettingsScreen.tsx', import.meta.url), 'utf8')
  const effect = screen.slice(
    screen.indexOf('const onCallRpcRef = useRef(onCallRpc)'),
    screen.indexOf('async function restoreIdentity')
  )

  // The parent rebuilds onCallRpc every render. Keying the effect on it meant
  // fetch, setState, render, fetch again: a loop that flickered the screen and
  // hammered the key RPC. The ref keeps the latest without re-running.
  assert.match(effect, /const response = await onCallRpcRef\.current\(RPC_IDENTITY_GET_KEY, \{\}\)/)
  assert.match(effect, /\}, \[\]\)/)
  assert.doesNotMatch(effect, /\}, \[onCallRpc\]\)/)
})

test('the transfer ceiling the nonce is matched to still exists', async () => {
  const transfer = await readFile(new URL('../../backend/backup/identity-transfer.mjs', import.meta.url), 'utf8')
  assert.match(transfer, /const MAX_TTL = 15 \* 60 \* 1000/)
  // The nonce check is what the whole flow hangs on, so it stays ahead of the
  // SAS the user is asked to compare.
  assert.ok(
    transfer.indexOf('nonce does not match the QR code') < transfer.indexOf('const sas ='),
    'SAS is computed before the nonce check'
  )
})
