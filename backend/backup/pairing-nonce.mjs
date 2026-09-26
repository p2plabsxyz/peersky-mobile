// node:fs, not bare-fs: backend/bare-imports.json maps it to bare-fs at
// bundle time, and importing it directly would make this untestable.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import b4a from 'b4a'
import { randomBytes } from 'hypercore-crypto'

export const PAIRING_NONCE_FILE = 'pairing-nonce.json'

// Matched to the ceiling decryptIdentityTransfer enforces, so a live nonce can
// never outlast a transfer built against it.
export const PAIRING_NONCE_TTL_MS = 15 * 60 * 1000

const HEX_NONCE = /^[0-9a-f]{32}$/

// Kept on disk, not in memory. Pairing spans two apps and several minutes:
// read the code on the phone, paste it on the desktop, wait for the upload,
// come back and restore. The phone is backgrounded for most of that, and a
// worklet that restarts in the meantime would forget an in-memory nonce and
// mint a new one, so the transfer the desktop had already built would no
// longer match and every restore failed the check.
function noncePath (storagePath) {
  return join(String(storagePath).replace(/[/\\]+$/, ''), PAIRING_NONCE_FILE)
}

function readNonceRecord (storagePath) {
  try {
    const path = noncePath(storagePath)
    if (!existsSync(path)) return null
    const parsed = JSON.parse(b4a.toString(readFileSync(path), 'utf8'))
    const nonce = String(parsed?.nonce || '').toLowerCase()
    const expiresAt = Number(parsed?.expiresAt)
    if (!HEX_NONCE.test(nonce) || !Number.isSafeInteger(expiresAt)) return null
    return { nonce, expiresAt }
  } catch {
    return null
  }
}

/**
 * The nonce the phone is currently showing. Mints one only when there is no
 * live record, so reading the pairing code never changes it.
 */
export function getOrCreatePairingNonce (storagePath, now = Date.now()) {
  const existing = readNonceRecord(storagePath)
  if (existing && now < existing.expiresAt) return existing.nonce

  const nonce = b4a.toString(randomBytes(16), 'hex')
  try {
    mkdirSync(storagePath, { recursive: true })
    writeFileSync(noncePath(storagePath), JSON.stringify({ nonce, expiresAt: now + PAIRING_NONCE_TTL_MS }))
  } catch {
    // Unwritable storage means the nonce cannot outlive this call. The restore
    // will fail its check and say the code expired, which is the honest
    // outcome and still safe.
  }
  return nonce
}

/**
 * The nonce a restore must match, or null when there is none or it has
 * expired. Never mints: a restore has to answer the code that was shown.
 */
export function getLivePairingNonce (storagePath, now = Date.now()) {
  const existing = readNonceRecord(storagePath)
  if (!existing || now >= existing.expiresAt) return null
  return existing.nonce
}

export function clearPairingNonce (storagePath) {
  try { rmSync(noncePath(storagePath), { force: true }) } catch {}
}
