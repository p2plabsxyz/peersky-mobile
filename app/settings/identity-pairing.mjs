export function createMobilePairingCode (encryptionPublicKey, nonce) {
  if (!/^[0-9a-f]{64}$/i.test(encryptionPublicKey || '')) return ''
  if (!/^[0-9a-f]{32}$/i.test(nonce || '')) return ''

  return `peersky-identity:${encryptionPublicKey.toLowerCase()}?nonce=${nonce.toLowerCase()}&deviceType=mobile`
}
