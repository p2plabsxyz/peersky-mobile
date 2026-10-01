import { createPairingCode, parsePairingCode } from '../../backend/backup/pairing-code.mjs'

export { parsePairingCode }

export function createMobilePairingCode (encryptionPublicKey, nonce) {
  return createPairingCode(encryptionPublicKey, nonce, 'mobile')
}

/**
 * What a scanned or pasted code is for. A pairing code means "send your data
 * here"; a hyper:// link is a transfer another device has ready for this one.
 */
export function classifyLinkDeviceCode (text) {
  const value = String(text || '').trim()
  if (!value) return { kind: 'empty' }

  let pairing = null
  try {
    pairing = parsePairingCode(value)
  } catch (error) {
    return { kind: 'invalid', error: error.message }
  }
  if (pairing) return { kind: 'pairing', ...pairing, code: value }

  if (/^hyper:\/\/[a-z0-9]{52,64}(\/[^\s]*)?$/i.test(value)) return { kind: 'transfer', url: value }

  return { kind: 'invalid', error: 'That is not a PeerSky code. Open Link Device on the other device and scan the code it shows.' }
}
