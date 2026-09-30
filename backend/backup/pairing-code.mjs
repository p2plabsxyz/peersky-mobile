// The code a receiving device shows so another device can send to it:
//
//   peersky-identity:<encryption public key>?nonce=<16 bytes>&deviceType=mobile
//
// The desktop writes the same thing with the parameters the other way round,
// so the query is parsed rather than matched.
export const PAIRING_CODE_PREFIX = 'peersky-identity:'

const HEX_KEY = /^[0-9a-f]{64}$/
const HEX_NONCE = /^[0-9a-f]{32}$/
const DEVICE_TYPES = new Set(['mobile', 'desktop'])

export function createPairingCode (encryptionPublicKey, nonce, deviceType = 'mobile') {
  const key = String(encryptionPublicKey || '').toLowerCase()
  const value = String(nonce || '').toLowerCase()
  if (!HEX_KEY.test(key) || !HEX_NONCE.test(value) || !DEVICE_TYPES.has(deviceType)) return ''
  return `${PAIRING_CODE_PREFIX}${key}?nonce=${value}&deviceType=${deviceType}`
}

/**
 * Returns { encryptionPublicKey, nonce, deviceType }, or null when the text is
 * not a pairing code at all. Throws when it is one but something in it is off,
 * so the person hears what is wrong rather than "not a PeerSky code".
 */
export function parsePairingCode (text) {
  const value = String(text || '').trim()
  if (!value.toLowerCase().startsWith(PAIRING_CODE_PREFIX)) return null

  const rest = value.slice(PAIRING_CODE_PREFIX.length)
  const queryStart = rest.indexOf('?')
  const encryptionPublicKey = (queryStart === -1 ? rest : rest.slice(0, queryStart)).toLowerCase()
  const params = new URLSearchParams(queryStart === -1 ? '' : rest.slice(queryStart + 1))
  const nonce = String(params.get('nonce') || '').toLowerCase()
  // Codes from before the device type was added came from phones.
  const deviceType = String(params.get('deviceType') || 'mobile').toLowerCase()

  if (!HEX_KEY.test(encryptionPublicKey) || !HEX_NONCE.test(nonce) || !DEVICE_TYPES.has(deviceType)) {
    throw new Error('That pairing code is damaged. Show a fresh one on the other device and scan it again.')
  }

  return { encryptionPublicKey, nonce, deviceType }
}
