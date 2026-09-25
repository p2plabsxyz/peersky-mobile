// The nonce ties a desktop's transfer to the pairing code the phone is
// showing. It used to be reminted on every read of the key RPC, and the
// settings screen refetches on every re-render, so by the time the desktop
// had uploaded, the phone expected a different nonce and every restore failed
// the check in decryptIdentityTransfer. The verification prompt sits behind
// that check, which is why it never appeared.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const router = await readFile(new URL('../../backend/rpc/router.mjs', import.meta.url), 'utf8')
const handler = router.slice(
  router.indexOf('if (req.command === RPC_IDENTITY_GET_KEY)'),
  router.indexOf('if (req.command === RPC_IDENTITY_RESTORE_FROM_HYPER)')
)

test('the pairing nonce survives a re-render of the settings screen', () => {
  // Reading the key must not change the answer. Anything that mints
  // unconditionally puts us back where we started.
  assert.match(handler, /if \(!currentIdentityNonce \|\| now >= currentIdentityNonceExpiresAt\) \{/)
  const mints = handler.match(/currentIdentityNonce = b4a\.toString\(randomBytes\(16\), 'hex'\)/g)
  assert.equal(mints.length, 1, 'nonce is minted in more than one place')
  // and that one mint is inside the guard, not above it
  assert.ok(
    handler.indexOf('if (!currentIdentityNonce ||') < handler.indexOf('currentIdentityNonce = b4a.toString'),
    'nonce is minted before the guard that should protect it'
  )
})

test('the nonce cannot outlive the transfer it protects', () => {
  // decryptIdentityTransfer caps a transfer at 15 minutes. A nonce that lived
  // longer would accept a code the transfer had already stopped honouring.
  assert.match(router, /const IDENTITY_NONCE_TTL_MS = 15 \* 60 \* 1000/)
  assert.match(router, /currentIdentityNonceExpiresAt = now \+ IDENTITY_NONCE_TTL_MS/)
})

test('an expired pairing code says so instead of failing the nonce check', () => {
  const restore = router.slice(router.indexOf('if (req.command === RPC_IDENTITY_RESTORE_FROM_HYPER)'))
  assert.match(restore, /if \(!currentIdentityNonce \|\| Date\.now\(\) >= currentIdentityNonceExpiresAt\)/)
  assert.match(restore, /Pairing code expired\. Reopen Link Device to get a new one\./)
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
