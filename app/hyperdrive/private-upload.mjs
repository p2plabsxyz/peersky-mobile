// Private uploads are encrypted with the key PeerSky Desktop sends with your
// identity through Link Device, which is what lets the desktop open them too.
// Until a desktop has sent one, nothing else holds a key for this phone's
// private files, so Private asks for that first.
//
// The backend reads the same file (linkedPrivateDriveKey in
// backend/hyper/private-keys.mjs). This copy is here because the screen
// cannot import backend code that pulls in native modules.
export const LINKED_PRIVATE_KEY_FILE = 'private-drive-key.json'

const HEX_KEY = /^[0-9a-f]{64}$/i

export function isLinkedPrivateKey (text) {
  try {
    const record = JSON.parse(String(text || ''))
    return typeof record?.key === 'string' && HEX_KEY.test(record.key) && record.encrypted !== false
  } catch {
    return false
  }
}
